# 写真カルテ機能 事前調査レポート (PHOTO_KARTE_AUDIT_1)

作成日: 2026-09-02
ステータス: 調査のみ完了。コード変更・migration・push・deployは一切未実施。

## 目的

エステサロン向けに、施術写真を中心とした電子カルテ(写真カルテ)機能をRiora OSに追加する。
最重要機能は「写真登録 → 顧客ごとに時系列管理 → Before/After比較 → 過去写真との比較」。
併せてiPad対応も検討する。本レポートはPhase 1(写真カルテの基盤部分)を安全に設計するための
事前調査であり、実装は含まない。

---

## 1. 現在のRiora OSの写真関連機能

**顧客の施術写真を扱う機能は現状ゼロ。** 全文検索(`photo|image|attachment`)でも該当テーブル・
機能は見つからなかった。重複の心配なく白紙から設計できる。

関連する既存資産:

- **音声メモ機能(`src/lib/voiceNote.ts`)** — Supabase Storageへのアップロード・signed URL取得・
  削除・オフラインフォールバックまで実装済みの唯一の完成されたStorage実装パターン。写真カルテの
  実装テンプレートとして最も参考になる。
  - パス: `{staffId}/{customerId}/{timestamp}.{ext}`(`voiceNote.ts:100`)
  - signed URL: `createSignedUrl(path, 3600)`(`voiceNote.ts:260-262`、1時間有効)
  - bucket `voice-notes` はSupabase Dashboardで手動作成(migrationにはコメントのみ、
    `20260521_voice_notes.sql:48-58`)。Private、10MB上限、`audio/*`のみ許可。
- **KarteImportSection / `karte_imports`テーブル** — 「カルテ取込」という名前だが実体はOCR済み
  テキストの貼り付け解析のみ。画像そのものは保存していない。写真カルテとは無関係。
- 顧客のアバター表示は静的アセット(キャラクター画像)であり、顧客個人の写真ではない。
  `brain_customers`等に`avatar_url`/`photo_url`相当のカラムも存在しない。

---

## 2. 現在の顧客・来店・施術データ構造

**新旧2系統のスキーマが並存**しているのが最重要の前提。

| 系統 | 顧客 | 来店/予約 | スタッフ | 店舗 |
|---|---|---|---|---|
| legacy(`001_schema.sql`) | `customers` | `reservations` | `profiles` | なし(単一店舗前提) |
| Riora Brain(`20260612000001_core_tables.sql`等) | `brain_customers` | `brain_visits`/`brain_bookings` | `brain_staff` | `brain_stores` |

現行の実運用(AI提案・今日タブ・CustomerBottomSheet等)は**`brain_customers`/`brain_visits`/
`brain_staff`が正**。`customers`と`brain_customers`は同一UUIDのミラー行として運用されている
(現行DBトリガーによるbackfillと判明済み、[[project_brain_customer_id_migration]]参照)。

`brain_visits`(`20260612000001_core_tables.sql:136-156`)が来店と施術を兼ねる:

```
brain_visits: id, store_id, customer_id→brain_customers, staff_id→brain_staff,
              menu_id→brain_menus, visit_date, visit_count_at, treatment_amount,
              retail_amount, homecare_purchased, next_booking_made,
              voice_memo_url, deleted_at
```

`voice_memo_url`カラムが既に「visit単位でファイルURLを持つ」前例として存在する。
独立した「施術内容」テーブルはなく、1来店=1メニュー実施(`menu_id`)として記録される設計。
したがって、要望の `customer → visit → treatment → photos` は実質
**`customer(brain_customers) → visit(brain_visits、施術情報込み) → photos` の3階層**として
素直に実現できる(treatmentを別テーブル化する必要はない)。

参考: `brain_skin_records`(`visit_id UNIQUE → brain_visits`)がvisit単位の構造化評価を持つ
既存パターンであり、写真の body_part 別記録の設計前例になる。

**tenant(店舗)**: `brain_stores`が正規実装。ただし`stores`という未使用の第2テーブルも存在
(`20260615_multi_store_prep.sql`、マルチストア準備用・RLS未適用)。実運用は固定UUID
`00000000-0000-0000-0000-000000000001`(`DEMO_STORE_ID`, `src/lib/constants.ts:8`)の
単一店舗のみ。

---

## 3. 現在の認証/RLS構造 ★最重要

### 3-1. 二層構造とその危険な実態

