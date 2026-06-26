# DEMO_MODE / VOICE_NOTES_LIVE 完全棚卸し調査

作成日: 2026-06-23
種別: 調査レポートのみ(コード変更は行っていない)

対象: `src/lib/supabase.ts`で定義される2つのグローバルフラグ
```ts
export const DEMO_MODE = true        // デモモード: true = モックデータ使用
export const VOICE_NOTES_LIVE = true // Voice Memo機能のみ実DB保存を有効化
```
および、これらを参照する**全49ファイル**(`DEMO_MODE`)・**全12ファイル**(`VOICE_NOTES_LIVE`、いずれも`DEMO_MODE`参照ファイルの部分集合)。

---

## 0. 最重要の発見(全体に影響する前提条件)

**`DEMO_MODE`を単純に`false`にすると、認証そのものが壊れる。**

`app/ClientShell.tsx:79` の自動サインインEffectが `if (!DEMO_MODE) return` でガードされている。つまり**自動サインイン機能自体が`DEMO_MODE=true`の間しか動かない**(`admin@salon-riora.jp`への自動ログイン)。一方、`app/ClientShell.tsx:17-28`の`PUBLIC_PATHS`には`/customers`/`/kpi`/`/line`/`/menu`/`/ai-suggestions`/`/phase1`等、**スタッフアプリの主要画面のほぼ全てが「認証不要パス」として固定的に列挙されている**(`DEMO_MODE`の値に関わらず不変)。

この2つを組み合わせると、`DEMO_MODE=false`にした瞬間に起きることは:
1. 自動サインインが停止 → `session`が確立されない
2. しかし`PUBLIC_PATHS`は主要画面を「公開パス」のままにしているため、`/login`へは飛ばされない(`:94-105`)
3. 結果、`session=null`のまま主要画面が表示され、各ストアの`DEMO_MODE || session`のような分岐(例: `CustomersScreen.tsx:285`)が**両方false**になり、データ取得処理自体が呼ばれなくなる
4. さらに、`if (DEMO_MODE) return`で止まっていた各ストアの実Supabase呼び出しが解放されても、**未認証状態で実行される**ため、RLS(Row Level Security)が`auth.uid()`を要求するテーブルへのアクセスはエラーまたは0件になる

→ **「DEMO_MODEをfalseにする」だけでは本番化は成立せず、むしろ現状動いている部分(顧客一覧等)まで巻き込んで壊れる。** 認証フローの分離(自動サインインのDEMO_MODE依存を切り離す、またはPUBLIC_PATHSを見直す)が、他の修正に先立つ前提条件である。

---

## 1. DEMO_MODEにより停止している機能一覧

DEMO_MODE(または`DEMO_MODE && !VOICE_NOTES_LIVE`の複合条件)によって、モックデータ表示・処理スキップが発生している箇所。

### 1-1. lib層(ロジック・Repository相当)

