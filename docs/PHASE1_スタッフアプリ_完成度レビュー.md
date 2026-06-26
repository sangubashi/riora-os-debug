# PHASE1 スタッフアプリ 完成度レビュー

作成日: 2026-06-23
種別: 調査レポートのみ(コード修正は行っていない)

調査範囲: KPI画面/顧客詳細画面/AI提案画面/LINE画面/音声メモ画面/メニュー画面/設定画面の7画面。対象は現場スタッフ向けPhase1アプリ(`src/components/phase1/`等)であり、別タスクで実装した管理者ダッシュボード(`app/admin/*`)は対象外。

## 0. サマリー(総合判定)

| 画面 | 判定 | 一言で |
|---|---|---|
| KPI画面 | 🟡 部分完成 | UI/Supabaseクエリは広く実装済みだが`DEMO_MODE=true`で大半が到達不能。一部パネルはCSV取込後も更新されない設計ミスあり |
| 顧客詳細画面 | 🟡 部分完成 | 音声メモ・引継ぎ・禁忌情報の保存ロジックは実DB接続済み。肌タグ/メモ/ログ保存は`!DEMO_MODE`分岐でスキップされ現状無効 |
| AI提案画面 | 🔴 未実装 | 顧客個別データと無関係な5種類の固定テンプレート表示のみ。Supabase/API接続ゼロ |
| LINE画面 | 🟡 部分完成 | Webhook受信・送信承認は本物のLINE Messaging APIに接続済み。チャット一覧・配信・テンプレ機能はモック固定 |
| 音声メモ画面 | 🟡 部分完成 | 録音→保存→Whisper/Claude解析→4テーブル保存の本番パイプラインは動くが、画面に表示される文字起こしはこの結果を使わない別の固定文言 |
| メニュー画面 | 🔴 未実装 | ストア初期値がモック固定、`DEMO_MODE`で実クエリ全て早期return、かつ画面側がfetch関数を一度も呼んでいない |
| 設定画面 | ⚫ 未実装(画面自体が存在しない) | メニュー画面内の「設定」タブはクリックしても無反応の死んだUI要素のみ。独立した設定画面・ルートは存在しない |

凡例: 🟢完成済み / 🟡部分完成 / 🔴未実装 / ⚫該当画面なし

---

## 1. KPI画面

**ファイル**: `app/kpi/page.tsx` → `src/components/kpi/KpiDashboard.tsx`、`src/components/kpi/phase2/*`

**総合判定: 部分完成** — `src/lib/supabase.ts`の`DEMO_MODE=true`が全データ取得処理の先頭でガードしており、本番データへの導線が事実上ない。

- **動作する機能**
  - `useCustomerStore.fetchCustomers()`は理論上Supabase(`customers`テーブル+RPC `get_customer_stats`)へ接続できる設計だが、KPI画面からは一度も呼ばれていない
  - `SalonBoardImportPanel.tsx`のCSV解析・プレビューUIはクライアント内で完結して動作

- **ダミーデータの箇所**
  - `src/lib/supabase.ts:4` `DEMO_MODE = true`
  - `src/store/useKpiStore.ts:63-119` `MOCK_CURRENT`/`MOCK_WEEKLY`/`MOCK_STAFF`/`MOCK_INSIGHTS`等。`fetchTodayKpi`等(L195,276,304,330,364)はDEMO_MODEで即return
  - `src/store/useKpiSqlStore.ts:42-50` `MOCK_STATE`。実クエリ(L105-304)はDEMO_MODE優先で到達不能
  - `src/components/kpi/OccupancyHeatmap.tsx:8-12` `STAFF_DATA`完全ハードコード
  - `src/components/kpi/RepeatAnalytics.tsx:4-9` `METRICS`完全ハードコード(リピート率78%等)
  - `src/components/kpi/KpiDashboard.tsx:115-132` `AI_STRATEGY`(山田美沙・鈴木花子)ハードコード
  - `src/components/kpi/TreatmentAnalyticsPanel.tsx:9,80`・`ProductAnalyticsPanel.tsx:8,70` `DEMO_TREATMENT_ROWS`/`DEMO_PRODUCT_ROWS`を直接使用、CSV取込後も更新されない
  - `src/store/useAnalyticsStore.ts:27-36` `DEMO_VIP_ROWS`等から初期state構築
  - `src/components/kpi/phase2/StaffImprovementPanel.tsx:22-23` 「全体平均（モック）」明記の固定値
  - `src/store/useImprovementLogStore.ts:43-54` `buildDemoLogs()`