- **API層**: `extractStaffFromRequest.ts`(JWT→`brain_staff.id`) → `canAccessCustomer.ts`
  (Rule A'/B'/C) → `requireAdmin.ts`
- **DB層(RLS)**: `auth1_v2_can_access_customer()` / `is_store_admin()` /
  `current_brain_staff_id()` というSQL関数

**Rule A'/B'/C**(`canAccessCustomer.ts`冒頭コメント):
- Rule A': 直近来店(`brain_visits.visit_date`最新)の担当staffが自分 → 常時アクセス可
- Rule B': 本日の予約担当(`reservations.staff_id`をuser_id経由で変換)と一致 → 当日のみ
- Rule C: 来店履歴も当日予約もない → 店舗共有として全スタッフ閲覧可
- admin(`isAdmin=true`)は常時全件
- `is_internal_user=true`(スタッフ本人の顧客レコード)はadmin以外アクセス不可の共通ゲート

**重大な事実**: `src/lib/supabase.ts`のブラウザ用クライアント(anon key)はログイン後の
スタッフJWTを持ったまま**Next.js APIを経由せずPostgRESTへ直接アクセス可能**。実際
`CustomerBottomSheet.tsx`は`contraindications`/`handover_notes`/`customer_notes`等に
**直接**アクセスしており、API層の`canAccessCustomer()`はこの経路を通らない。
**→ RLSが最後の防波堤であり、API層のチェックだけでは担保にならない。**

過去に`customer_memories`でAPI層とRLS層のロジックが別々になり、**119件中44件(37%)の
判定食い違い**が実際に発生した記録がある([[project_customer_memories_security_audit]])。
写真機能の設計でも同じ轍を踏まないことが必須要件。

### 3-2. 依存関数のドリフト(要棚卸し)

`is_store_admin()` / `current_brain_staff_id()` という、複数のRLSポリシーが依存する重要関数の
**CREATE FUNCTION文がmigrationファイル内に一つも存在しない**(grep 0件)。Supabase側で直接
作成され、git管理外になっていると考えられる。写真テーブルのRLSでこれらに依存する前に、
本番から実体を取得してmigrationとして復元する棚卸しが必要。

### 3-3. tenant分離とRLSの関係

`20260612000005_rls_policies.sql`で`app_store_id()`(`current_setting('app.store_id', true)`)
を使った`store_id = app_store_id()`ポリシーが`brain_*`系テーブルに適用済み。ただし
**アプリ側は`app.store_id`セッション変数を一度も設定していない**
(`canAccessCustomer.ts`はハードコードされた`STORE_ID`定数で直接フィルタするのみ)。
つまり店舗分離のRLSは「構造は存在するが実質機能していない」状態。
**ユーザーが要求する「tenant単位の完全なデータ分離」は、現状のRiora OSのどの機能にも
実在しない。** 写真カルテで初めて本格導入するなら、既存store_id基盤を使うか、単一店舗前提の
既存設計をそのまま踏襲するか、方針決定が必要。

### 3-4. Storage RLS / signed URL

Storage RLSポリシーもSupabase Dashboardで手動設定であり、コードベースにSQLとして残っていない。
signed URLは`voiceNote.ts`の`createSignedUrl(path, 3600)`が唯一の実例。

### 3-5. パス設計への示唆

`tenant_id/customer_id/photo_id.webp`案は、DB側の`auth1_v2_can_access_customer(customer_id)`
チェックと、Storage側の`bucket_id = 'customer-photos' AND (パスのcustomer_id部分)`を照合する
RLSポリシーの**両方を組み合わせる**べき。パス文字列だけをアクセス制御に使う設計(URLを知って
いれば見える等)は避け、Storage RLSポリシー内で`storage.objects.name`をパースして
`auth1_v2_can_access_customer()`相当の関数を呼ぶ形にする。

---

## 4. 現在のSupabase Storage構造

コードベースから参照されているbucketは**`voice-notes`のみ**(全文検索で確認済み)。
- Private、10MB上限、`audio/webm`,`audio/mp4`,`audio/ogg`のみ許可(Dashboard手動設定)
- 用途は音声メモ専用。写真カルテと共存させる理由はなく、**新規bucket
  (例: `customer-photos`)を作るのが適切**。
- `voice-v1.1/supabase/functions/transcribe-voice/`にEdge Function用の別の一時bucket
  (`TEMP_BUCKET`)も存在するが、処理後に`remove()`で削除する一時利用のみ。

