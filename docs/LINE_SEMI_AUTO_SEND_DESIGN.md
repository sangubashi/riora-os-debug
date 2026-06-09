# Riora OS — LINE半自動送信システム 本番設計書

作成日: 2026-06-04
ステータス: 設計のみ（未実装）
前提: LINE公式アカウント + Messaging API + Vercel Edge Functions + Supabase

---

## 段階的リリース方針

```
Phase A  自分（久保田）へのテスト送信のみ
  ↓
Phase B  スタッフ（鈴木・亀山・外舘）への通知
  ↓
Phase C  顧客への半自動送信
```

各フェーズで問題がなければ次フェーズに進む。
顧客送信は必ずスタッフの目視確認（semi モード）を経てから。

---

## 全体アーキテクチャ

```
Riora OS（Next.js on Vercel）
  │
  ├─ /api/line/send          ← メッセージ送信 API
  ├─ /api/line/webhook       ← 受信・既読 Webhook
  └─ /api/line/test          ← テスト送信専用 API（Phase A）
          │
          ▼
  LINE Messaging API
  （Channel Access Token で認証）
          │
          ├─ Push Message    → 特定 userId に送信
          ├─ Multicast       → 最大500名に一括送信
          └─ Webhook         → 受信・既読・フォローを通知
          │
          ▼
  Supabase
  ├─ line_send_queue         ← 送信待ちキュー
  ├─ line_send_logs          ← 送信履歴
  ├─ line_user_ids           ← userId ↔ customer_id 名寄せ
  └─ line_histories          ← 顧客別集計（返信率・既読率）
```

---

## 必要テーブル（SQL）

### 1. line_user_ids（userId 名寄せ）

```sql
CREATE TABLE public.line_user_ids (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE CASCADE,
  line_user_id    text        NOT NULL UNIQUE,
  display_name    text,
  is_test_account boolean     NOT NULL DEFAULT false,  -- Phase A: テスト用
  is_staff        boolean     NOT NULL DEFAULT false,  -- Phase B: スタッフ通知用
  staff_name      text,                                -- 例: '鈴木'
  linked_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_user_ids_customer ON line_user_ids(customer_id);
```

### 2. line_send_queue（送信待ちキュー）

```sql
CREATE TABLE public.line_send_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        REFERENCES public.customers(id),
  line_user_id    text        NOT NULL,
  message_body    text        NOT NULL,
  send_mode       text        NOT NULL CHECK (send_mode IN ('test','staff_notify','semi','auto')),
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','sent','failed','skipped')),
  approved_by     uuid        REFERENCES auth.users(id),
  approved_at     timestamptz,
  scheduled_at    timestamptz,             -- NULL = 即時送信
  triggered_by    text,                    -- 'churn_risk' | 'anniversary' | 'manual'
  template_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  error_message   text
);

CREATE INDEX idx_line_send_queue_status   ON line_send_queue(status);
CREATE INDEX idx_line_send_queue_customer ON line_send_queue(customer_id);
```

### 3. line_send_logs（送信履歴）

```sql
CREATE TABLE public.line_send_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id        uuid        REFERENCES public.line_send_queue(id),
  customer_id     uuid        REFERENCES public.customers(id),
  line_user_id    text        NOT NULL,
  message_body    text        NOT NULL,
  send_mode       text        NOT NULL,
  is_read         boolean     NOT NULL DEFAULT false,
  replied_at      timestamptz,
  read_at         timestamptz,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  staff_id        uuid        REFERENCES auth.users(id)  -- 承認スタッフ
);

CREATE INDEX idx_line_send_logs_customer ON line_send_logs(customer_id);
CREATE INDEX idx_line_send_logs_sent_at  ON line_send_logs(sent_at DESC);
```

### 4. line_histories（顧客別LINE集計）

