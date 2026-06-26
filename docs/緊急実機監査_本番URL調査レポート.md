# 緊急実機監査 — 本番URL実態調査レポート

調査日: 2026-06-25
対象URL: `https://riora-os-debug-webhook.vercel.app`(Playwrightで実機確認・コード変更なし・データ変更なし)

## 0. 最重要発見: `/admin`配下は本番に一切デプロイされていない

```
git log -1 --format=%cd  →  Fri Jun 19 12:35:48 2026 +0900(最終コミットは6日前)
git status --short       →  app/admin/、app/api/admin/、src/components/admin/、
                              src/engines/customerType/、src/store/useLineAdminStore.ts
                              は全て "??"(未追跡・未コミット)

vercel ls --prod          →  最新の本番デプロイも6日前(2026-06-19相当)
```

**これまでの一連のタスク(MD-1〜MD-6経営ダッシュボード、AI提案本物化、LINE画面本物化、Customer Type Engine等)で作成した`/admin`配下のコードは、一度もgit commitされておらず、Vercelへも一度もデプロイされていない。** ローカルの`npm run build`/`npm start`では正しく動作することを毎回確認していたが、それは本番環境とは無関係である。本番で動いているのは6日前(2026-06-19)時点のコードのみ。

## 1. `/admin`が実際に開くか

**開かない。404。** Playwrightで実機確認:

```
GET https://riora-os-debug-webhook.vercel.app/admin → 404
本文: 「ページが見つかりません」
```

## 2. `/admin/dashboard`が存在するか

**存在しない。404。**(理由は§0と同じ)

## 3. `/admin`配下の全画面確認

全8ルートをPlaywrightで実機確認した結果、**全て404**:

| ルート | 結果 |
|---|---|
| `/admin` | 404 |
| `/admin/dashboard` | 404 |
| `/admin/churn-risk` | 404 |
| `/admin/customer-assets` | 404 |
| `/admin/line` | 404 |
| `/admin/staff-analytics` | 404 |
| `/admin/occupancy` | 404 |
| `/admin/csv-import` | 404 |
| `/admin/business-settings` | 404 |

## 4. `/phase1`の全画面確認

`/phase1`自体は200で開く(実機確認済み)。ボトムナビは「ホーム・顧客・AI提案・KPI・メニュー」の5タブのみ(稼働率分析・スタッフ分析等の管理者機能はそもそも存在しない=未デプロイの`/admin`側にしかない)。

実機ロード時に**実際の401エラーが2件発生**:
```
401 .../rest/v1/kpi_today?select=today_sales,yesterday_sales
ERR_ABORTED HEAD .../rest/v1/customers?select=id&churn_risk_score=gt.60
```
画面自体は表示されるが(エラー時のフォールバック表示あり)、一部の実データ取得が認証エラーで失敗している。

`/customers`(顧客一覧・5タブの「顧客」相当)は実際にSupabaseへ問い合わせて**8件取得・8件表示**と画面上のデバッグ表示で確認(実クエリは成功)。ただし内容は`田中あかり`等の初期シードデータであり、稼働中の実顧客データではない。

`/ai-suggestions`は「DBタグ×ルールベースで生成・AI全文生成なし」と明記された旧実装で動作(LLM不使用の固定テンプレ生成。実画面表示は確認済み)。

## 5. KPI画面が実データかデモか

**表示されている数値は実質デモ(MOCK_*フォールバック)。** 実機で以下の実エラーを確認:

```
400 .../rest/v1/staff_logs?select=menu,ai_adopted,next_reserved,option_sold,retail_sold&...
401 .../rest/v1/reservations?select=menu&scheduled_at=...
```

`src/store/useKpiStore.ts`の実データ取得(日次KPI/週次売上/スタッフランキング/インサイト)は全てDEMO_MODE=trueにより実行されず、`MOCK_CURRENT`/`MOCK_STAFF`/`MOCK_INSIGHTS`等のハードコード値(同ファイル63-115行目)が初期状態としてそのまま表示される。実機の400/401エラーはこの「フォールバックに切り替わる前の本来の実クエリ」が実際に失敗していることの直接的な証拠。

`ProductAnalyticsPanel`/`TreatmentAnalyticsPanel`(KPI画面内のCSV分析タブ)は`DEMO_MODE`チェックさえなく、`DEMO_PRODUCT_ROWS`/`DEMO_TREATMENT_ROWS`を**常に**直接参照しており、CSV取込後も実データに切り替わらない可能性がある実装上の問題も発見した。

## 6. STAFF OCCUPANCY(稼働率分析)のデータソース調査

**本番には存在しない。** `稼働率分析`画面(`/admin/occupancy`)は§0の通り未デプロイのため、本番URLでは到達不可能(404)。データソースの実態評価自体ができない状態。