画像処理ライブラリ(sharp, browser-image-compression, react-webcam等)は
**package.jsonに一切導入されていない**。圧縮・WebP変換のコードも存在しない。
Phase 1でライブラリを新規選定・追加する必要がある。

環境変数はStorage用に`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`のみで、bucket名は`'voice-notes'`のようにハードコードされている。

**サーバーAPIは基本的にservice roleキーでRLSをバイパスしアプリ層(`canAccessCustomer`)で認可**
しているが、音声メモだけはクライアント直接呼び出し+Storage RLS依存という別パターン。
写真カルテをどちらの方式にするかは重要な設計判断(→ 11節参照)。

---

## 5. iPad対応で問題になる箇所

- `CustomerBottomSheet.tsx`(約1488行付近) — `className="w-full max-w-[430px]"`で
  **スマホ幅にハードコード固定**。高さも`calc(var(--vh,1dvh) * 88)`のbottom sheet方式のみ。
  iPadで開くと画面中央に細い帯が表示され、大部分が空白になる。
- `AppBottomNav.tsx`(36-37行付近) — `maxWidth:'430px'`、`left:50%; transform:translateX(-50%)`
  で同様に固定。**アプリ全体がスマホ幅の中央固定カラム**として設計されている。5タブ構成自体は
  CLAUDE.mdの凍結ルールにより変更不可。
- `app/layout.tsx`の`viewport`設定(32-39行付近)は`userScalable:false`,
  `maximumScale:1` — **ピンチズーム禁止**。iPadでも同様に無効化される。写真拡大表示を実装する
  場合、ネイティブズームに頼れず**アプリ内で独自のピンチズーム/パン実装が必要**。
- レスポンシブbreakpoint(`md:`/`lg:`/`xl:`)は、スタッフアプリ側
  (`src/components/customer`, `src/components/phase1`, `src/components/line`)に
  **1件も存在しない**(grep 0件)。存在するのは`src/components/admin/**`のみ
  (CLAUDE.mdにより変更不可の管理者アプリ)。
- `tailwind.config.ts`にbreakpoint拡張なし。
- Adaptive Priorityロジック内で`currentContext: { role: 'staff', device: 'mobile' }`が
  ハードコード。デバイス判定フックはアプリ全体に存在しない。
- Bottom sheetパターン(下からせり出す)はiPadの大画面では窮屈で、Before/After比較のような
  横並び表示には構造的に不向き。

**結論**: スタッフアプリは現状「スマホオンリー」実装。iPad対応は既存コードの部分改修ではなく、
新規のブレークポイント設計が必要になる。

---

## 6. 写真カルテを追加する最適な画面

検討した3案:

- **案A: CustomerBottomSheet内に`page==='photos'`を追加**(既存の`memory`/`timeline`と同じ
  切替パターン) — 実装コストは最小だが、430px幅の制約下でBefore/After比較UIを組むと
  1枚あたり~190px程度になり窮屈。
- **案B: 専用フルスクリーン画面/モーダル**(例: `app/customers/[id]/photos/page.tsx`、
  または全画面ビュー) — 430px幅の制約から解放され、iPad横画面での3カラムレイアウト
  (顧客情報|写真比較|カルテ)が組める。
- **案C: 別タブとして5タブ構成に追加** — CLAUDE.mdのv1.0凍結ルールで5タブ構成の変更は
  明示的に禁止されているため不可。

**推奨: 2段階構成(案A+案Bのハイブリッド)。**

1. **1次表示**: `CustomerBottomSheet.tsx`内に、`VoiceMemoSection`/`KarteImportSection`と
   同じ「アコーディオン+ErrorBoundary」パターンで新規セクション(仮`PhotoKarteSection.tsx`)を
   追加。既存の`openSections`状態管理にそのまま乗せられ、影響範囲が明確な最小変更で済む。
2. **2次表示(Before/After比較・タイムライン)**: セクション内のサムネイル一覧から
   **専用の全画面ビュー(モーダル)を開く**構成にする。この全画面ビューだけiPad時に
   3カラムレイアウト等の拡張を許可すれば、CustomerBottomSheet自体(430px制約)には
   手を入れずに済む。