| ファイル:行 | 条件 | 停止している内容 |
|---|---|---|
| `src/lib/aiMemory.ts:168,194` | `DEMO_MODE`単体 | `customer_memories`への保存・取得(`VOICE_NOTES_LIVE`を見ないため、他のVoice系と非対称に常時停止) |
| `src/lib/actionLog.ts:97` | `DEMO_MODE`単体 | `fetchRecentActions`が`customer_action_logs`を読まず`DEMO_ACTIONS`固定表示(同ファイルの`logAction`(:58)は`VOICE_NOTES_LIVE`を見て書込は実行されるため、**書込と読込が非対称**) |
| `src/store/useKpiStore.ts:195,276,304,330,364,392` | `DEMO_MODE`単体 | `daily_kpi_snapshots`/`weekly_sales`/`staff_daily_rankings`/`kpi_insights`の取得・Realtime購読が全停止 |
| `src/store/useKpiSqlStore.ts:54-58,82` | `DEMO_MODE`単体(`isMockMode()`) | `reservations`/`profiles`/`customers`/`line_logs`への7種クエリが全停止(`fetchAll`が実質何もしない関数になっている) |
| `src/store/useHomeStore.ts:156-161,207,266,286` | `isMockMode()`(現在値はfalseだが`DEMO_MODE`単体チェックも内包) | 状況による(1-2参照) |
| `src/store/useLineStore.ts:209,246,273,316,337,352-355,368,390` | `DEMO_MODE`単体 | チャット一覧・メッセージ・テンプレート・配信・Realtime購読が全停止(`line_threads`/`line_messages`/`line_templates`/`line_broadcasts`) |
| `src/lib/lineAdmin.ts:5,20,31,41` | `DEMO_MODE`単体 | `line_campaigns`の取得・承認・編集・削除が全停止 |
| `src/store/useMenuStore.ts:131-132,172,197,205` | `DEMO_MODE`単体 | `salon_menus`の取得・編集保存・ON/OFF切替が全停止(ただし呼び出し元も無いため後述1-2と二重の停止要因) |
| `src/store/useImprovementLogStore.ts:75,80,96-104,113-122,130-136,148-165` | `DEMO_MODE`単体 | `improvement_action_logs`/`improvement_revenue_links`の取得・追加・完了・売上紐付けが全停止 |
| `src/lib/import/SalonBoardSaveEngine.ts:133,175` | `DEMO_MODE`単体 | CSV取込確定処理が`customers`/`customer_visits`/`customer_action_logs`への保存をスキップし、「保存スキップ」エラーメッセージを返す |
| `src/lib/phase5/customerRiskEngine.ts:250` | `DEMO_MODE`単体 | `customer_action_logs`/`voice_notes`からのリスク判定材料取得が固定値化 |
| `src/lib/storeLearningRepository.ts:78` | `DEMO_MODE`単体 | `store_patterns`取得が停止 |
| `src/lib/phase8/successPatternEngine.ts:26` | `DEMO_MODE`単体 | `staff_logs`集計が停止 |
| `src/lib/nextAction/generateNextActions.ts:97,118,135` | `DEMO_MODE`単体 | `voice_notes`/`customer_action_logs`参照が固定値化 |
| `src/lib/roleGuard.ts:5,22,28` | `DEMO_MODE`単体 | `profiles`からのロール取得が停止、常に`'staff'`/`'demo-user'`を返す |

### 1-2. UIコンポーネント層

| ファイル:行 | 条件 | 停止している内容 |
|---|---|---|
| `src/components/customer/CustomerInsightPanel.tsx:53-56` | `DEMO_MODE`単体 | `voice_notes`からの`insight_tags`集計・パネル表示が停止(常に非表示) |
| `src/components/customer/CustomerBottomSheet.tsx:308-320,498-505,518-536,556-567` | `DEMO_MODE`単体(4箇所) | 肌タグ初期表示・肌タグ保存・接客ログ保存・メモ保存が全てローカルのみで`customers`/`staff_logs`/`customer_notes`へ反映されない |
| `src/components/kpi/CustomerAnalyticsPanel.tsx:23` | `!DEMO_MODE`の否定形 | (DEMO_MODE=true中は常に表示継続するための条件。データ自体は`useAnalyticsStore`のモック値) |
| `app/ClientShell.tsx:98,109` | `DEMO_MODE`単体 | ログイン未済時の`/login`リダイレクト、認証中ローディング表示が無効化 |

### 1-3. VOICE_NOTES_LIVE=trueにより「既に解除済み」の機能(参考)

以下は`DEMO_MODE && !VOICE_NOTES_LIVE`という複合条件のため、現在値(`VOICE_NOTES_LIVE=true`)では**既に実DB接続が有効**になっている(停止していない):
`src/lib/aiTimeline.ts`、`src/lib/voiceNote.ts`(全4箇所)、`src/lib/contraindication.ts`、`src/lib/handover.ts`、`src/lib/bookingPrompt.ts`、`src/lib/customerNotes.ts`、`src/lib/actionLog.ts`の`logAction`(:58のみ)。

---

## 2. Supabase接続済みだが到達不能な機能一覧

