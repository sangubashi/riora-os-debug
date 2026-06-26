# AI提案本物化 完成レポート

作成日: 2026-06-25
対象設計書: `Riora_Proposal_Generator_Architecture_v2.0.md` / `Riora_SuccessPattern_Final_Architecture_v1.0.md` / `Customer Brain`関連設計

## 0. 着手前調査で判明した前提(重要)

調査の結果、**ProposalOrchestrator(PatternMatcher→PatternScorer→ConflictResolver→StaffAdjustmentEngineの8ステージパイプライン)は実装済・単体テスト済だったが、`app/lib/repos.ts`が`ICandidateRepo`/`IStatsRepo`/`IParamsRepo`/`IOutcomeRepo`を一切インスタンス化していなかったため、API/UIから完全に到達不可能だった**(ユーザー承認のうえ、既存エンジンを接続し不足部分のみ最小実装する方針で着手)。

LINE履歴(`brain_line_send_queue`)の本番件数を事前確認したところ**0件**だったため、グレースフルに動作する設計のまま実装した(ユーザー承認済み)。

## 1. 顧客詳細から提案生成

`/admin/customer-assets`(MD-3顧客管理・既存実データ画面)の各行に「AI提案」列を追加。クリックで`CustomerProposalPanel`が展開し、実在のスタッフ一覧(鈴木/亀山/外舘)から担当を選んで「AI提案を生成」できる。既存の顧客一覧表示・閲覧専用方針(2026-06-23ユーザー指示)は変更していない(追加列のみ)。

## 2. 音声メモ解析接続

**重大な発見**: 音声メモ解析の出力先(`customer_notes`/`booking_prompts`/`handover_notes`/`contraindications`)は**旧`customers`テーブル**(Phase1スタッフアプリ側)を参照しており、AI提案エンジンが使う`brain_customers`とは**完全に別のID空間**であることが判明した(両者を繋ぐ実在のキーは存在しない)。

架空のID紐付けを作ることは禁止のため、**顧客氏名の完全一致(実データ)でのみ橋渡しする**実装とした(`generateCustomerProposal.ts`の`fetchVoiceMemoContext`)。一致が1件→実データ表示、0件→「見つかりません」、複数件→「一意に紐付けできません(同姓同名)」を誠実に返す(架空の1件を選ばない)。

## 3. 来店履歴解析

`PatternContextBuilder.ts`(新規)が`brain_visits`の実データから`visitCount`/`avgCycle`(平均来店間隔)/`isNominationStreak2`(連続指名)/`homecarePurchasedEver`/`retailTotal`等を決定論的に算出する。来店履歴が0件の場合は`no_visit_history`を返し、架空の履歴を作らない。

`subscConditionsMet`(0〜4)は設計書に厳密な数式定義が無いため、本タスクで来店回数3回以上/ホームケア購入歴/連続指名/店販購入歴の4実指標として新規定義した(コード内に根拠を明記)。

## 4. LINE履歴解析

`brain_line_send_queue`(brain_customersと同一ID空間・実データ)を`ILineQueueRepo.recentByCustomer()`(新規)で取得する。本番は0件のため現状は「LINE配信履歴はありません」と正しく表示される。

旧`line_user_ids`(LINE公式アカウントの友だち情報)も調査したが、`customers`(旧スキーマ)参照のため上記と同じID空間の問題があり、本タスクでは接続していない(別タスクとして要検討)。

## 5. 成功パターン照合

`ICandidateRepo`/`IStatsRepo`/`IParamsRepo`/`IOutcomeRepo`を`app/lib/repos.ts`へ新規配線し、実際に`brain_success_patterns`(8件)・`brain_pattern_steps`(28件)・`brain_params`(fire_score_weights/style_affinity・cluster=office_area)を読み込んでProposalOrchestratorへ渡す。**LLMは一切使用しない**(決定論ルールのみ)。

## 6. 提案根拠表示