理由: (1) Before/After比較というPhase1の最重要要件が430px幅の中では窮屈にしかならない、
(2) iPad対応をどのみち別途検討する必要があり、写真カルテの全画面ビューから独立して
iPad最適化レイアウトを先行導入できる、(3) 既に2500行を超える巨大コンポーネント
(`CustomerBottomSheet.tsx`)への追加変更を最小化でき、凍結ルール上のリスクを抑えられる。

---

## 7. 必要なDB変更案

既存テーブルに同等の構造はなく、新規テーブルが必要。命名は既存の`brain_*`規約と
非prefix規約(`customer_visits`等)の2案が調査内で出たが、FK先が`brain_customers`/
`brain_visits`である実質的な主系列であることを踏まえ、**`brain_customer_photos`**を推奨。

```sql
CREATE TABLE public.brain_customer_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id       uuid REFERENCES public.brain_visits(id) ON DELETE SET NULL,
  body_part      text NOT NULL,
  photo_type     text NOT NULL CHECK (photo_type IN ('before','after','progress','other')),
  storage_path   text NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
```

- `visit_id`はnullable(施術と紐付かない単発撮影も許容)。
- `store_id`/`customer_id`/`visit_id`にインデックス。
- 既存`brain_*`は全て論理削除(`deleted_at`)方式のため踏襲。

**RLS方針は2択(要ユーザー判断)**:
- A案: `auth1_v2_can_access_customer(customer_id)`を流用(customer_notes等と同じ水準)。
  DB側で来店担当スタッフのみ閲覧可というRLSを最初から正しく作れる。
- B案: `karte_imports`で採用済みの「機微性が高く閲覧UIがまだ無い新規テーブルは
  service_role限定にし、authenticatedへのGRANT自体を絞る」パターン。

顔・施術写真の機微性を考えると、**Phase1はまずB案(API経由のみ、authenticated直接GRANTなし)
で開始し、UIが安定してからA案へ緩和する**方が安全側に倒せる。

マイグレーション作法(既存慣習): `supabase/migrations/YYYYMMDDHHmmss_description.sql`、
`CREATE TABLE IF NOT EXISTS`等の冪等性、RLSポリシーと対になる`GRANT`文を忘れない
(既存migrationで繰り返し踏まれている落とし穴)。

---

## 8. 必要なStorage変更案

- 新規bucket: `customer-photos`(Private、`image/webp`中心の許可MIME設定、サイズ上限は
  圧縮後想定300〜500KBを踏まえて要検討)
- パス: `{store_id}/{customer_id}/{photo_id}.webp`(ユーザー案を採用、将来マルチストア時も
  バケット内で分離可能)
- signed URL方式(`voiceNote.ts`と同パターン)。有効期限は用途別に検討
  (一覧サムネイルは短時間キャッシュ、詳細表示は都度発行等)。
- 削除: 論理削除(`deleted_at`)を基本とし、Storage側の物理削除は運用ポリシー次第
  (写真は音声よりデータ量が大きく、無期限保持コストの検討が必要)。
- バックアップ・容量: 現在の契約プランのStorage上限は未確認。写真は音声よりファイル数・
  総容量が増えやすいため、事前確認事項として明記する。
- Storage RLSポリシーはDashboardでの手動設定になる見込みだが、**設定内容は必ずSQLとして
  ドキュメント化し、migrationコメントか別ファイルにコード管理下で残す**
  (既存`voice-notes`はこれが欠落しており、同じ轍を踏まない)。

---

## 9. 必要なAPI変更案

`extractStaffFromRequest`+`canAccessCustomer`(またはB案採用時はservice_role限定)で
ゲートする形で新設:

- `POST /api/customers/[id]/photos` — アップロード(署名URL発行 or サーバー経由アップロード)
- `GET /api/customers/[id]/photos` — 一覧(visit_id/body_part/photo_typeで絞り込み)
- `GET /api/customers/[id]/photos/[photoId]/signed-url` — 閲覧用
- `DELETE /api/customers/[id]/photos/[photoId]` — 論理削除

既存の`/api/voice/commit`のfire-and-forget/リトライパターン、`canAccessCustomer()`呼び出し
順序が参考になる。

---

## 10. 必要なUI変更案