コード自体は`supabase.from(...)`を使った完成した実装があるにもかかわらず、フラグ以外の理由で実行されない箇所。

### 2-1. 呼び出し元が存在しない(配線漏れ)

| 関数 | ファイル | 状態 |
|---|---|---|
| `fetchMenus`/`fetchOptions`/`fetchAnalytics` | `src/store/useMenuStore.ts:205,273,288` | `salon_menus`/`salon_menu_analytics`への完成クエリがあるが、`MenuDashboard.tsx`がマウント時に一度も呼んでいない。**DEMO_MODEをfalseにしても画面は変化しない** |
| `StaffKpiCard.tsx`(`staff_logs`への実クエリ) | `src/components/kpi/StaffKpiCard.tsx:54-58` | `KpiDashboard.tsx`からimportされていない孤立コンポーネント |
| `StaffRanking.tsx`/`AIInsightBox.tsx` | `src/components/kpi/` | 同様に`KpiDashboard.tsx`から未使用 |
| `AISuggestionCard.tsx`(2種) | `src/components/customer/`、`src/components/ai/` | DB由来データ表示を想定したpropsを持つが、コードベース全体で一度もimportされていない |

### 2-2. テーブル名の不一致疑い(実在未確認)

| ファイル | 参照テーブル/RPC | 疑いの内容 |
|---|---|---|
| `src/store/useHomeStore.ts:266` | `kpi_today` | `useKpiStore.ts`は同種の指標を`daily_kpi_snapshots`という別名で参照しており、命名が一致しない。いずれかが存在しない可能性が高い |
| `src/store/useKpiSqlStore.ts`(LINE返信率関連) | `line_logs` | `useLineStore.ts`では同種の機能を`line_threads`/`line_messages`という別テーブル名で参照。`line_logs`は他に出現せず実在が疑わしい |

### 2-3. 表示結果と保存結果が異なる経路(音声メモ画面・既知)

前回タスク(PHASE1完成度レビュー)で確認済み: `app/api/voice-pipeline/route.ts`はWhisper+Claudeで実解析・実保存するが、`VoiceMemoSection.tsx`が画面に表示する文字起こしは`src/lib/voice/streamPipeline.ts`の`buildFallbackTranscript()`(録音時間ベースの固定文)を見ており、本番APIの結果を購読していない。DEMO_MODEとは無関係の配線ミス。

### 2-4. グローバルフラグと無関係な独立フラグ(誤認しやすい設計)

| ファイル | 内容 |
|---|---|
| `src/lib/analytics/ActionCoachGenerator.ts` | `DEMO_MODE`をimportしておらず、呼び出し元から渡されるローカル引数`demoMode`で分岐。グローバルフラグを`false`にしても無関係 |
| `src/lib/analytics/SuccessPatternAnalyzer.ts` | 同上(ローカル引数`demoMode = false`がデフォルト) |
| `src/lib/analytics/RevenueAttributionEngine.ts` | `DEMO_MODE`をimportしているが条件式としては未使用(デッドインポート)。`linkRevenueToActions()`の実行は呼び出し元の選択次第 |
| `src/lib/roleSystem.ts` | Supabase非依存。`isDemoMode()`は`DEMO_MODE`を見るが、これは`?demo=1`クエリ判定の有無を切り替えるだけの別レイヤー |

---

## 3. DEMO_MODE=false化した場合の影響範囲

### 3-1. 即座に壊れるもの(新規の regression)

- **認証**: §0の通り、自動サインインが停止し、`session=null`の状態で主要画面が表示され続ける(PUBLIC_PATHSの存在により`/login`へは飛ばない)
- **`CustomersScreen.tsx:285`** `DEMO_MODE || session`が両方falseになり、`fetchCustomers()`が呼ばれず顧客一覧が空になる(現在は動いている機能が壊れる)
- **`useCustomerStore.ts`の未認証フォールバック(:122-127)**: `DEMO_MODE`チェックが`false`になるため、従来の「未認証→MOCK_CUSTOMERSへフォールバック」が「未認証→`customers:[], errorMsg:'未認証'`」のfail-closedに変わる(モック表示すら出ず空白になる)
- **RLS保護下のテーブルへの未認証アクセス**: KPI系(`daily_kpi_snapshots`等)・LINE系(`line_threads`等)・メニュー系(`salon_menus`)のクエリが解放されても、認証なしで実行されるためRLSにより0件/エラーになる可能性が高い

