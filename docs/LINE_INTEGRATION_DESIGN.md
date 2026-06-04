# Riora OS — LINE連携 将来設計書

作成日: 2026-06-03
対象バージョン: Phase 2 以降
ステータス: 設計のみ（未実装）

---

## 1. 型定義

### LineHistory（顧客ごとのLINE集計）

```typescript
export interface LineHistory {
  customerId:       string     // FK → customers.id
  lastSentAt:       string     // 最終送信日時 ISO
  lastReplyAt:      string | null  // 最終返信日時 ISO（未返信なら null）
  unreadDays:       number     // 未返信日数（今日 - lastSentAt）
  responseRate:     number     // 返信率 0〜100（reply / sent）
  readRate:         number     // 既読率 0〜100（既読 / sent）
  sentCount:        number     // 送信回数（累計）
  replyCount:       number     // 返信回数（累計）
  lastMessage:      string     // 最終送信メッセージの先頭50文字
  updatedAt:        string     // 集計更新日時
}
```

### LineSendLog（送信履歴ログ）

```typescript
export interface LineSendLog {
  id:            string
  customerId:    string
  sentAt:        string         // 送信日時
  messageType:   'manual' | 'auto' | 'semi'  // 送信方式
  isRead:        boolean        // 既読か
  repliedAt:     string | null  // 返信日時
  content:       string         // メッセージ本文（先頭100文字）
  triggeredBy:   string | null  // トリガー: 'churn_risk' | 'anniversary' 等
  staffId:       string | null  // 送信スタッフ ID
}
```

---

## 2. DB構造

### テーブル: line_histories

```sql
CREATE TABLE line_histories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  last_sent_at     timestamptz,
  last_reply_at    timestamptz,
  unread_days      integer NOT NULL DEFAULT 0,
  response_rate    numeric(5,2) NOT NULL DEFAULT 0,
  read_rate        numeric(5,2) NOT NULL DEFAULT 0,
  sent_count       integer NOT NULL DEFAULT 0,
  reply_count      integer NOT NULL DEFAULT 0,
  last_message     text,
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (customer_id)
);
```

### テーブル: line_send_logs

```sql
CREATE TABLE line_send_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  message_type  text CHECK (message_type IN ('manual','auto','semi')),
  is_read       boolean NOT NULL DEFAULT false,
  replied_at    timestamptz,
  content       text,
  triggered_by  text,
  staff_id      uuid REFERENCES staffs(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_line_send_logs_customer ON line_send_logs(customer_id);
CREATE INDEX idx_line_send_logs_sent_at  ON line_send_logs(sent_at DESC);
```

### customers テーブルへの追加カラム

```sql
ALTER TABLE customers
  ADD COLUMN line_response_rate  numeric(5,2) DEFAULT 50,
  ADD COLUMN line_last_sent_at   timestamptz,
  ADD COLUMN line_unread_days    integer DEFAULT 0;
```

---

## 3. CustomerScore への反映

### 現在の配点（100点満点）

| 項目 | 現在 | LINE導入後 |
|---|---|---|
| 来店回数 | 25点 | 25点 |
| 累計売上 | 25点 | 20点 |
| 店販売上 | 15点 | 15点 |
| LINE返信率 | 15点（推定値50%固定） | **15点（実値）** |
| 紹介実績 | 10点 | 10点 |
| 継続率 | 10点 | 10点 |
| LINE既読率 | — | **+5点（売上から移動）** |

### calcCustomerScore への追加入力

```typescript
// 現在
calcCustomerScore({
  visits, totalSales, avgPrice,
  lineResponseRate,  // ← 固定値50から実値に
  vipRank, churnRisk,
})

// LINE導入後に追加
calcCustomerScore({
  ...現在のフィールド,
  lineReadRate:    number,  // 既読率（新規追加）
  lineUnreadDays:  number,  // 未返信日数（ペナルティ）
})
```

### スコアへの影響式

- `lineResponseRate` = LINE API の実測値（現在の推定50%を置換）
- `lineReadRate >= 80` → +3pt ボーナス
- `lineUnreadDays >= 14` → -5pt ペナルティ

---

## 4. CustomerPhase への反映

### 現在の判定（LINE考慮なし）

```
risk: churnRisk >= 60 OR daysSinceLastVisit > cycle * 1.5
```

### LINE導入後の判定追加

```
risk（新条件追加）:
  既存条件 OR
  lineUnreadDays >= 21           // 3週間未返信
  OR (responseRate < 20 AND daysSinceLastVisit > 45)  // 低返信 + 長期未来店

vip（新条件追加）:
  既存条件 AND
  lineResponseRate >= 70         // VIPはLINE返信率も高い

repeat（変化なし）

growing（新条件）:
  既存条件 AND lineResponseRate >= 50  // LINEが繋がっていると育成しやすい
```

---

## 5. 離脱危険度（churnRisk）への反映

### 現在の計算（CSV取込時の推定値）

```
churnRisk = min(100, daysSinceLastVisit / 90 * 100)
```

### LINE導入後の計算式