- `PhotoKarteSection.tsx`(新規、CustomerBottomSheet内のアコーディオン。1次表示)
- 撮影/アップロードUI(カメラ起動 or ファイル選択。iPadでの`<input capture>`挙動は要検証)
- クライアント側の圧縮/リサイズ/WebP変換ロジック(ライブラリ新規選定が必要)
- Before/After比較コンポーネント(新規、全画面ビュー、2次表示)
- タイムライン表示コンポーネント(新規)
- iPad用ブレークポイント分岐は、上記の全画面ビューの内部にのみ導入し、
  CustomerBottomSheet本体・AppBottomNavには手を入れない。

---

## 11. セキュリティ上の注意点

1. 顔・施術写真は最高機微度の個人情報。`karte_imports`(生カルテ全文)より慎重な扱いが必要。
2. ブラウザから直接PostgREST/Storageへアクセスできる経路が現に存在するため、
   **API層のチェックだけでは不十分**。DB RLS・Storage RLSを必ず併用する。
3. `customer_memories`の37%判定食い違いの教訓から、**ロジックの二重実装を避け**、
   `auth1_v2_can_access_customer()`をRLSから直接呼ぶ一本化を徹底する
   (A案採用時)、もしくはB案でAPI一本化を徹底する。
4. `is_store_admin()`等の依存関数がmigration外にある状態のまま新しいRLSを積み上げるのは
   危険で、**先に本番からの実体復元(棚卸し)を推奨**。
5. signed URLは有効期限内であればURL漏洩=誰でも閲覧可能という音声メモと同じリスクを継承する。
6. `is_internal_user`(スタッフ本人)顧客の除外ゲートを写真でも踏襲する必要がある。
7. PII最小化方針([[project_pii_policy_v1]])との整合(退店後の写真保持期間等)を確認する。
8. tenant分離は現状のRiora OSのどの機能にも実質存在しない([[3-3]]参照)。写真機能で
   「完全なデータ分離」を謳う場合、既存の店舗分離未実装という前提とのギャップをユーザーに
   明示し、方針を確定させる必要がある。

---

## 12. Phase 1〜4の実装順序(概略)

Phase1は複数の安全なサブフェーズに分割することを推奨(詳細は末尾の実装計画を参照):

1. DB/RLS設計の確定とレビュー(migration未適用)
2. Storage bucket + RLS設計の確定(未適用)
3. アップロードAPI+最小UI(1枚アップロード→一覧表示のみ)
4. サムネイル/圧縮/WebP変換
5. Before/After比較UI
6. iPad対応(既存の430px制約を壊さない形での拡張)
7. 過去写真との比較・タイムライン

Phase2(基本カルテ統合)・Phase3(Apple Pencil)・Phase4(肌マップ/AI)は今回スコープ外のため
詳細化しない。

---

## 13. 各Phaseの想定変更ファイル(Phase1のみ、実装時)

- 新規: `supabase/migrations/xxxx_customer_photos.sql`
- 新規: `src/lib/customerPhoto.ts`(`voiceNote.ts`相当)
- 新規: `src/components/customer/PhotoKarteSection.tsx`
- 新規: `src/components/customer/PhotoCompareView.tsx`(Before/After比較、全画面)
- 新規: `app/api/customers/[id]/photos/**`
- 変更: `src/components/customer/CustomerBottomSheet.tsx`(セクション追加・導入ボタンのみ、
  既存ロジックは不変更)
- 変更: 型定義ファイル(customer/visit関連の型に写真型を追加)

---

## 14. 各Phaseで必要なテスト

- RLS到達可能性テスト(担当外スタッフ・他store・退職スタッフ・`is_internal_user`顧客それぞれで
  拒否されること)
- アップロードAPIの`canAccessCustomer`統合テスト(またはB案の場合service_role限定の検証)
- 圧縮/リサイズ/WebP変換の単体テスト(サイズ・画質の許容範囲確認)
- Storage signed URLの有効期限・アクセス制御テスト
- Before/After比較UIの表示崩れ確認(スマホ・iPad両方)
- 既存`CustomerBottomSheet.tsx`の`openSections`状態管理に新セクションが影響しないことの
  回帰確認

---

## 15. 既存機能への影響

- `CustomerBottomSheet.tsx`へのセクション追加のみであれば影響は限定的。ただし同ファイルは
  既に2500行超の巨大コンポーネントであるため、追加位置と`openSections`状態管理・
  Adaptive Priorityロジックへの影響は慎重に確認する必要がある。
- LINE領域・admin領域・5タブ構成・AI提案ロジックには一切触れない設計とする
  (CLAUDE.mdの凍結ルール準拠)。