```sql
CREATE TABLE public.line_histories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  last_sent_at    timestamptz,
  last_reply_at   timestamptz,
  unread_days     integer     NOT NULL DEFAULT 0,
  response_rate   numeric(5,2) NOT NULL DEFAULT 0,
  read_rate       numeric(5,2) NOT NULL DEFAULT 0,
  sent_count      integer     NOT NULL DEFAULT 0,
  reply_count     integer     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id)
);
```

### 5. customers テーブルへの追加カラム

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS line_user_id      text,
  ADD COLUMN IF NOT EXISTS line_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_unread_days  integer DEFAULT 0;
```

---

## 必要 API（Vercel Edge Functions）

### POST /api/line/test
**Phase A 専用。自分の LINE にテスト送信する。**

```typescript
// リクエスト
{
  message: string      // 送信メッセージ本文
  to?: string          // 省略時は ENV の TEST_LINE_USER_ID に送信
}

// 処理
// 1. 環境変数 TEST_LINE_USER_ID の userId に pushMessage
// 2. line_send_logs に test モードで記録
// 3. 成功・失敗を返す

// レスポンス
{ success: boolean; messageId?: string; error?: string }
```

### POST /api/line/send
**実際の送信キューへの投入 + semi モードの承認後送信。**

```typescript
// リクエスト
{
  customerId:  string
  body:        string
  sendMode:    'staff_notify' | 'semi' | 'auto'
  scheduledAt?: string   // ISO datetime（省略時は即時）
  triggeredBy?: string
  templateId?:  string
}

// 処理
// 1. line_user_ids で customerId → line_user_id を解決
// 2. sendMode が 'semi' → line_send_queue に status='pending' で追加（承認待ち）
// 3. sendMode が 'auto' → status='approved' で追加して即時送信
// 4. LINE Messaging API の pushMessage を呼び出し
// 5. line_send_logs に記録
// 6. line_histories を更新

// レスポンス
{ success: boolean; queueId: string; sent: boolean }
```

### POST /api/line/approve
**semi モードの承認（スタッフが確認してから送る）。**

```typescript
// リクエスト
{ queueId: string }

// 処理
// 1. line_send_queue の status を 'approved' に更新
// 2. LINE Messaging API で pushMessage を実行
// 3. status を 'sent' に更新
// 4. line_send_logs に記録

// レスポンス
{ success: boolean; sentAt: string }
```

### POST /api/line/webhook
**LINE からの受信・既読・フォローイベントを処理する。**

```typescript
// 受信イベント種別
// message  → 顧客からの返信を line_send_logs に記録
// read     → is_read=true, read_at を更新
// follow   → line_user_ids に新規登録
// unfollow → line_user_ids の is_active を false に

// 処理フロー
// 1. X-Line-Signature で署名検証（必須）
// 2. userId → customer_id に名寄せ
// 3. イベント種別に応じて DB 更新
// 4. line_histories を再集計
// 5. customers.line_response_rate を更新
```

---

## 必要 ENV（環境変数）

```bash
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=     # チャネルアクセストークン（長期）
LINE_CHANNEL_SECRET=           # Webhook署名検証用

# テスト送信先（Phase A）
TEST_LINE_USER_ID=             # 久保田さん自身の LINE userId

# スタッフ通知先（Phase B）
STAFF_LINE_USER_ID_SUZUKI=     # 鈴木スタッフの userId
STAFF_LINE_USER_ID_KAMEYAMA=   # 亀山スタッフの userId
STAFF_LINE_USER_ID_TODATE=     # 外舘スタッフの userId

# Supabase（既存）
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # Webhook からの DB 書き込みに必要
```

---

## Webhook 設定

### LINE Developers での設定

```
Webhook URL:
  https://[your-vercel-domain]/api/line/webhook

Webhookの利用: ON

検証ボタンで疎通確認後、以下のイベントを有効化:
  ✅ メッセージ（テキスト）
  ✅ 既読
  ✅ フォロー
  ✅ フォロー解除
```

### 署名検証（必須・セキュリティ）

```typescript
import { createHmac } from 'crypto'