### 3-2. 即座に動くようになるもの(認証が別途確保されている前提)

仮に認証問題(§0)を先に解決した場合、以下はSupabase接続コードが完成しているため追加実装なしで動く:
- `CustomerBottomSheet.tsx`の肌タグ/接客ログ/メモ保存(4箇所)
- `CustomerInsightPanel.tsx`のinsight_tags集計
- `contraindication.ts`/`handover.ts`/`bookingPrompt.ts`/`customerNotes.ts`(すでにVOICE_NOTES_LIVEで解放済みのため変化なし)
- `lineAdmin.ts`のキャンペーン管理(`line_campaigns`)
- `useImprovementLogStore.ts`の改善ログ機能(`improvement_action_logs`)
- `roleGuard.ts`の実ロール判定(`profiles`)
- `SalonBoardSaveEngine.ts`のCSV確定保存

### 3-3. 変化しないもの

- メニュー画面(配線漏れのため、フラグに関係なく不変)
- AI提案画面(そもそもDEMO_MODE分岐が存在せず、常時固定テンプレート)
- 設定画面(画面自体が存在しないため対象外)
- `kpi_today`/`line_logs`等、テーブル名不一致が疑われる箇所(フラグを変えてもエラー/0件のまま)

### 3-4. UI上で新たに発生しうる問題

- `CustomerAnalyticsPanel.tsx:23`の`!DEMO_MODE && totalCustomers===0`が成立し、`useAnalyticsStore`に実データが投入されていない限りパネルが急に非表示になる(これまでは常時表示だった)
- ページ単位の認証ガード(`app/customers/page.tsx`の`supabase.auth.getSession()`チェック)と`ClientShell.tsx`のPUBLIC_PATHSが矛盾し、画面ごとに認証要求の有無が一貫しなくなる

---

## 4. 本番化可能な画面一覧

「DEMO_MODE=false化(+§0の認証問題を解決)」を行った場合に、**追加実装なしで本番相当の動作が期待できる範囲**を画面単位で評価。

| 画面 | 本番化可能な範囲 | 本番化できない/別途必要な範囲 |
|---|---|---|
| **顧客詳細画面** | 肌タグ・接客ログ・メモの保存、insight_tags集計、音声メモ・引継ぎ・禁忌情報(VOICE_NOTES_LIVEで既に稼働) | VIP類似度/昇格シミュレーター(`DEMO_ANALYTICS_CUSTOMERS`固定、データソース未接続のため別実装が必要) |
| **LINE画面** | チャット一覧・個別チャット送受信・テンプレート(`line_threads`/`line_messages`/`line_templates`が実在する前提)、キャンペーン管理 | 一括配信(`BroadcastSheet.tsx`のTODOコメントの通り未実装)、`line_broadcasts`/`line_campaigns`等テーブルの実在性は未検証 |
| **KPI画面** | 改善ログ機能(`useImprovementLogStore`) | 当日KPI/週次/スタッフランキング/インサイト(テーブル名不一致疑いのため要DB確認)、OccupancyHeatmap/RepeatAnalytics/AI戦略カード(Supabase接続自体が存在せず追加実装が必要)、CSV取込連動の分析パネル2種(配線修正必要) |
| **音声メモ画面** | 録音・保存・解析パイプライン自体(既にVOICE_NOTES_LIVEで稼働) | 画面表示の文字起こしが本番APIの結果と異なる経路(別途配線修正が必要、フラグとは無関係) |
| **メニュー画面** | なし(配線漏れのため`DEMO_MODE=false`だけでは無変化) | `fetchMenus`等の呼び出し元配線が必須 |
| **AI提案画面** | なし(DEMO_MODE分岐が存在しない静的画面) | 個別化機能そのものの新規実装が必要 |
| **設定画面** | 該当なし(画面が存在しない) | 新規実装が必要 |