- `voice-notes`bucket・`voice_notes`テーブルには触れない(別bucket・別テーブルとして独立)。

---

## 16. リスクと対策

| リスク | 対策 |
|---|---|
| API層とRLS層のロジック二重実装によるアクセス制御の食い違い(customer_memoriesで前例あり) | RLSまたはAPIのどちらかに制御を一本化し、両方に別ロジックを書かない |
| `is_store_admin()`等の依存関数がgit管理外 | 実装前に本番から実体を復元しmigration化する棚卸しを先に実施 |
| tenant分離が実質未実装という既存の限界を写真機能が継承する | ユーザーに現状を明示した上で、写真機能でどこまでtenant分離を実装するか方針を確定 |
| Storage RLSがDashboard手動設定でコード管理外 | 設定内容を必ずSQL文書として記録し、コード管理下に置く |
| 画像処理ライブラリが皆無で工数を過小評価しやすい | ライブラリ選定を独立したステップとして計画に明記(本レポート末尾参照) |
| `CustomerBottomSheet.tsx`が既に巨大でセクション追加のリスクが読みにくい | 新規セクションはErrorBoundaryで隔離し、既存セクションのコードには触れない |
| iPad対応を「既存UIの拡大」で済ませようとして430px制約と衝突する | 写真カルテの全画面ビューのみ新規ブレークポイントを導入し、既存レイアウトは変更しない |
| Storage容量・バックアップ方針が未確認のまま実装が進む | Phase1着手前にSupabase契約プランのStorage上限を確認 |

---

## Phase 1 実装計画(具体化・まだ実行しない)

1. **事前棚卸し(コード変更なし)**: `is_store_admin()`/`current_brain_staff_id()`の実体を
   Supabase本番から取得しmigration化。現行Storage RLS(`voice-notes`)の実ポリシーも
   同様に取得・記録。
2. **DB設計レビュー**: `brain_customer_photos`のカラム・RLS方針(A案/B案)をユーザーと確定
   → migration案をレビュー用に提示(適用はユーザー承認後)。
3. **Storage設計レビュー**: bucket名・パス・RLSポリシー案を提示 → Dashboard手動作成の
   手順書として提示(適用はユーザー承認後)。
4. **最小アップロードAPI+一覧表示**: 圧縮なしでまず1枚アップロード→DB保存→一覧表示までを
   最小実装し、RLS/権限テストを先に固める。
5. **クライアント側圧縮/WebP変換**: ライブラリ選定(追加install要否含めユーザー確認)→実装。
   長辺1920px・WebP・quality 80前後・目標300〜500KB/枚を基本案とし、一覧=サムネイル
   /比較=中サイズ/詳細=最大1920pxの3段階戦略で実装。
6. **Before/After比較UI**: 全画面ビューとして新規実装。同一部位同士の比較を担保する
   データモデル(body_part一致でのフィルタ)、将来の「初回|3回目|6回目|現在」比較への
   拡張を見込んだ構造にする。
7. **iPad対応の最小差分**: CustomerBottomSheet本体は変更せず、写真の全画面ビューにのみ
   ブレークポイント対応(横向きで左:顧客情報/履歴・中央:写真比較・右:施術情報、の
   3カラムレイアウト案)を入れる。

---

## 方針決定(2026-09-02 ユーザー承認)

- **RLS方針: B案を採用。** `brain_customer_photos`はauthenticatedへの直接GRANTを絞り、
  service_role限定+API層(`canAccessCustomer`)経由のみでアクセスさせる。UIが安定した後に
  A案(RLS直接制御)へ緩和するかは別途判断する。
- **tenant分離: 既存踏襲。** 単一店舗前提(固定`STORE_ID`)を写真機能でも継続する。
  `app.store_id`の実効化には今回踏み込まない。ただし将来の拡張に備え、
  `brain_customer_photos.store_id`列自体は保持する。
- **次のステップ: 事前棚卸しから着手。** `is_store_admin()`/`current_brain_staff_id()`の
  本番実体確認、`voice-notes`bucketの実Storage RLSポリシー確認を、読み取り専用で行う
  (migration作成・適用はまだ行わない)。

## 残る確認事項

- 画像処理ライブラリの選定(Canvas API自前実装 vs `browser-image-compression`等の追加)
- Storage容量・保持期間(退店後の写真保持ポリシー)

---