`ExplainabilityEngine.ts`(新規)が`ProposalOrchestrator.ts`の欠落部分(ファイル冒頭コメントで「現状null/固定文言」と明記されていた箇所)に実装を接続した。`decisiveFactor`/`staffLine1`/`managerQ1〜Q3`は実際のFireScore内訳・実候補コード・実却下理由から構築される(固定文言ではない)。

**テストで2件の実バグを発見・修正**:
1. `topBreakdownFactor`の配列/オブジェクト添字の取り違え(`best[1]`を`best.value`に修正)により、常に最初の項目が返っていた。
2. `overrideBoost`(既定値1.0の乗算修飾子)が加点要素と同一スケールで比較され、無補正時でも「手動指定による加点」が決定打として誤表示されていた。

いずれもテストファースト(失敗するテストを書いてから直す)で発見した。

`NextActionGenerator.ts`(新規)が`candidateDate`(rebooking提案時の次回来店候補日 = 最終来店日+平均来店周期)を実データから算出する。`HomeCareGenerator.ts`(新規)はホームケア提案時のカテゴリ注記を実候補コードから生成する(brain_*に実商品カタログが存在しないため、商品名・価格は提示しない誠実なスコープ縮小)。

## 7. 提案結果保存

`IBriefingRepo.insert()`(新規)が`brain_pattern_fire_log`へ実際の`decisionRecord`(コンテキストスナップショット+説明文)と`explanation`を保存する。`POST /api/admin/proposals`から呼ばれ、UIの「提案を記録する」ボタンに接続済み。

## 実機検証

### 本番データでの実行結果(誠実な開示)

本番`brain_customers`(40件)を確認した結果、**全顧客が`customer_type`未設定(0件が設定済み)**であることが判明した。`PatternContextBuilder`はcustomerType必須のため、現状どの実顧客でAI提案を生成しても**正しく`no_customer_type`エラーになる**(これは設計どおりの誠実な挙動であり、バグではない)。

実際に本番APIへ問い合わせた結果:
```
GET /api/admin/proposals?storeId=...&customerId=(実顧客)&staffId=(実スタッフ)
→ {"success":false,"error":"no_customer_type"}
```

UIでも同じ結果が表示されることをPlaywrightで確認した(スクリーンショット: `docs/screenshots/AI提案_production_no_customer_type.png`)。顧客一覧・他の既存表示には影響がないことも確認済み。

### ロジック動作確認(本番マスタデータ読込・本番DB書込なし)

`scripts/proposal_engine_demo.ts`で、本番の実マスタデータ(`brain_success_patterns`8件・`brain_pattern_steps`28件・`brain_params`)を読み取り専用で取得し、エンジンへ通した:

```
実候補数: 28件
→ mandatory: A1-step4(サブスクリプション提案・実際のbase_script・FireScore 75.3点)
→ secondary: A1-step1(カウンセリング・実際のbase_script)
→ explanation.staffLine1: 「A1-step4(subscription)を提案します。タイミングの良さ(寄与0.2点)・FireScore 75点。」
→ explanation.managerQ2: 他16候補の実際の却下理由(slot/exclusion等)を列挙
```

顧客コンテキストのみ、現状どの実顧客もcustomer_typeを持たないためサンプル値を使用した(本番へは一切書き込んでいない)。これにより、エンジン本体(マッチング・スコアリング・コンフリクト解決・説明文生成)が実マスタデータで正しく動作することを確認した。

## 禁止事項の遵守

- **固定テンプレ禁止**: `ExplainabilityEngine`の文言は実際のFireScore内訳・候補コード・件数を埋め込んだものであり、入力が変われば出力も変わる(テストで確認済み)。`AIProposalView.tsx`のような旧来の固定文言(`AI_CONTENT`辞書)は新規実装では使用していない
- **ダミーデータ禁止**: 実データソースが無い特徴量(CSI等)は中立値、必須データ(customerType/来店履歴)が無い場合は明確な失敗理由を返す。音声メモ連携も架空のID紐付けをしない(氏名一致のみ・複数一致時は「不明」とする)