- **API未接続箇所**
  - KPI画面・関連コンポーネント全体で`fetch('/api/...')`呼び出しは0件。専用API Routeも存在しない

- **Supabase未接続箇所**
  - `useKpiStore`/`useKpiSqlStore`の実クエリはコードはあるがDEMO_MODE優先で到達不能。想定テーブル名(`daily_kpi_snapshots`等)も実在未確認
  - `AIInsightBox.tsx`/`StaffKpiCard.tsx`/`StaffRanking.tsx`は`KpiDashboard.tsx`からimportされていない孤立コンポーネント(`StaffKpiCard.tsx`は`staff_logs`への実クエリを持つが未使用)

- **本番利用できない理由**
  - `DEMO_MODE=true`が全データ取得を無効化、切替スイッチが入っていない
  - `OccupancyHeatmap`/`RepeatAnalytics`/`AI_STRATEGY`はSupabase接続フック自体が存在しない静的UI
  - `TreatmentAnalyticsPanel`/`ProductAnalyticsPanel`はCSV取込後も更新されない設計ミス
  - 想定テーブル名の実在性が未確認なため、`DEMO_MODE=false`にしても動作しない可能性

---

## 2. 顧客詳細画面

**ファイル**: `app/customers/page.tsx`、`src/components/customer/CustomerBottomSheet.tsx`(本体)、`src/components/phase1/CustomerPage.tsx`/`CustomerDetailSheet.tsx`(旧)

**総合判定: 部分完成** — 音声メモ・引継ぎ・禁忌情報は実DB接続済みだが、肌タグ/メモ/ログ保存は`!DEMO_MODE`分岐でスキップされ現状は保存されない。

- **動作する機能**
  - `src/lib/voiceNote.ts` 音声メモのアップロード・DB保存・再生URL取得・削除(`voice_notes`テーブル、Storageバケット`voice-notes`)
  - `src/lib/bookingPrompt.ts`/`handover.ts`/`contraindication.ts` — `booking_prompts`/`handover_notes`/`contraindications`への実INSERT/UPDATE/SELECT(ルールベース・LLM未使用)
  - `src/lib/actionLog.ts`経由の`customer_action_logs`記録
  - `QuickServiceLog.tsx:83` `supabase.from('staff_logs').insert(...)`

- **ダミーデータの箇所**
  - `src/store/useCustomerStore.ts:83-92` `MOCK_CUSTOMERS`(8件)。`profiles`取得失敗・0件・未認証等の失敗パスで即フォールバック(`:122-194`)
  - `src/components/customer/VipSimilarityCard.tsx:43`/`VipPromotionCard.tsx:36,40` `DEMO_ANALYTICS_CUSTOMERS`(VIP比較対象が常に固定)
  - `src/components/customer/CustomerInsightPanel.tsx:53` `if (DEMO_MODE) { setLoading(false); return }` — 常に空表示
  - `src/components/phase1/CustomerPage.tsx:38` `savedMemo`が固定文字列のローカルstateのみ
  - `src/components/customer/CustomerBottomSheet.tsx:308` DEMO_MODE時は肌タグ・ホームケアプランをローカルデータで完結

- **API未接続箇所**
  - `app/api/customers/[id]/route.ts`(brain_customers/brain_visits返却)はPhase1のどのUIからも呼ばれていない。Phase1は`useCustomerStore`経由で旧`customers`テーブルへ別経路で直接アクセス

- **Supabase未接続箇所**
  - `CustomerBottomSheet.tsx`の肌タグ/接客ログ/メモ保存は`!DEMO_MODE`分岐内のみ実行(`:498,518,556`)。現在`DEMO_MODE=true`のため保存処理に到達しない

- **本番利用できない理由**
  - `DEMO_MODE=true`により肌タグ・接客ログ・メモの保存が明示的にスキップされる
  - `useCustomerStore`は認証/RLS失敗時に即モックへフォールバックするため、本番接続が不安定だと顧客一覧が静かに偽データへ切り替わる
  - VIP類似度・VIP昇格シミュレーターは恒久的に固定比較データ

---

## 3. AI提案画面

**ファイル**: `app/ai-suggestions/page.tsx` → `src/components/phase1/AiSuggestionsScreen.tsx`/`AIProposalView.tsx`