function verifySignature(body: string, signature: string): boolean {
  const hash = createHmac('sha256', process.env.LINE_CHANNEL_SECRET!)
    .update(body)
    .digest('base64')
  return hash === signature
}

// /api/line/webhook.ts の先頭で必ず実行
const sig = req.headers['x-line-signature'] as string
if (!verifySignature(rawBody, sig)) {
  return res.status(401).json({ error: 'Invalid signature' })
}
```

---

## 送信モード仕様

| モード | 対象 | 承認 | 用途 |
|---|---|---|---|
| `test` | 久保田さん本人 | 不要 | Phase A 動作確認 |
| `staff_notify` | スタッフ3名 | 不要 | 接客指示・緊急連絡 |
| `semi` | 顧客 | スタッフ目視確認が必要 | 失客フォロー・記念日 |
| `auto` | 顧客 | 不要（自動） | 将来的な自動化（Phase C後半） |

**Phase C リリース時は semi のみ有効にする。auto は十分な実績後に解放。**

---

## userId 取得方法（顧客の LINE userId を得る方法）

LINE Messaging API では顧客自身が友だち追加するまで userId が取得できない。

### 方法1: Webhook の follow イベントで自動取得（推奨）

```
顧客が LINE公式アカウントを友だち追加
  ↓
follow イベントが Webhook に届く
  ↓
/api/line/webhook で userId を取得
  ↓
line_user_ids に INSERT
  ↓
サロンボード顧客名と手動 or 自動で紐付け
```

### 方法2: LIFF（LINE Front-end Framework）で取得

```
サロン専用 LIFF ページを作成
  ↓
顧客がタップして「予約確認」等を開く
  ↓
liff.getProfile() で userId 取得
  ↓
customers テーブルに紐付け
```

---

## 段階的リリース 詳細手順

### Phase A: テスト送信（1〜2日）

1. LINE Developers でチャネル作成
2. Channel Access Token・Channel Secret を取得
3. Vercel に ENV を設定
4. `/api/line/test` を実装・デプロイ
5. Riora OS の `/line` 画面に「テスト送信」ボタンを追加
6. 久保田さんの LINE に実際に送信して確認

**確認項目**
- メッセージが届くか
- Webhook の署名検証が通るか
- `line_send_logs` に記録されるか

### Phase B: スタッフ通知（3〜5日）

1. スタッフ3名が LINE公式アカウントを友だち追加
2. Webhook の follow イベントで userId を `line_user_ids` に自動登録
3. `is_staff=true` で手動フラグ付け
4. STAFF_LINE_USER_ID_* の ENV を設定
5. 接客アクション時にスタッフへの通知を実装（任意）

**通知例**
- VIP顧客が予約した時
- 失客リスクが高まった顧客のアラート

### Phase C: 顧客送信（1週間以上の準備）

1. 友だち追加済み顧客の userId を収集
2. `line_user_ids` と `customers` の名寄せを完成
3. `semi` モードで送信キューを実装
4. Riora OS の承認画面（`/line` の既存 LineAdminScreen）に接続
5. 最初の送信対象は失客リスクが高い顧客のみに限定
6. 送信→返信の転換率を2週間記録してから対象を拡大

---

## 既存コードとの接続

| 既存ファイル | Phase2での扱い |
|---|---|
| `src/store/useLineStore.ts` | `sendMessage` を `/api/line/send` に接続 |
| `src/lib/lineAdmin.ts` | `line_campaigns` → `line_send_queue` に移行 |
| `src/components/line/LineCrmDashboard.tsx` | 承認待ち一覧表示に活用 |
| `src/lib/aiTimeline.ts` の LINE イベント | `line_send_logs` から実データを読む |
| `calcCustomerPhase` の risk 判定 | 自動キュー投入のトリガーに利用 |
| `ChurnRiskRanking.tsx` | 失客リスク顧客への送信候補一覧として連携 |

---

*本設計書は Riora OS の既存 Supabase / Vercel / Next.js 構成に準拠しています。*