## 7. メニュー管理が開かない原因調査

`/menu`ページ自体は実機で200・正常表示を確認。原因は**ページ内の「メニュー管理」クイックアクセスボタンが自己参照リンクになっているバグ**:

```ts
// src/components/menu/MenuDashboard.tsx:26-31
const GRID_ITEMS = [
  { label: '予約管理',     href: '/phase1' },
  { label: 'メニュー管理', href: '/menu' },   // ← 現在のページ自身を指している
  { label: 'VIP管理',      href: '/customers' },
  { label: 'メッセージ',   href: '/line' },
]
```

実機でクリックを再現したところ、`router.push('/menu')`が実行され**現在のURLのまま変化なし**(画面が固まったように見える/何も起きないように見える、というユーザー体感と一致)。本来は専用のメニュー編集・管理画面に飛ぶべきだが、そのhrefが未実装のまま`/menu`(自分自身)が暫定的に入っている状態。

## 8. CSVファイル選択/ドロップが残っている箇所

実機で到達可能な範囲では**1箇所**:

- `src/components/kpi/SalonBoardImportPanel.tsx`(`/kpi`画面内のタブから到達) — `<input type="file">`+ドラッグ&ドロップ実装あり。コード内に明記: 「DEMO_MODE=true の場合は保存をスキップして画面のみ表示」(実際に本番もDEMO_MODE=trueのため、ここでCSVを選択しても**実際の保存は行われない**仕様)

もう1箇所(`src/components/admin/csv-import/CsvImportScreen.tsx`)は実装としては存在するが、`/admin/csv-import`自体が§0の理由で本番未デプロイのため、**本番では到達不可能**。

## 9. DEMO_MODE利用箇所(全件)

`src/lib/supabase.ts:4`で`export const DEMO_MODE = true`(ハードコード)。本番で参照している主な箇所(コード内合計184箇所・39ファイル。詳細リストは調査ログ参照):

**常時デモ動作中**(`VOICE_NOTES_LIVE`等で解除されていない箇所):
- `src/store/useKpiStore.ts` — KPI全データ(§5)
- `src/store/useKpiSqlStore.ts` — SQL集計版KPI
- `src/store/useLineStore.ts` — `/line`のチャット一覧・メッセージ・テンプレ・配信(`MOCK_THREADS`等)
- `src/store/useLineTemplateStore.ts` — テンプレ(`MOCK_CATEGORIES`/`MOCK_TEMPLATES`)
- `src/store/useImprovementLogStore.ts` — 改善ログ
- `src/store/useAuthStore.ts` — 自動サインイン(`admin@salon-riora.jp`への自動ログイン。`DEMO_CREDENTIALS`)
- `src/lib/lineAdmin.ts` — LINEキャンペーン管理(全操作no-op)
- `src/lib/line/lineQueueGenerator.ts` — LINE配信キュー生成
- `src/lib/import/SalonBoardSaveEngine.ts` — **CSV確定保存がスキップされる**(§8と直結)
- `src/lib/nextAction/generateNextActions.ts` / `src/lib/phase5/customerRiskEngine.ts` / `src/lib/phase8/successPatternEngine.ts` / `src/lib/storeLearningRepository.ts` / `src/lib/roleGuard.ts` — 各種フォールバック

**`VOICE_NOTES_LIVE=true`により実質解除済み**(コード上は`DEMO_MODE`チェックがあるが現在は実クエリ側が動く):
- `src/lib/voiceNote.ts` / `customerNotes.ts` / `bookingPrompt.ts` / `contraindication.ts` / `handover.ts` / `aiTimeline.ts`

**重大な相互作用**: `DEMO_MODE`を単独で`false`に変更すると認証が壊れる。`app/ClientShell.tsx`の`PUBLIC_PATHS`(`/customers`/`/kpi`/`/line`/`/menu`/`/ai-suggestions`/`/phase1`等)は`DEMO_MODE`と無関係に常に未ログイン許可のままのため、ログインへのリダイレクトは起きないが、各ストアのDEMO_MODEフォールバックだけが消え、画面が空白になる。

## 10. モックデータ利用箇所(全件列挙)