**総合判定: 未実装**(実質ハードコードのショーケース) — 顧客ごとの実データではなく5種類の固定顧客タイプテンプレートを表示するのみ。Supabase/API接続が一切ない。

- **動作する機能**
  - `buildSuggestion()`(`src/engine/ruleBasedSuggestion.ts:108`)のタグ→テンプレート文字列マッピング自体は機能するが入力が固定サンプル
  - `naturalizeLastLine()`(Claude Haiku呼び出し)は実装があるが画面から未使用

- **ダミーデータの箇所**
  - `AiSuggestionsScreen.tsx:9` 「顧客タイプ別タグ定義（DBから取得するまでの静的マッピング）」
  - `AiSuggestionsScreen.tsx:28-35` 「各タイプのサンプル顧客プロフィール（DBに接続するまでのフォールバック）」`TYPE_PROFILES`
  - `AIProposalView.tsx:14-56` `AI_CONTENT`(顧客タイプ別固定advice/menu/option/ng/timing)。`customerType`分類のみで内容決定、個別データ未使用

- **API未接続箇所・Supabase未接続箇所**
  - `fetch('/api/...')`・`supabase.from(...)`ともに0件
  - `src/components/customer/AISuggestionCard.tsx`・`src/components/ai/AISuggestionCard.tsx`はDB由来データ表示を想定したpropsを持つが、**コードベース全体で一度もimportされていない**(完全な孤立コンポーネント)

- **本番利用できない理由**
  - 画面の核心価値である「顧客ごとのAI提案」が未実装。来店履歴・チャーンリスク・購買傾向との接続が一切ない
  - 想定されていた個別化コンポーネント(`AISuggestionCard.tsx`)が到達不可能なデッドコード

---

## 4. LINE画面

**ファイル**: `app/line/page.tsx`、`src/components/line/LineCrmDashboard.tsx`、`app/line/approve/page.tsx`

**総合判定: 部分完成** — Webhook受信・送信承認は実LINE Messaging APIに接続済み(本番トークン設定済み)。チャット一覧・配信・テンプレ機能はモック固定。

- **動作する機能**
  - `app/api/line/webhook/route.ts` 署名検証(HMAC-SHA256)・follow/unfollow処理・`line_user_ids`/`line_send_logs`への実INSERT/UPDATE
  - `app/lib/line/sender.ts:28` `fetch('https://api.line.me/v2/bot/message/push', ...)` — 本物のLINE Messaging API呼び出し
  - `app/api/line/approve/route.ts:87` 承認操作が実際に送信し`line_send_queue`/`line_send_logs`へ反映
  - `src/lib/line/lineQueueGenerator.ts` 優先度スコアリングして`line_send_queue`へ実INSERT(DEMO_MODEに関わらず実テーブル参照と明記)
  - `LineApprovalScreen.tsx`の承認/スキップ/編集は`useLineSendQueueStore`経由で実反映

- **ダミーデータの箇所**
  - `src/store/useLineStore.ts:73-95` `MOCK_THREADS`/`MOCK_AI`/`MOCK_TODAY`が初期state。`fetchThreads`/`fetchMessages`/`sendMessage`/`subscribeMessages`はDEMO_MODEで即return(`:209,246,316,368,390`)
  - `src/components/phase1/LineUnreadSheet.tsx:7` 「モック未返信データ」固定3件
  - `src/components/line/BroadcastSheet.tsx:8-15` 「estimated reach per segment (mock)」固定数値
  - `src/components/line/LineCrmDashboard.tsx:64-69` セグメント別カードの人数が配列内ハードコード
  - `src/components/line/ChatWindow.tsx:12-33` `TYPE_FALLBACK`の顧客タイプ別AI返信が静的テンプレート

- **API未接続箇所**
  - `BroadcastSheet.tsx:44` `// TODO: supabase.from('line_campaigns').insert({...})` — 一括配信ボタンは見せかけの成功表示のみで実際の保存・送信なし
  - `useLineStore.sendBroadcast()`は実装済みだがUIから呼ばれておらず未使用
  - `LineApprovalScreen.tsx:7`のコメント「実際の LINE 送信は未実装」は現状の実装と矛盾する古いコメント(誤情報)

- **Supabase未接続箇所**
  - `useLineStore`のチャット関連メソッドはDEMO_MODEで即return(`line_threads`/`line_messages`/`line_templates`へ実質未接続)
  - `src/lib/lineAdmin.ts`の`fetchCampaigns`等もDEMO_MODEで空応答(`line_campaigns`未接続)