```typescript
function calcChurnRisk(input: {
  daysSinceLastVisit:   number
  recommendedCycleDays: number
  lineUnreadDays:       number
  lineResponseRate:     number
  hasNextRebook:        boolean
}): number {
  let risk = 0

  // 来店経過日数（最大50点）
  const cycleRatio = input.daysSinceLastVisit / input.recommendedCycleDays
  risk += Math.min(50, cycleRatio * 40)

  // LINE未返信（最大25点）
  if (input.lineUnreadDays >= 21) risk += 25
  else if (input.lineUnreadDays >= 14) risk += 15
  else if (input.lineUnreadDays >= 7)  risk += 8

  // LINE返信率の低さ（最大15点）
  if (input.lineResponseRate < 20) risk += 15
  else if (input.lineResponseRate < 40) risk += 8

  // 次回予約なし（+10点）
  if (!input.hasNextRebook) risk += 10

  return Math.min(100, Math.round(risk))
}
```

---

## 6. VIP類似度への反映

### calcSimilarityToVip の axis 追加

```typescript
// 現在の4軸
{ label: '来店回数', ... }
{ label: '累計売上', ... }
{ label: 'LINE返信率', ... }   // ← 現在は推定50%固定
{ label: '店販購入率', ... }

// LINE導入後に追加
{ label: 'LINE返信率', customer: realResponseRate, ... }  // 実値に置換
{ label: 'LINE既読率', customer: readRate,          ... }  // 新軸追加
```

### VIPの共通特徴（LINE実値ベース）

LINE導入により `calcVipAnalytics` が正確になる：

- VIP平均LINE返信率（現在: DEMO値75% → 実値）
- VIP平均既読率（新規集計）
- VIP平均未返信日数（新規集計）

---

## 7. 店舗学習（StoreLearning）への反映

### 新規成功法則ルール

```typescript
// LINE返信率と継続率の相関
{
  id: 'line_response_retention',
  title: 'LINE返信率70%以上',
  effect: '来店継続率向上',
  evidence: calcから自動生成,
  category: 'behavior',
}

// 未返信への早期フォローの効果
{
  id: 'early_line_followup',
  title: '7日以内のLINEフォロー',
  effect: '離脱防止',
  category: 'behavior',
}
```

### StoreLearningへの追加インサイト生成

- 「LINE返信率70%以上の顧客はVIP率が◯倍高い」
- 「LINEフォロー後7日以内の来店予約率◯%」
- 「未返信14日超の顧客の次月来店率◯%」

---

## 8. KPI画面で表示すべき指標

### 新規パネル: LINE分析パネル

| 指標 | 説明 |
|---|---|
| 全体LINE返信率 | 全顧客の平均返信率 |
| 未返信7日以上 | フォロー要顧客数 |
| 未返信14日以上 | 緊急フォロー顧客数 |
| LINE送信→予約転換率 | LINE送信後7日以内に予約した割合 |
| 自動送信件数（当月） | auto/semi別内訳 |
| 返信率トレンド | 月次推移グラフ |

### ChurnRiskRanking への追加列

- 現在: 危険度 / 前回来店 / LINE返信率 / 予約有無
- 追加: 未返信日数 / 最終LINE日

---

## 9. LINE公式API連携方法

### 接続方式

```
LINE Official Account
  ↓
LINE Messaging API（Webhook）
  ↓
Vercel Edge Function（/api/line/webhook）
  ↓
Supabase（line_send_logs / line_histories 更新）
  ↓
Riora OS（リアルタイム反映）
```

### Webhook受信処理（将来実装）

```typescript
// /api/line/webhook.ts（設計のみ）

// 受信イベント種別
type LineEvent =
  | { type: 'message';    source: LineSource; message: LineMessage }
  | { type: 'read';       source: LineSource; readCount: number }
  | { type: 'follow';     source: LineSource }
  | { type: 'unfollow';   source: LineSource }

// 処理フロー
// 1. 署名検証（X-Line-Signature）
// 2. userId → customerId に名寄せ（line_user_ids テーブル）
// 3. line_send_logs に INSERT / UPDATE
// 4. line_histories を集計更新（UPSERT）
// 5. customers.line_response_rate を更新
// 6. churnRisk を再計算してDBに反映
```

### LINE userId 名寄せテーブル

```sql
CREATE TABLE line_user_ids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id),
  line_user_id text UNIQUE NOT NULL,  -- LINE の userId
  linked_at   timestamptz DEFAULT now()
);
```

### 送信方式（3段階自動化）

| モード | 対象顧客 | 処理 |
|---|---|---|
| `auto` | 来店1〜3回・低単価・指名なし・非サブスク | Webhook経由で自動送信 |
| `semi` | 来店4〜7回・中リスク | スタッフ確認後に送信 |
| `manual` | VIP・高LTV・指名客・サブスク | スタッフが手動送信 |

### 実装優先順

1. Webhook受信 + 署名検証
2. メッセージ受信 → line_send_logs INSERT
3. 既読イベント → is_read = true UPDATE
4. line_histories 集計（バッチ or トリガー）
5. customers.line_response_rate 自動更新
6. churnRisk / CustomerScore リアルタイム再計算
7. KPI画面 LINE分析パネル表示

---

## 実装ロードマップ

```
Phase 2（次フェーズ）
  └─ LINE Webhook 受信基盤
  └─ line_histories テーブル作成
  └─ CustomerScore に実値 lineResponseRate を反映

Phase 3
  └─ churnRisk 計算式に LINE未返信日数を追加
  └─ KPI画面 LINE分析パネル追加
  └─ auto/semi/manual 送信フロー

Phase 4
  └─ DM送信→予約転換率のトラッキング
  └─ StoreLearning に LINE相関ルール追加
  └─ VIP類似度に LINE既読率軸を追加
```

---

*本設計書は Riora OS の既存アーキテクチャ（Next.js / TypeScript / Supabase / Zustand）に準拠しています。*