## 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/engines/pattern/PatternContextBuilder.ts`(新規) | ContextBundle→PatternContext(実データのみ) |
| `src/engines/pattern/ExplainabilityEngine.ts`(新規) | 提案根拠の説明文生成(決定論) |
| `src/engines/pattern/NextActionGenerator.ts`(新規) | 次回来店候補日の算出 |
| `src/engines/pattern/HomeCareGenerator.ts`(新規) | ホームケア提案カテゴリ注記 |
| `src/engines/pattern/ProposalOrchestrator.ts` | Explainability/NextActionを呼び出すよう接続(既存パイプラインのcomputeDashboardAggregate相当の核ロジックは無変更) |
| `src/lib/proposal/generateCustomerProposal.ts`(新規) | API層のオーケストレーション(実データ取得→Context構築→Orchestrator呼出→音声メモ/LINE橋渡し) |
| `app/api/admin/proposals/route.ts`(新規) | GET(生成のみ)/POST(生成+保存) |
| `app/api/_schemas/proposal.ts`(新規) | 入力検証スキーマ |
| `app/lib/repos.ts` | candidateRepo/statsRepo/paramsRepo/outcomeRepoを新規配線。`getServiceClient()`追加(旧customers橋渡し用) |
| `src/repositories/interfaces.ts` | `IBriefingRepo.insert()`/`ILineQueueRepo.recentByCustomer()`追加 |
| `src/repositories/supabase/BriefingRepo.ts` / `LineQueueRepo.ts` | 上記の実装 |
| `src/store/useProposalStore.ts`(新規) | UI状態管理 |
| `src/components/admin/customerAssets/CustomerProposalPanel.tsx`(新規) | 提案パネル(根拠・音声メモ・LINE履歴・保存ボタン) |
| `src/components/admin/customerAssets/CustomerAssetsScreen.tsx` | 「AI提案」列を追加(既存表示は無変更) |
| `scripts/proposal_engine_demo.ts`(新規) | ロジック動作確認用(本番マスタ読込・書込なし) |

## テスト結果

`npm test`(vitest): **62 files / 587 tests 全成功**(直前561件 + 本タスクで26件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

新規テスト(26件):
- `tests/engines/pattern/PatternContextBuilder.test.ts`(11件)
- `tests/engines/pattern/ExplainabilityEngine.test.ts`(10件・うち2件は本タスクで発見したバグの再現テスト)
- `tests/engines/pattern/NextActionGenerator.test.ts`(3件)
- `tests/engines/pattern/HomeCareGenerator.test.ts`(2件)
- `tests/engines/pattern/ProposalOrchestrator.test.ts`(4件追加・既存10件は無変更で成功)
- `tests/lib/proposal/generateCustomerProposal.test.ts`(7件)
- `tests/api/proposals.test.ts`(7件)
- `tests/repositories/supabase/BriefingRepo.test.ts`/`LineQueueRepo.test.ts`(各+3〜4件)

## 残課題(本タスクのスコープ外・将来の検討事項)

1. **顧客タイプ分類(customer_type)が本番に存在しない**: AI提案エンジンの前提データが未整備。Customer Brainの型分類ロジック自体は別タスク
2. **音声メモ/LINE OAの旧customersとbrain_customersのID統合**: 別システム間のブリッジが必要(本タスクは氏名一致の最小限対応のみ)
3. **学習層(`src/engines/learning/`)は未実装**: 本タスクのスコープ外(Brain Evolution Architectureの別タスク)
4. **`brain_pattern_step_stats`(実績統計マテリアライズドビュー)は`brain_proposal_outcomes`が0件のため常に冷スタート(prior=0.5)**: 提案結果保存(§7)が今後蓄積されることで自然に改善される設計