- **本番利用できない理由**
  - チャット一覧・個別送受信・テンプレートが完全にモック固定(実際の会話が表示されず、送信してもDBに保存されない)
  - 一括配信は押しても何も保存されない
  - 本番投入時、スタッフが日常的に使うメイン画面(チャット/配信/テンプレタブ)は全てダミー表示・無反応になる。唯一実連携しているのは「送信承認」フローのみ

---

## 5. 音声メモ画面

**ファイル**: `src/components/customer/VoiceMemoSection.tsx`、`src/hooks/useVoiceRecorder.ts`、`app/api/voice-pipeline/route.ts`

**総合判定: 部分完成** — バックエンドのWhisper+Claudeパイプラインは本番品質だが、**画面に表示される文字起こし結果はこのパイプラインの出力を使わず、別の固定文言フォールバックを表示している**構造的な欠陥がある。

- **動作する機能**
  - 録音(MediaRecorder)・Storageアップロード(`voiceNote.ts:111`、bucket `voice-notes`)・`voice_notes`へのINSERT(`:126-138`)
  - `uploadVoiceNote`成功後`callPipelineApi`が`fetch('/api/voice-pipeline')`(`:198`)を呼び、OPENAI/ANTHROPIC両キー設定時はWhisper→Claude解析→`customer_notes`/`booking_prompts`/`handover_notes`/`contraindications`への保存が実際に動く
  - 過去メモ一覧取得・削除・再生URL取得は`voice_notes`/Storageへの実装

- **ダミーデータの箇所**
  - `src/lib/voice/streamPipeline.ts:96-100` `buildFallbackTranscript()` — 画面表示の「文字起こし」は録音時間だけで決まる固定文。Whisper未呼出
  - `streamPipeline.ts:214-218` 「Whisper endpoint not implemented」と明記、常にフォールバック分岐
  - `src/lib/voiceInsight/mockTranscript.ts` 「音声文字起こしのモック実装」と明記(現在は呼び出し元なしの未使用コード)
  - `app/api/voice-pipeline/route.ts:309-316` OPENAI_API_KEY未設定時は固定文をtranscriptとして使用(本番フォールバック経路)
  - `app/api/voice-pipeline/route.ts:148-171` `mockAnalysis()`(ANTHROPIC_KEY未設定時)
  - `src/lib/customerNotes.ts`等のDEMO用配列は`VOICE_NOTES_LIVE=true`のため現状到達不能(死んでいるが残存)

- **API未接続箇所**
  - 画面の「文字起こし」表示は本番API(`/api/voice-pipeline`)のレスポンスを購読していない(`runStreamPipeline`のみ参照)

- **Supabase未接続箇所**
  - `app/api/voice-pipeline/route.ts`と`app/api/voice/pipeline/route.ts`がほぼ同一内容で二重実装。クライアントが呼ぶのは前者のみで後者は到達経路不明(デッドコードの疑い)

- **本番利用できない理由**
  - 録音直後に画面表示される文字起こし・タグはAI解析結果ではなく固定文言で、スタッフに誤った情報を与える
  - 環境変数未設定の本番環境では保存されるtranscriptも固定テンプレートになり、4テーブルへの保存内容が全顧客で同質化(プライバシー上も懸念)
  - 同一ロジックのAPI Routeが2つ存在し保守上の混乱を招く

---

## 6. メニュー画面

**ファイル**: `app/menu/page.tsx` → `src/components/menu/MenuDashboard.tsx`、`src/store/useMenuStore.ts`

**総合判定: 未実装**(UIのみ完成、データ層は実質モック固定) — ストア初期値がモック、DEMO_MODEで実クエリ全て早期return、かつ画面がfetch系メソッドを一度も呼んでいない(3重の理由で本番データに到達不能)。

- **動作する機能**
  - フィルター/ソート切替、編集シート開閉、ローカルstate上のメニュー追加・編集・ON/OFF切替(永続化されない楽観的UI更新のみ)