## 事前棚卸し結果(2026-09-02、Supabase MCP経由・本番読み取り専用で実施)

Supabase MCPを認証し(スコープにdatabase:write等の書き込み権限も含まれるが、今回は
`execute_sql`による読み取りクエリのみ実行。書き込み系ツールは一切呼び出していない)、
本番プロジェクト`Riora-System`(project_id: ohszxgajckzphhfhdrsv)から以下を確認した。

### 依存関数の実体(migration外にあった関数)

いずれも`supabase/migrations/`内にCREATE FUNCTION文が存在しないことをgrepで確認済み
(利用箇所はあるが定義がない="ドリフト"が事実だった)。本番の実体は以下の通り:

```sql
-- app_store_id(): app.storeidセッション変数を読むだけ。未設定なら NULL。
CREATE OR REPLACE FUNCTION public.app_store_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.store_id', true), '')::uuid
$$;

-- is_store_admin(): profiles.role が owner/admin かどうか(brain_staffではなくprofiles基準)
CREATE OR REPLACE FUNCTION public.is_store_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
$$;

-- current_brain_staff_id(): auth.uid() から brain_staff.id を逆引き
CREATE OR REPLACE FUNCTION public.current_brain_staff_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.brain_staff WHERE user_id = auth.uid() AND deleted_at IS NULL LIMIT 1
$$;

-- auth1_v2_can_access_customer(): Rule A'/B'/C の実SQL実装
CREATE OR REPLACE FUNCTION public.auth1_v2_can_access_customer(p_customer_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    is_store_admin()
    OR EXISTS (SELECT 1 FROM brain_visits v WHERE v.customer_id = p_customer_id
               AND v.deleted_at IS NULL AND v.staff_id = current_brain_staff_id()
               ORDER BY v.visit_date DESC LIMIT 1)
    OR EXISTS (SELECT 1 FROM reservations r JOIN brain_staff bs ON bs.id = current_brain_staff_id()
               WHERE r.brain_customer_id = p_customer_id AND r.staff_id = bs.user_id
               AND r.scheduled_at::date = CURRENT_DATE AND r.status <> 'cancelled')
    OR ( -- Rule C: 来店履歴も当日予約も無い顧客は店舗共有
      NOT EXISTS (SELECT 1 FROM brain_visits v WHERE v.customer_id = p_customer_id AND v.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.brain_customer_id = p_customer_id
                      AND r.scheduled_at::date = CURRENT_DATE AND r.status <> 'cancelled')
    )
$$;
```

`auth1_v2_can_access_legacy_customer`という名前の関数は本番に存在しなかった(命名が違うか、
別実装に統合されている可能性。要再調査だが今回のPhase1設計には影響しない)。

`is_internal_user`(スタッフ本人の顧客レコード除外ゲート)はRLSポリシー内やこれらの関数内には
一切現れなかった。**このゲートはAPI層(`canAccessCustomer.ts`)のみで効いており、DB RLSでは
効いていない**。ブラウザから直接PostgRESTを叩けばこのゲートを素通りできる余地がある
(3-1節の懸念の裏付け)。写真カルテでこのゲートが必要なら、RLS側にも実装するかB案(API限定)を
徹底するかの判断が要る。

### ★新発見: voice_notesテーブルに新旧RLSポリシーが両方残っている

`voice_notes`テーブルのSELECTポリシーを確認したところ、**AUTH-1 V2移行後のポリシーと
移行前の旧ポリシーが両方有効なまま残っていた**:

```
voice_access_by_customer_rule (SELECT): auth1_v2_can_access_customer(customer_id)   -- 新
voice_notes_read              (SELECT): staff_id = auth.uid() OR is_owner()          -- 旧(未削除)
```

PostgreSQLのRLSは同一コマンドに対する複数のpermissiveポリシーをOR結合するため、
**実際のアクセス可否は「新ルール OR 旧ルール」の和集合になっている**。旧ポリシーが
`staff_id = auth.uid()`(録音した本人なら誰でも恒久的に閲覧可)を許すため、AUTH-1 V2が
意図した「Rule A'/B'/Cに基づく現在時点でのアクセス制御」への統一は**完全には達成されていない**。
たとえば、担当替え後も「録音した元担当スタッフ」は当該音声メモを読み続けられてしまう。