---

## 5. 修正工数見積り

前提: 1人日=実働1日。DB側(テーブル実在性・RLSポリシー)の調査・調整は別途必要となる可能性があり、見積りには「コード修正」のみを含み「DB/Supabase側の設定作業」は含まれない(判明している場合は注記)。優先順位は付けず、項目ごとに独立した見積りとする。

| # | 項目 | 内容 | 見積り |
|---|---|---|---|
| 1 | **認証フローの分離(最優先・前提条件)** | 自動サインインのDEMO_MODE依存解除、またはDEMO_MODEと無関係な恒久ログイン機構の整備。PUBLIC_PATHSの扱い再検討 | 0.5〜1日(設計判断含む) |
| 2 | **顧客詳細画面の本番化** | DEMO_MODE分岐除去+実機検証(4箇所)。VIP類似度/昇格機能の実データ接続は別実装 | 0.5日(基本部分)+1〜2日(VIP機能) |
| 3 | **LINE画面の本番化** | チャット系3関数のフラグ解除+実機検証、`line_threads`等テーブル実在性確認、一括配信の新規実装(TODO実装) | 1日(基本部分)+2〜3日(配信機能+テーブル検証) |
| 4 | **KPI画面の本番化** | テーブル名不一致の解消(`kpi_today`/`line_logs`の調査・修正)、改善ログ機能の解除+検証、OccupancyHeatmap等4箇所の新規Supabase接続実装、CSV連動分析パネル2種の配線修正 | 3〜5日 |
| 5 | **音声メモ画面の表示修正** | streamPipelineを本番APIレスポンス購読に変更、重複API Route(`voice-pipeline`/`voice/pipeline`)の整理 | 1〜2日 |
| 6 | **メニュー画面の本番化** | `fetchMenus`等の呼び出し配線追加、死んだ「設定」タブの除去または実装判断、`salon_menus`テーブル実在性確認 | 1〜2日 |
| 7 | **AI提案画面の新規実装** | 顧客個別データ接続・孤立コンポーネント(`AISuggestionCard.tsx`)の活用、提案ロジックの個別化 | 5日以上(実質新規機能) |
| 8 | **設定画面の新規実装** | 画面が存在しないため、要件確定(通知設定/営業時間/プロフィール/ログアウト等のスコープ)から | 2〜3日(スコープ確定後) |
| 9 | **横断的なテーブル名・RLS整合性検証** | 想定テーブル名と実DBスキーマの突き合わせ、RLSポリシーの認証要件確認(本番ログインユーザーで全クエリが通るか) | 1日 |

**合計目安: 約17〜25人日**(#1を除く各項目は独立して着手可能だが、#1未完了のまま#2以降を本番化しても§0の認証問題により正しく動作しない点に注意)。

---

## 6. 補足: フラグ設計上の一貫性に関する所見(参考情報)

調査の過程で、修正対象ではないが今後の判断材料となる設計上の非対称性を以下にまとめる(指摘のみ、対応の要否はユーザー判断):

- `isMockMode()`(`useCustomerStore.ts`/`useHomeStore.ts`)は`DEMO_MODE && !VOICE_NOTES_LIVE`という複合条件だが、同じファイル内の他の`if (DEMO_MODE)`単体チェックと意味が異なり、1ファイル内に2種類のフラグ判定基準が混在している
- `aiMemory.ts`は音声メモに付随する機能と思われるが`VOICE_NOTES_LIVE`を見ておらず、他のVoice関連ファイルと非対称
- `actionLog.ts`は書込(`logAction`)がVOICE_NOTES_LIVE対応済みだが読込(`fetchRecentActions`)は対応しておらず、保存したのに一覧に出ない状態になりうる
- `LineApprovalScreen.tsx`(別タスクのPHASE1レビューで既に指摘済み)に「実際のLINE送信は未実装」という、現状の実装(実際に送信される)と矛盾する古いコメントが残っている