- **ダミーデータの箇所**
  - `useMenuStore.ts:51-69,130-132` `MOCK_MENUS`(10件)/`MOCK_OPTIONS`(5件)がストアの初期値そのもの
  - `MenuDashboard.tsx:59` 「統計モック値（指示書準拠）」明記の`STATS`配列(総顧客数168名・売上¥1,280,000等)
  - `MenuDashboard.tsx:14-20,155,160` 「設定」タブが定義されるが`tab.key !== 'settings'`で意図的に無効化された死んだUI要素
  - `MenuDashboard.tsx:274-276` 「今月の売上は先月比120%です」固定文言、`BAR_HEIGHTS`静的配列
  - `src/components/menu/AIInsightPanel.tsx:18-44` insights文言はMOCK_MENUSから動的算出だが元データがモックのため実質固定値

- **API未接続箇所**
  - 専用API Routeは存在しない設計(Supabase直叩き設計のため該当なし)

- **Supabase未接続箇所**
  - `useMenuStore.ts` `fetchMenus`(:204)/`saveEdit`(:172)/`toggleActive`(:197)はDEMO_MODEで即returnし`salon_menus`への実クエリ(SELECT/UPDATE)が未実行
  - `fetchOptions`/`fetchAnalytics`はDEMO_MODEガード無しの実装だが`MenuDashboard.tsx`がマウント時に一度も呼んでいない(配線漏れ)
  - テーブル自体(`salon_menus`等)はmigrationに実在確認済みだが画面からは事実上未接続

- **本番利用できない理由**
  - 追加・編集・ON/OFF・サブスク設定が全てメモリ上のみでリロードで消える
  - DEMO_MODE=trueがグローバルで、音声メモのような個別救済フラグがメニュー機能には無い
  - ダッシュボード統計が実店舗データを一切反映せず全店舗で同じ固定値

---

## 7. 設定画面

**総合判定: 未実装(画面自体が存在しない)**

- 独立した「設定」ページ・ルート(`app/settings/page.tsx`等)はコードベースに存在しない
- `src/components/phase1/AppBottomNav.tsx`のボトムナビ4タブ(ホーム/顧客/KPI/メニュー)にも「設定」は含まれない
- `MenuDashboard.tsx`内の`FILTER_TABS`に「設定」というラベルのタブボタンが1つだけ存在するが、`isActive`判定・`onClick`ハンドラの両方で`tab.key !== 'settings'`という条件により明示的に除外されており、**クリックしても何も起きない**(`MenuDashboard.tsx:155,160`)
- 旧/未使用コンポーネント`src/components/StaffTopScreen/index.tsx`(現アプリのどこからもimportされていないデッドコード)にログアウトボタンはあるが、これも「設定画面」とは呼べない単発の機能ボタン
- **本番利用できない理由**: 設定機能(通知設定・営業時間・プロフィール編集・ログアウト等)を行う画面が一切存在しない

---

## 8. 横断的な発見事項(複数画面に共通する根本原因)

1. **`DEMO_MODE`グローバルフラグ(`src/lib/supabase.ts`)が最大の本番化ブロッカー**: KPI・顧客詳細(一部)・LINE・メニューの4画面で、Supabase接続コード自体は存在するのに`DEMO_MODE`チェックが先頭にあるため到達不能になっている。`VOICE_NOTES_LIVE`という個別救済フラグが音声メモ/顧客詳細の一部機能にのみ存在し、フラグ設計が一貫していない
2. **「配線漏れ」パターンの多発**: 実装済みのSupabase接続メソッド(`fetchOptions`/`fetchAnalytics`/`fetchCustomers`等)が、画面側のマウント処理(`useEffect`)から一度も呼ばれていないケースが複数の画面で見つかった(メニュー画面、KPI画面のStaffKpiCard等)。コードは存在するが「繋がっていない」
3. **孤立コンポーネント(デッドコード)**: `AISuggestionCard.tsx`(2種)、`StaffKpiCard.tsx`、`StaffRanking.tsx`、`AIInsightBox.tsx`、`StaffTopScreen`はいずれも他コードから一度もimportされていない
4. **API Route二重実装**: `app/api/voice-pipeline/route.ts`と`app/api/voice/pipeline/route.ts`がほぼ同一内容で存在し、片方はクライアントから到達できない疑いがある
5. **表示結果とDB保存結果の不一致**: 音声メモ画面で、画面に見える「文字起こし」とDBに実際に保存される内容が異なる経路で生成されており、スタッフが見ている情報と記録される情報が食い違う
6. **古い/誤ったコードコメント**: `LineApprovalScreen.tsx`の「実際のLINE送信は未実装」というコメントは現状の実装(実際に送信される)と矛盾しており、保守者を誤誘導する