→ **教訓**: RLSポリシーを追加・置換する際は、置き換えたはずの旧ポリシーを`DROP POLICY`し
忘れると、意図せず古いルールが生き残り新ルールと合成されてしまう。写真カルテのRLS実装時は
必ず「最終形で有効なポリシー一覧」をSELECTで確認してから完了とする。

### Storage RLS(voice-notes bucket)の実際の設計思想

```
voice_notes_select (SELECT): bucket_id='voice-notes' AND (is_owner() OR foldername[1]=auth.uid())
voice_notes_insert (INSERT): bucket_id='voice-notes' AND foldername[1]=auth.uid()
voice_notes_delete (DELETE): bucket_id='voice-notes' AND (is_owner() OR foldername[1]=auth.uid())
```

`is_owner()`は「店舗オーナー(profiles.role='owner')」を指し、ファイルの所有者という意味ではない。
つまりStorage側の実際のアクセス制御は**「アップロードした本人(auth.uid) or 店舗オーナーのみ」**
であり、`auth1_v2_can_access_customer()`が体現するRule A'/B'/C(顧客ベースの動的アクセス制御)
とは**全く別の基準**になっている。

コード側(`voiceNote.ts:100`、`CustomerBottomSheet.tsx:229`のコメント「セッションuidを
staffIdとして使用」)を確認した結果、パスの`{staffId}`は実際には`auth.uid()`(セッションの
Supabase Auth ID)であり、Storage RLSの`foldername[1]=auth.uid()`とは整合している
(=このRLSは「意図通りには動いている」)。

ただし意図自体が「録音した本人だけが再生できる」という設計になっており、**今日の担当スタッフが
別のスタッフの録った音声メモをStorage経由で直接再生することはできない**
(DBの`voice_notes`テーブル読み取りは`auth1_v2_can_access_customer()`で許可されても、
signed URL発行元のStorage RLSで弾かれる)。`getVoiceNoteUrl()`はクライアント側
(anon key、`VoiceMemoSection.tsx`から直接呼び出し)で実行されるため、この制約が
実際に効いている可能性が高い(要実機確認だが、コード上はそう読める)。

**写真カルテへの示唆**: 既存のvoice-notesパターン(Storage RLSを「アップロード者=auth.uid()」
で縛る方式)をそのまま踏襲すると、写真でも同じ問題(担当外スタッフが過去の担当者の撮った写真を
見られない)が発生しうる。**B案(API経由のみ・Storage RLSはservice_role限定にしてクライアント
直接アクセスを許可しない)を採用したのはこの点でも正しい判断**——signed URL発行をサーバー側
(service role、`canAccessCustomer()`通過後)に一本化すれば、Storage RLSの「誰がアップロードしたか」
という基準に運用が縛られずに済む。

### karte_importsのGRANT限定パターン(B案の直接の前例)

```
karte_imports の GRANT: service_role のみ(SELECT, INSERT)。authenticatedへのGRANTなし。
karte_imports の RLS  : ki_select(qual: true) / ki_insert(with_check: true)
```

RLSポリシー自体は`true`(全許可)だが、`authenticated`ロールにテーブル権限そのものを
GRANTしていないため、ブラウザから直接PostgRESTを叩いても「permission denied」になり、
**GRANTの欠如がRLSより先に効く第一関門として機能している**。これはB案(写真テーブルを
service_role限定にする)の直接の前例であり、`brain_customer_photos`でも同じGRANT設計
(`authenticated`への GRANT なし、`service_role`のみ)を踏襲すればよいことが確認できた。

### 新規テーブル名の重複確認

`brain_customer_photos`という名前のテーブルは本番に存在しないことを確認済み(命名の衝突なし)。

### 棚卸しのまとめ

1. `is_store_admin()`/`current_brain_staff_id()`/`auth1_v2_can_access_customer()`の実体を
   確認・記録した(本ドキュメントに転記済み。今後migration化するかは別途判断)。
2. `is_internal_user`ゲートはDB RLSに実装されておらずAPI層のみ — 写真カルテでの対応方針の
   決定が必要。
3. `voice_notes`テーブルに新旧RLSポリシーの残存という具体的な実装ミスを発見(新規教訓)。
4. `voice-notes`Storage RLSは「アップロード者=auth.uid()」基準であり、顧客ベースの
   アクセス制御とは別物と判明 — B案採用の妥当性を補強。
5. `karte_imports`のGRANT限定パターンが確認でき、`brain_customer_photos`のGRANT設計の
   直接のテンプレートとして使える。