| 定数 | ファイル | 状態 |
|---|---|---|
| `MOCK_CURRENT`/`MOCK_PREV_DAY`/`MOCK_PREV_MONTH`/`MOCK_WEEKLY`/`MOCK_STAFF`/`MOCK_INSIGHTS` | `src/store/useKpiStore.ts` | **本番で実際に表示中**(§5) |
| `MOCK_STATE` | `src/store/useKpiSqlStore.ts` | 到達可能 |
| `MOCK_CUSTOMERS` | `src/store/useCustomerStore.ts` | フォールバック時のみ |
| `MOCK_THREADS`/`MOCK_TODAY`/`MOCK_AI` | `src/store/useLineStore.ts` | **本番`/line`で実際に表示中**(実機確認済み・「鈴木恵様」等の固定スレッド) |
| `MOCK_CATEGORIES`/`MOCK_TEMPLATES`/`MOCK_BY_CATEGORY` | `src/store/useLineTemplateStore.ts` | 到達可能 |
| `MOCK_LINE_UNREADS` | `src/components/phase1/LineUnreadSheet.tsx` | 到達可能 |
| `REACH`(セグメント人数) | `src/components/line/BroadcastSheet.tsx` | 到達可能 |
| `TYPE_FALLBACK`(AI返信案) | `src/components/line/ChatWindow.tsx` | 到達可能 |
| `DEMO_ACTIONS` | `src/lib/actionLog.ts` | 到達可能 |
| `DEMO_MEMORIES` | `src/lib/aiMemory.ts` | 到達可能 |
| `DEMO_ANALYTICS_CUSTOMERS` | `src/lib/analytics/customerAnalytics.ts` | KPI画面の顧客分析パネルで到達可能 |
| `DEMO_PRODUCT_ROWS` | `src/lib/analytics/productAnalytics.ts` | **DEMO_MODE判定なしで常時表示**(§5の実装バグ) |
| `DEMO_TREATMENT_ROWS` | `src/lib/analytics/treatmentAnalytics.ts` | 同上 |
| `DEMO_VIP_ROWS` | `src/lib/analytics/vipAnalytics.ts` | 到達可能 |
| `DEMO_PATTERNS` | `src/lib/analytics/SuccessPatternAnalyzer.ts` | 到達可能 |
| `TYPE_PROFILES`(5固定プロフィール) | `src/components/AiSuggestionsScreen.tsx` | **`/ai-suggestions`で実際に表示中**(個別化なし・実機確認済み) |
| `MOCK_CUSTOMER`等6種 | `app/phase1-debug/page.tsx` | 開発者用デバッグページ(`/phase1-debug`)・実機到達可能だが通常ナビ外 |

## 成果物

### 実装済み一覧(本番で実際に到達可能)

- `/`・`/login`・`/splash` — 認証フロー(実機200)
- `/phase1` — スタッフアプリ本体(実データ+デモフォールバック混在)
- `/customers` — 顧客一覧(実Supabaseクエリ成功・8件)
- `/kpi` — KPI画面(画面自体は表示されるが内容はデモ値中心)
- `/menu` — メニュー画面(実データ・`/api/admin/menu`経由。ただし§7のリンクバグあり)
- `/line`・`/line/approve` — LINE CRM(チャット一覧等はデモ、承認キューは実データだが一部400/401あり)
- `/ai-suggestions` — ルールベースAI提案(固定5プロフィール)
- `/phase1-debug`・`/test` — 開発者用診断ページ

### 未実装一覧(本番に存在しない・404)

- `/admin`配下全9ルート(§0〜§3)
- AI提案本物化(`ProposalOrchestrator`接続)— 未デプロイ
- LINE画面本物化(Pass G成果)— 未デプロイ
- Customer Type Engine(Pass H成果)— 未デプロイ
- これまでのMD-1〜MD-6一式 — 未デプロイ

### デモ残存一覧

§9・§10の表に記載した全箇所(KPI画面が最も濃い・LINE CRMのチャット一覧も濃い)

### ルート切れ一覧

| ルート/リンク | 問題 |
|---|---|
| `/menu`内「メニュー管理」クイックアクセス | 自己参照リンク(`href: '/menu'`)・実質無反応 |
| `/admin`配下9ルート全て | 404(未デプロイ) |

### 本番で実際に使える機能一覧

- ログイン/認証(実Supabase Auth)
- 顧客一覧表示(実クエリ・但しシードデータ)
- メニュー画面の集計表示(実データ・`brain_menus`/`brain_visits`経由)
- LINE送信承認キュー(`/line/approve`・実データだが一部400エラー)
- LINEテスト送信(`/api/line/test-send`実装は存在・本調査では未実行)

## 結論

ローカルでこれまで積み上げてきた管理者ダッシュボード・AI提案・LINE本物化・Customer Type Engineの全成果は、**git未コミット・Vercel未デプロイのため本番には一切反映されていない**。本番で稼働しているのは6日前時点のスタッフアプリ(`/phase1`系)のみで、KPI・LINE CRM等の主要機能は依然デモデータ中心。次のアクションとして、まず`git add`+`commit`+`push`でVercelへデプロイすることが、ここまでの全作業を本番に反映させる前提条件となる。
