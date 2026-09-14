# サブスク決済分離Phase2 + 基本メニュー名解決 本実行報告(2026-09-14)

## 実行内容

`scripts/subscriptionPhase2Execution.ts --execute` により、以下を本番DB(Riora-System, `ohszxgajckzphhfhdrsv`)へ適用した。

- 対象: アーカイブCSV(`archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv`、342会計)のうちサブスク課金を含む136会計。除外なし(吉田雅様・大西璃子様を含む全件)。
- 純粋サブスク会計(CSV単位78件、同日複数会計の集約により実visit単位で**74件**): `brain_visits`をsoft delete(`deleted_at`設定)。
- 混在会計(**58件**): `treatment_amount`をサブスク分を除いた金額へ是正、うち**35件**は`menu_id`をBASE_TREATMENT_NAME_RESOLUTION(契約履歴ベースのコース名解決)で再解決。新規作成したメニュー5件: 「選べる肌改善コース」「契約コース（詳細不明）」「ヒト幹細胞ベーシック」「造顔＋小顔＋ヒト幹細胞」「ハーブピーリング＋ヒト幹細胞コース」。
- 影響顧客: 14名について、残存visitの`visit_count_at`を来店日昇順で振り直し(**40件**変更)。
- 事前バックアップ: `backups/20260914_subscription_phase2_pre_execution/`(Supabase Freeプランのため業務データの全体バックアップ機構が無く、対象行を手動でJSONエクスポート。件数一致確認済み)。

## 本実行中に発見・修正したバグ

`subscriptionPhase2Execution.ts`のbrain_subscription_payments書込みループが、visitのsoft delete/是正処理の**後**に実行される設計になっており、その中で顧客照合に`findByCustomerAndDate()`(`deleted_at IS NULL`条件)を再利用していた。純粋サブスク会計は直前のステップで対応visitを既にsoft deleteしているため、この時点で該当日のvisitが「存在しない」と判定され、**純粋サブスク会計74件(78会計・79明細)分のbrain_subscription_payments記録が全件スキップされていた**(soft delete・treatment_amount是正・menu_id再解決自体は正しく実行されていた)。

`scripts/fixMissingPureSubscriptionPayments.ts`を新規作成し、本実行前バックアップ(`brain_visits.json`、soft delete前の`customer_id`を保持)からcustomer_idを引いて欠落分を追加記録した(Dry Run確認後に`--execute`で適用)。氏名表記ゆれ(「碓井志歩」「斎藤美唯」がスペース無し表記でDB登録されていた)により初回は5件が顧客照合失敗したため、空白除去の正規化を加えて全78会計(79明細)を解決した。

**最終結果(検証済み)**: `brain_subscription_payments`合計144件(混在58会計分65件 + 純粋78会計分79件、うち`visit_id IS NULL`が79件)、soft deleteされたvisit 74件、想定どおり。

## 実機確認結果(2026-09-14、Playwright経由)

| 顧客 | 確認内容 | 結果 |
|---|---|---|
| 尾形 瞳様 | 来店回数表示 / 次回の目安 | 「来店5回」「次回目安 あと27日 / 推奨サイクル30日」。サブスク決済日のノイズが除去され妥当な周期で算出されていることを確認。 |
| 小宮山 仁美様 | 来店回数表示 | 「4回」(是正前は5回)。「今回の施術」欄がオプション名ではなく解決済みコース名を参照する状態に変わったことを確認(brain_menus再解決反映)。 |
| 大熊 萌様 | 来店回数・顧客ステータス(下記「新たに判明した副作用」参照) | 「0回」「来店0回目・初来店」表示。 |

### 新たに判明した副作用: 全来店が純粋サブスク会計だった顧客(大熊萌様)

大熊萌様(customer_id: `e85005e3-2365-4c31-9199-b0acfe88fd47`)は、観測期間中の来店9件が**全て**純粋サブスク会計(実施術・店販を伴わない決済のみ)だったため、是正後は`brain_visits`が0件(全件soft delete)になった。これにより:

- 顧客詳細画面: 「施術履歴未設定　来店0回」「来店0回目・初来店」とAIが実際には長期サブスク契約者であるにもかかわらず新規顧客として扱う。
- 顧客一覧「私のお客様」タブ: 表示されなくなった(来店履歴基準の絞り込みから外れるため)。「全顧客」タブでは引き続き表示される(140名、うち「私のお客様」は126名)。

これはサブスク決済分離Phase 1/2の設計(実施術を伴わない日はvisit扱いにしない)どおりの挙動だが、運用上「サブスクのみで通っている顧客が新規扱いに見える・一覧から消える」という見え方になる点は、今回のスコープ外の副作用として記録する。

本実行後にDBを確認したところ、同様に**残存visitが0件になった顧客は4名**確認された(いずれも「私のお客様」タブから消え、「全顧客」タブでのみ表示・AIが「初来店」扱いする状態):

| 顧客 | soft delete件数 |
|---|---|
| 大熊 萌様 | 9件 |
| 碓井 志歩様 | 4件 |
| 芦田 沙也加様 | 1件 |
| 斎藤 美唯様 | 1件 |

碓井志歩様・斎藤美唯様は`brain_customers.name`がスペース無し表記(「碓井志歩」「斎藤美唯」)で登録されている既存の表記ゆれも合わせて確認した(前述のbrain_subscription_paymentsバグ修正時に判明。今回は動作に支障が無いため未修正・記録のみ)。

## brain_proposal_outcomes の不整合(記録のみ・対応は今回のスコープ外)

soft delete対象74件のvisitを参照する既存`brain_proposal_outcomes`20件について、以下を確認した(2026-09-14方針: ソフトデリートのみ・子テーブルには触れない)。

- **表示上は消えない**: `OutcomeRepo.ts`の集計クエリ(`recent`/`create`/`listSinceByStore`)は`brain_visits`とJOINせず`customer_id`/`store_id`等で直接検索するため、参照先visitがsoft deleteされても**そのまま表示され続ける**(AI提案分析ダッシュボード・`/api/admin/proposal-analytics`・`/api/admin/proposals/feedback`等)。
- **既知の不整合**: これら20件が保持する`visit_count_at`は今回是正の対象外のため、対応する`brain_visits`側で行われた来店回数の振り直し後の値と食い違ったまま残る(古い来店回数のまま)。来店回数別にAI提案の成果を集計する分析(`aggregateProposalAnalytics.ts`等)を行う場合、この20件分だけ実際の来店回数とズレた回数で集計される可能性がある。
- 対応方針: 今回は据え置き。影響が顕在化した場合(分析結果の解釈に支障が出た場合)、`visit_count_at`を是正済みの値へ更新するか、該当行を無効化するかの判断を別途行う。

## brain_visit_retail_items(参考・変更なし)

soft delete対象visitを参照する既存2件は、`/api/customers/[id]/homecare-products`が`brain_visits`を`deleted_at IS NULL`で絞り込んだ`visit_id`のみを対象にするため、**該当商品の累計金額(totalAmount)集計から見えなくなる**(該当顧客のホームケア使用商品の累計金額がその分減って見える)。今回は対応せず記録のみ。

## 関連ファイル

- 実行スクリプト: `scripts/subscriptionPhase2Execution.ts`
- バグ修正スクリプト: `scripts/fixMissingPureSubscriptionPayments.ts`
- 統合Dry Run(投資判断用): `scripts/phase2_integrated_dry_run.ts`
- 事前バックアップ: `backups/20260914_subscription_phase2_pre_execution/`(`.gitignore`対象・コミットしない)
- コード変更本体: `src/lib/import/salonBoardDetailParser.ts`, `csvImportPipeline.ts`, `runMenuReclassification.ts`, `csvImportQualityReport.ts`, `subscriptionCourseNameResolver.ts`(新規), `src/repositories/interfaces.ts` / `SubscriptionPaymentRepo.ts`(`listByCustomer`追加)
