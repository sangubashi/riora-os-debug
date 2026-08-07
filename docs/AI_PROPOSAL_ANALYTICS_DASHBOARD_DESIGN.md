# AI提案分析ダッシュボード（データ蓄積の可視化）調査・設計書

作成日: 2026-08-07（同日、MVP方針確定を追記）
ステータス: **MVP実装完了・実データ確認済み**（2026-08-07。tsc/build/テスト/実データAPI確認まで
完了。commit/pushは未実施・ユーザー承認待ち。詳細は§7「実装完了報告」参照）

## 更新履歴
- 2026-08-07: 初版提出。
- 2026-08-07: ユーザーがMVP方針を確定。(1)実施率はbrain_proposal_outcomes分母のみ採用、
  fire_log分母版は不採用。(2)施術一致率はwas_executedベースの現状定義(解釈A)を採用、
  メニュー突合の厳密一致(解釈B)は将来タスク。(3)FireScore分布・スタッフ別利用率はMVP除外
  (fire_scoreが常にNULLのため、データ蓄積を優先)。(4)`staff_logs`のスキーマ不整合は本設計から
  切り離し、別設計書(`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`)にまとめる。§2・§4を更新した。

## 0. 要約

[[project_staff_proposal_learning_pipeline_design]]（`docs/STAFF_PROPOSAL_LEARNING_PIPELINE_DESIGN.md`）
で本番反映した「スタッフ実利用のAI提案をbrain_pattern_fire_logへ記録する」機能を土台に、
「AI提案がどれだけ使われ、どれだけ成果につながっているか」を管理者が見える化するダッシュボードを
調査・設計した。**実装はまだ開始していない。**

先に結論を2点:

1. **「AI提案分析」ダッシュボードは既に1つ存在する**（`/admin/proposal-feedback`、AI提案学習Phase2）。
   ただしこれは`brain_pattern_fire_log.decision_record.staffFeedback`(👍👎)だけを集計する画面で、
   👍👎はadmin専用ツール(`CustomerProposalPanel.tsx`)からしか押せない。**実データ実測(§1.5)では
   直近fire_log 176件中、staffFeedbackが付いているのは0件**。今回ユーザーが要望している「表示数・
   実施率・採用率・施術一致率・パターン別成功率・FireScore分布・スタッフ別利用率・月別推移」は、
   この画面が今カバーしていない範囲。**新規画面を作るのではなく、この既存画面を拡張するのが
   自然**という設計方針を§4で提案する。
2. **調査の過程で、今回のスコープには直接関係しない重大な副次発見があった**（§1.6）。
   `CustomerBottomSheet.tsx`の接客ログ保存(`saveLog()`)が`staff_logs`テーブルへ
   `ai_adopted`/`next_reserved`等の列を書き込もうとしているが、**本番の`staff_logs`テーブルには
   これらの列が実在しない**(実測確認済み、`column staff_logs.ai_adopted does not exist`)。
   このためスタッフが接客ログを保存しようとすると本番では失敗している可能性が高い。
   ユーザー確定方針により、これは本設計から切り離し、
   別設計書`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`にまとめた(§1.6で概要のみ記載)。

## 1. 現在の学習データ状況(実測値付き)

実データはローカルから本番Supabaseへ読み取り専用クエリで実測した(2026-08-07時点)。

### 1.1 `brain_pattern_fire_log`(AI提案が表示・記録された事実)

| 項目 | 値 |
|---|---|
| 総件数 | 176件 |
| 期間 | 2026-06-29 〜 2026-08-07(約5.5週間) |
| `decision_record.degraded=true`の件数(サンプル176件中) | 0件 |
| `decision_record.staffFeedback`が付いている件数(サンプル176件中) | **0件** |
| 書込み元 | `POST /api/admin/proposals`(admin専用ツール、手動)と`POST /api/proposals/fire`
  (2026-08-07本番反映、スタッフ実利用)の2経路。**176件のほぼ全ては前者(admin手動)由来**で、
  スタッフ実利用由来は本番反映直後の数件のみ(該当日時: 2026-08-07 03:53〜04:18の3件を実測確認) |

`decision_record`から現在読み取れるフィールド(いずれもjsonb、構造化保存されているのは
`patternId`/`stepNo`/`proposalKind`/`scriptStyle`/`contextSnapshot`/`explainTexts`/`resolution`/
`candidates`。`degraded`時は`degraded`/`reason`/`contextSnapshot`のみ)。

**現状の制約**: `brain_pattern_fire_log`にはstaff_idカラムが存在せず、`decision_record`にも
どのスタッフが見たかを示すフィールドが無い。つまり**「誰が見たか」は現状のfire_logだけからは
分からない**(§3で追加実装案を提示)。

### 1.2 `brain_proposal_outcomes`(表示後、実際に来店した際の客観的な結果)

| 項目 | 値 |
|---|---|
| 総件数 | 55件 |
| `was_executed=true` | 5件 |
| `was_accepted=true` | 5件(**was_executed=trueの5件と完全一致**) |
| `fire_score`(列は存在)が非NULLの件数 | **0件** |
| `proposal_kind`分布 | upsell 22 / none 17 / homecare 13 / pack 3 / rebooking 0 / subscription 0 |

**重大な仕様上の制約(既存コードの実装事実)**: `src/lib/proposal/recordProposalOutcome.ts`の
全proposalKind分岐で`wasAccepted`は`wasExecuted`と**常に同じ式**で計算されている
（例: homecareは両方とも`visit.retailAmount > 0`）。つまり**現在の実装では「実施率」と
「採用率」は数値として区別が付かない**（常に同一値になる）。「実施＝行動した」「採用＝提案に
納得して受け入れた」という意味的な区別をダッシュボードで別々の指標として出したい場合、
`recordProposalOutcome.ts`側にwas_acceptedの独立判定ロジックを追加する必要がある
(要追加実装、DB変更は不要・列は既に存在)。

`fire_score`/`decisive_factor`列は`brain_success_patterns` W8 migration(2026-06-12)で
追加済みだが、**書込み経路(`OutcomeRepo.create()`)がこの2列を一切渡していない**ため常にNULL。
一方`FinalProposalSet.inStore.mandatory`は生成時点で`fireScore`(数値)と`decisiveFactor`(文字列)を
既に持っている(`buildFireLogDecisionRecord.ts`が`decision_record`へ書き写す際に単純に
この2フィールドを含めていないだけ)。**列もデータも存在する候補は揃っているが、配線されていない**
状態(要追加実装、DB変更は不要)。

### 1.3 `brain_pattern_step_stats`(パターン別成功率マテリアライズドビュー、既存資産)

`brain_proposal_outcomes`を`(pattern_id, step_no, customer_type, staff_style)`単位で集計する
マテビューが**既に存在する**（2026-06-12のW8 migrationで新設、Phase1-Cc(`refresh_pattern_step_stats`
RPC)でリフレッシュ経路も実装済み）。`executed_n`/`accepted_n`/`laplace_rate`（ラプラス平滑化した
採用率）/`avg_fire_score`(ただし§1.2の通りfire_scoreが常にNULLのため常に空)を保持する。

現状`StatsRepo.loadCells()`が`PatternScorer`の入力として内部的に読むだけで、**どの管理画面からも
参照されていない**(実測: 現在3セルのみ、母数(55件のoutcomes)が少ないため大半のパターンは
まだセルが埋まっていない)。これは「パターン別成功率」の一等地となる既存資産で、
**新規テーブル・migration不要でそのまま活用できる**。

### 1.4 `customer_action_logs` / `staff_logs`(スタッフ行動ログ、参考)

- `customer_action_logs`: 33件。`customer_id`は**legacyの`customers`テーブル**(brain_customersとは
  別ID空間)を参照する設計。`action_type`は`line_sent`/`homecare_explained`/`rebook_recommended`/
  `product_recommended`/`product_purchased`のCHECK制約付き(AI提案との直接の紐付きは無い)。
- `staff_logs`: 9件。§1.6で詳述する通り、想定スキーマと実スキーマが食い違っている
  (現在ダッシュボードのデータ源としては信頼できない)。

### 1.5 「実施メニュー紐付け率」について

`brain_proposal_outcomes.visit_id`はNOT NULL制約があり、outcome行は「マッチしたvisitがある場合」
にしか作られない設計のため、**outcomes自体の「visitへの紐付け」は定義上常に100%**（紐付かない
候補は最初からoutcome化されない）。

一方、CSV取込側には`csvImportQualityReport.ts`の`menuResolutionRate`（生メニュー名が
`brain_menus`と一致した割合、CSVインポート単位で計算・既に`/admin/csv-import`画面で表示中）が
既存資産として存在する。ただしこれは**AI提案と無関係な、CSV取込全体のメニュー名寄せ精度**の指標。

「AI提案が示唆したメニュー・施術内容と、実際にvisitで実施されたメニューが一致した割合」という
狭い意味での「AI提案→施術一致率」は、**現状どこにも計算されていない**(§2の該当項目に詳述)。

### 1.6 副次発見: `staff_logs`テーブルのスキーマ不一致(本タスクのスコープ外・要注意)

`src/components/customer/CustomerBottomSheet.tsx`の`saveLog()`は次の列を書き込もうとしている:

```ts
await supabase.from('staff_logs').insert({
  reservation_id, customer_id, staff_id,
  ai_adopted, next_reserved, option_sold, retail_sold, churn_followed, service_completed,
})
```

これは`supabase/migrations/create_staff_logs.sql`(テーブルを一旦DROPして`ai_adopted`等の列で
再作成する設計)を前提にしたコード。**しかし実測(`select('ai_adopted', ...)`)したところ本番は
`column staff_logs.ai_adopted does not exist`のエラーを返した**。実際の本番`staff_logs`は
`log_text`/`services_done`/`next_visit_recommended_at`という別スキーマ(おそらくさらに古い世代、
またはデモシード由来)のまま。

**影響推定(未検証)**: `saveLog()`はinsertエラー時に早期returnしtoastでエラー表示するのみの実装
のため、`POST /api/visits/service-complete`(next_booking_made反映)まで到達していない可能性が高い。
これが正しければ、CustomerBottomSheetからの接客ログ保存は本番で機能しておらず、
[[project_phase1_ai_proposal_outcome_pipeline]]で「rebooking判定の実例が0件」と記録した現象の
一因になっている可能性がある。

**この設計書では対応しない。** ユーザー確定方針により、影響範囲・原因・修正方針は
`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`に別途まとめた。対応要否・優先度はそちらで判断する。

## 2. 管理者向けAI提案分析ダッシュボード案(指標ごとの実現可否)

`/admin/proposal-feedback`(既存「AI提案分析」画面)を拡張する前提で、要望された指標ごとに
データソース・計算式・現状の可否を整理する。

| # | 指標 | データソース | 計算式(案) | 現状 |
|---|---|---|---|---|
| 1 | AI提案表示数 | `brain_pattern_fire_log` | 期間内の行数(store_id絞り込み) | **既存DBのみで可能**。ただし2026-08-07以前はほぼadmin手動起票分のみ(§1.1)である点に注意喚起が必要 |
| 2 | AI提案実施率 | `brain_proposal_outcomes` | `was_executed=true`件数 / outcomes総件数 | **既存DBのみで可能**（実測: 55件中5件=9.1%）。ただし分母をfire_log数にするかoutcomes数にするかで意味が変わる(§2.1参照) |
| 3 | AI提案採用率 | `brain_proposal_outcomes` | `was_accepted=true`件数 / outcomes総件数 | **MVP対象外**。現状was_executedと常に同値(§1.2)のため、実施率(#2)と同じ数字が重複表示されるだけ。独立指標化には`recordProposalOutcome.ts`へのロジック追加が必要(v1.2以降) |
| 4 | AI提案→施術一致率 | `brain_proposal_outcomes` | `was_executed=true`件数 / outcomes総件数(**#2実施率と同一の計算・同一の数字**) | **MVP確定(解釈A採用)**。既存DBのみで可能。ラベルは分けて表示するが、実体は#2のエイリアス。メニュー突合による厳密一致(解釈B)は将来タスク(§2.2) |
| 5 | パターン別成功率 | `brain_pattern_step_stats` | `accepted_n`/`executed_n`/`laplace_rate`をそのままpattern_id×step_no単位で表示 | **既存の資産(matview)をそのまま活用可能・MVP対象**。ただし現在3セルのみ(母数不足)、`avg_fire_score`は常にNULLのため非表示 |
| 6 | FireScore分布 | 未保存 | ヒストグラム(帯ごとの件数) | **MVP対象外**(ユーザー確定)。fire_scoreが常にNULLのため、まずデータ蓄積(§3.2)を優先し、v1.2以降で改めて検討 |
| 7 | スタッフ別利用率 | 未保存(fire_log)/`brain_proposal_outcomes.staff_id`(outcomes) | スタッフごとのfire数 or outcomes数 | **MVP対象外**(ユーザー確定)。fire_logにstaff_idが無く(§1.1)、v1.2以降で改めて検討 |
| 8 | 月別推移 | `brain_pattern_fire_log.created_at` / `brain_proposal_outcomes.created_at` | `DATE_TRUNC('month', created_at)`でGROUP BY | **既存DBのみで可能・MVP対象**。ただし#1と同じく2026-08-07以前は母数がほぼadmin手動分のみ |

### 2.1 「実施率」の分母をどう定義するか(要判断)

`brain_proposal_outcomes`は「fire_logのうち、customer_id一致+30日以内の時間近傍マッチングで
visitと紐付けられたもの」だけが作られる設計([[project_phase1_ai_proposal_outcome_pipeline]]の
`recordProposalOutcome.ts`仕様)。つまり:

- **分母をoutcomes件数にする**: 「来店まで追跡できた提案のうち何%が実施されたか」という意味になる。
  現状のテーブル構造だけで完結する(JOIN不要)。
- **分母をfire_log件数にする**: 「表示した提案のうち何%が最終的に実施まで至ったか」という、
  ユーザーの意図により近い意味になる。ただしfire_logとoutcomesの間には直接の外部キーが無く
  (`recordProposalOutcome.ts`のコメント通り「fire_logとvisitにはvisit_idによる直接の紐付けが無い」
  設計)、正確な分母を出すには「30日以内に紐付けられなかったfire_log」を推定する追加クエリが必要
  (概算にはなるが、customer_id単位でfire_log→outcomes未生成を数えることは既存データのみで可能)。

**MVP確定(2026-08-07ユーザー承認)**: 分母はoutcomes件数のみを採用する。画面上で「来店・会計データと
紐付いた提案のうち」という条件を明示する(誤解を避ける)。fire_log分母版は不採用(v1.2以降の
再検討事項としてもバックログ化しない)。

### 2.2 「施術一致率」の定義(要判断)

2つの解釈があり、ユーザーに確認したい:

- **解釈A(緩い・既存データで計算可能)**: `was_executed`の意味そのもの
  (提案カテゴリ(homecare/upsell/subscription/pack/rebooking)に対応する行動が起きたか)。
  これは#2「実施率」と同じ数字になるため、独立指標としての価値は低い。
- **解釈B(厳密・新規ロジックが必要)**: AI提案が示唆した**具体的なメニュー/商品**
  (`decision_record.explainTexts`や`adjustedScript`に含まれるメニュー名、または
  Menu AI Context由来のカテゴリ)と、`brain_visits.menu_id`が指す実施メニューの
  カテゴリ/roleが一致したか。`brain_menus.role`(Menu AI Contextで既に使われている分類軸)を
  使えば、DB変更なしで新規の比較ロジックとして実装できる可能性がある。

**MVP確定(2026-08-07ユーザー承認)**: 解釈A(was_executedベースの現状定義)を採用する。
実施率(#2)と数値は重複するが、「AI提案→施術一致率」という名称のカードとして併記する
(将来解釈Bへ差し替えた際にUIの置き場所を変えずに済む)。解釈B(メニュー突合の厳密一致)は
将来タスクとしてバックログ化する。

## 3. 既存DBだけで取得できる項目 と 追加実装が必要な項目

### 3.1 既存DBのみで実装可能(migration不要・新規APIのみ)

- AI提案表示数(月別・store別)— `brain_pattern_fire_log`の単純集計
- AI提案実施率(outcomes分母版) — `brain_proposal_outcomes.was_executed`の単純集計
- パターン別成功率 — `brain_pattern_step_stats`をそのまま表示(要`refresh_pattern_step_stats`
  RPCが定期的に呼ばれていることの確認。現状CSV取込完了時のみ呼ばれる設計)
- 月別推移(表示数・実施数) — `created_at`のGROUP BY
- proposal_kind別内訳 — 既存の`aggregateProposalFeedback.ts`と同型の集計を`brain_proposal_outcomes`
  にも適用するだけ
- 👍👎集計(既存) — そのまま流用

### 3.2 DB変更(migration)なしで済むが、アプリコードの追加実装が必要な項目(**MVP対象外・v1.2以降**)

いずれも**新規テーブル・新規カラムは不要**（既存のjsonbカラムへ書き込む項目を増やす、または
既存の未使用カラムへ配線するだけ）だが、2026-08-07のユーザー判断により**MVPには含めない**。
fire_scoreが常にNULLの現状ではデータ蓄積を優先する方針のため。

- **FireScore分布**: `buildFireLogDecisionRecord.ts`が`decision_record`へ`fireScore`/
  `decisiveFactor`を書き足す(`FinalProposalSet.inStore.mandatory`に既に存在する値を単純に含める
  だけ)。または`recordProposalOutcome.ts`→`OutcomeRepo.create()`が`brain_proposal_outcomes.
  fire_score`/`decisive_factor`(列は既存)へ書き込むよう配線する。両方やるのが理想
  (fire_log側は「表示された時点のスコア」、outcomes側は「実施と紐付いた時点のスコア」で
  意味が異なるため)。
- **スタッフ別利用率(fire_log起点)**: `POST /api/proposals/fire`が`decision_record`へ
  `firedByStaffId: staff.staffBrainId`を書き足すだけ(fire時点で既にサーバー側で分かっている値)。
- **採用率をwas_executedと分離する**: `recordProposalOutcome.ts`の各proposalKind分岐へ、
  「実施(行動が起きた)」と「採用(スタッフ・顧客が前向きに受け止めた)」を区別する独立ロジックを
  追加する。ただし「採用」を客観的にどう判定するか自体が設計課題(例: 顧客の口頭反応はデータ化
  されていない)。現実的には`staff_logs.ai_adopted`(自己申告)を採用シグナルとして併用する案が
  あるが、`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`の通り現状このテーブルは信頼できないため、
  まずそちらの復旧が前提になる。

### 3.3 新規ロジック・設計判断が必要な項目(v1.2以降の検討事項)

- **施術一致率(解釈B)**: `brain_menus.role`とproposalKindの対応関係を新規定義する必要がある
  (§2.2)。
- **fire_log分母での実施率**: fire_log→outcomes未生成分の推定ロジック(§2.1、MVP不採用)。
- **AI提案文章品質分析**(2026-08-07追加。v1.1以降候補。**今回はDB変更・実装を行わず記録のみ**):
  スタッフが実際に使いやすいAI提案文章へ改善することを目的とした分析軸。候補指標:
  - 提案文章の文字数
  - 通常版/簡易版/別案の選択率
  - スタッフが最終的に使用した文章タイプ
  - 成果が出た提案の平均文字数
  - スタッフ別の好みの文章量

  **参考(調査済みの前提条件・実装時に確認が必要)**:
  - `brain_pattern_fire_log.decision_record.explainTexts`には`staffLine1`/`staffAvoid`等の
    説明文は保存されているが、`FinalProposalSet.inStore.mandatory.adjustedScript`
    (提案そのものの台本テキスト)は現状`decision_record`に含まれていない
    (`buildFireLogDecisionRecord.ts`が書き写していない)。「文字数」を測るにはまずこの
    フィールドの保存を追加する必要がある(DB変更なしで対応可能、`decision_record`はjsonbのため)。
  - 「通常版/簡易版/別案の選択率」「最終的に使用した文章タイプ」は、既存のLINE文面バリエーション
    機能(commit `9898d7f`「LINE draft variant switch, alternate regenerate, and clear」)と
    関連する可能性が高いが、これは`src/components/line/**`等のLINE領域に該当し、
    `CLAUDE.md`のv1凍結ルール上、承認なしに変更できない領域。着手時は別途LINE領域の
    凍結解除範囲確認が必要になる見込み。
  - 上記いずれも本設計書のMVP範囲(§4.2)には含めない。

## 4. MVP(v1.1)確定範囲

### 4.1 方針(2026-08-07ユーザー承認)

- **新規画面は作らない**。既存`/admin/proposal-feedback`(「AI提案分析」、既にサイドバーnav済み)
  にセクションを追加する形で拡張する。ユーザーが探す場所を増やさない・既存の「AI提案分析」という
  呼称と役割を素直に育てる。
- **§3.1(既存DBのみ)の範囲のみをMVPとする**。§3.2(コード追加のみ・DB変更なしで実現可能な
  FireScore/スタッフ別利用率/採用率独立判定)は**MVPから明示的に除外**し、v1.2以降の検討事項として
  バックログ化する(fire_scoreが常にNULLの現状ではまずデータ蓄積を優先する)。
- §2.2解釈B・§2.1のfire_log分母版も**MVP対象外**。
- 表示は既存の管理画面群(数値カード＋シンプルなHTMLテーブル、CSSの横棒グラフ)と同じ軽量な
  スタイルに統一する。**新規チャートライブラリは導入しない**(package.jsonにrecharts等の依存が
  無く、既存画面が一貫してプレーンなdiv/table実装のため)。

### 4.2 MVP範囲(確定)

| セクション | 指標 | データ源 | 実装規模 |
|---|---|---|---|
| サマリーカード | 表示数・実施率(outcomes分母)・施術一致率(実施率と同値ラベル違い)・proposal_kind内訳 | fire_log/outcomes単純集計 | 小 |
| 月別推移 | 表示数・実施数の月別棒グラフ(CSS div) | 同上のGROUP BY | 小 |
| パターン別成功率 | `brain_pattern_step_stats`をそのままテーブル表示(executed_n/accepted_n/laplace_rate) | 既存matview | 小(新規API 1本のみ) |
| 👍👎(既存) | 既存のまま | 既存 | 変更なし |

**MVP対象外(v1.2以降のバックログ)**: FireScore分布・スタッフ別利用率・was_accepted独立判定・
施術一致率(解釈B)・fire_log分母版実施率。

### 4.3 想定ファイル一覧(実装フェーズに入る場合の参考。今回は設計のみ)

新規:
- `app/api/admin/proposal-analytics/route.ts`(仮。表示数/実施率/月別推移/パターン別成功率をまとめて返す)
- `src/lib/proposalAnalytics/aggregateProposalAnalytics.ts`(純粋集計関数、既存`aggregateProposalFeedback.ts`と同じ設計方針)

変更:
- `src/components/admin/proposalFeedback/ProposalFeedbackAnalyticsScreen.tsx`(セクション追加)
- `src/store/useProposalFeedbackAnalyticsStore.ts`(取得ロジック追加、または新規store)

触らない: DB migration一式・`ProposalOrchestrator`本体・LINE領域・スタッフアプリ側
(`CustomerBottomSheet.tsx`等)・`src/lib/proposal/buildFireLogDecisionRecord.ts`・
`app/api/proposals/fire/route.ts`・`src/lib/proposal/recordProposalOutcome.ts`・`OutcomeRepo.ts`
(§3.2がMVP対象外のため、fire/outcome書込み経路には一切手を入れない)。

## 5. 確定事項サマリー(2026-08-07ユーザー承認)

1. 実施率の分母は`brain_proposal_outcomes`基準のみ採用。fire_log基準は不採用。
2. 施術一致率はwas_executedベースの現状定義(解釈A)を採用。メニュー突合の厳密一致(解釈B)は
   将来タスク。
3. FireScore分布・スタッフ別利用率はMVPから除外。fire_scoreが常にNULLの現状ではデータ蓄積を
   優先する。
4. `staff_logs`のスキーマ不整合はAI分析ダッシュボードとは切り離し、
   `docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`で別途扱う。

上記が確定したため、実装着手の可否は別途明示的な指示を待つ(このセッションでは§4.2のMVP範囲の
設計提出までとし、実装はまだ開始しない)。

## 6. 実装着手前の現状再確認(2026-08-07、staff_logs修正・本番反映後)

`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`のmigration適用・本番反映が完了したのを受け、
MVP実装着手前にユーザー指示で現状を再確認した。

### 6.1 実データ件数(再実測、§1の初回実測時点と比較)

| 項目 | 初回実測(§1) | 今回再実測 | 差分 |
|---|---|---|---|
| `brain_pattern_fire_log`総件数 | 176件 | 176件 | 変化なし |
| うち`staffFeedback`あり | 0件 | 0件 | 変化なし |
| うち`degraded`件数 | 0件(サンプル) | 0件(全件走査) | 変化なし |
| `brain_proposal_outcomes`総件数 | 55件 | 55件 | 変化なし |
| `was_executed=true` | 5件 | 5件 | 変化なし |
| `fire_score`非NULL件数 | 0件 | 0件 | 変化なし |
| `proposal_kind`分布 | upsell22/none17/homecare13/pack3 | 同左 | 変化なし |
| `brain_pattern_step_stats`セル数 | 3セル | 3セル | 変化なし |
| `staff_logs`総件数 | 9件(デモシード) | 9件(デモシード) | 変化なし |

**staff_logs修正が本番反映されて以降、実スタッフによる新規保存はまだ0件**(9件は全てデモシード、
`ai_adopted`等6列は全行`false`のまま)。デプロイ直後のため、これは想定通り(実際にスタッフが
CustomerBottomSheetで接客ログを保存する機会がまだ発生していないだけ)。

### 6.2 `/admin/proposal-feedback`の実装状況(再確認)

`git log`で関連ファイル一式の変更履歴を確認したところ、初版実装コミット(`adbcb1f`)以降
**一切変更されていない**。§1・§2記載の実装状況(`ProposalFeedbackAnalyticsScreen.tsx`が
👍👎集計のみ表示、`useProposalFeedbackAnalyticsStore.ts`が`fetchAnalytics(storeId, range)`のみの
単純なzustand store)は現時点でもそのまま正確。MVPで想定している「既存ストアを拡張」という
実装方針の前提に変化はない。

### 6.3 §1〜§5の設計内容との差分

**差分なし。** 実データ件数・実装状況とも初回調査時点から変化していないため、§2の指標可否表・
§4.2のMVP範囲・§5の確定事項はすべてそのまま有効。設計をやり直す必要はない。

### 6.4 staff_logs修正後、新たに分析に使えるようになった指標があるか

**結論: 現時点では無い。** 理由は2点:

1. **実データが0件**(§6.1)。列が書けるようになっただけで、まだ蓄積が始まっていない。
2. **確定済みMVP範囲(§4.2)はそもそもstaff_logsを使わない設計**
   （`brain_pattern_fire_log`・`brain_proposal_outcomes`・`brain_pattern_step_stats`のみで
   完結する）。そのため今回のstaff_logs修正はMVPの実装可否そのものには影響しない。

将来的な参考情報として、staff_logsが今後蓄積された場合に使える可能性がある指標(v1.2以降の
検討事項、§3.2の「採用率をwas_executedと分離する」の代替・補完案):

- `ai_adopted`(自己申告の「AI提案を活用した」)を、`was_accepted`(現状was_executedと常に同値)とは
  別の「採用」シグナルとして併用する案。ただし**`staff_logs`とAI提案(fire_log/outcomes)を
  直接紐付けるキーが存在しない**(FKなし、`customer_id`はlegacy `customers`テーブル空間で
  `brain_customers`とはミラートリガー依存の間接一致、時刻近傍マッチングの仕組みも未実装)。
  紐付けるには`recordProposalOutcome.ts`と同種の「customer_id+時間近傍」ロジックを新設する
  必要があり、決して単純な追加ではない。
- `next_reserved`/`retail_sold`は、CSV取込を待たずスタッフの保存操作時点で即座に得られる
  「速報値」として、`brain_proposal_outcomes`(CSV取込のreconcile待ち)より早く動く補助指標に
  なり得る。
- `churn_followed`は現状`brain_proposal_outcomes`のどのproposal_kindにも対応しない、
  staff_logs固有の新しい軸。

いずれも新規の紐付けロジック設計が必要なため、**MVPには含めず、v1.2以降の検討事項として
引き続きバックログに置く**(§3.3に追記)。

## 7. 実装完了報告(2026-08-07)

§4.2で確定したMVP範囲(サマリーカード・月別推移・パターン別成功率・既存👍👎)を、
既存の`/admin/proposal-feedback`画面を拡張する形で実装した。DB migrationなし
(brain_pattern_fire_log/brain_proposal_outcomes/brain_pattern_step_statsとも既存のまま)。

### 7.1 実装ファイル一覧

新規:
- `src/lib/proposalAnalytics/aggregateProposalAnalytics.ts` — 集計純粋関数
  (aggregateProposalFeedback.tsと同じ設計方針)
- `app/api/admin/proposal-analytics/route.ts` — GET、requireAdmin
- `src/store/useProposalAnalyticsStore.ts` — 新規store(既存のuseProposalFeedbackAnalyticsStore
  とは独立、画面上で並行利用)
- `tests/lib/proposalAnalytics/aggregateProposalAnalytics.test.ts`(6件)
- `tests/api/proposal-analytics.test.ts`(7件)

変更:
- `src/types/riora.types.ts` — `PatternStepStatSummary`型追加
- `src/repositories/interfaces.ts` — `IBriefingRepo.listSinceByStore`・
  `IOutcomeRepo.listSinceByStore`・`IStatsRepo.listAllStepStats`追加
- `src/repositories/supabase/mappers.ts` — `toPatternStepStatSummary`追加
- `src/repositories/supabase/BriefingRepo.ts`・`OutcomeRepo.ts`・`StatsRepo.ts` — 上記3メソッドの実装
- `app/api/_schemas/query.ts` — `proposalAnalyticsQuerySchema`追加
- `src/components/admin/proposalFeedback/ProposalFeedbackAnalyticsScreen.tsx` — サマリー/月別推移/
  パターン別成功率セクション追加(既存の👍👎セクションは無変更)
- `tests/engines/pattern/ProposalOrchestrator.test.ts`・`tests/lib/import/csvImportPipeline.test.ts`・
  `tests/lib/proposal/generateCustomerProposal.test.ts` — interface拡張に伴うモックの追従
  (`listAllStepStats`/`listSinceByStore`のスタブ追加、挙動は無変更)

触らない: DB migration一式・`ProposalOrchestrator`本体・`recordProposalOutcome.ts`・
`csvImportPipeline.ts`・LINE領域・スタッフアプリ側

### 7.2 主要な設計判断

- `brain_pattern_step_stats`にstore_id列が無いため、`listAllStepStats()`は店舗絞り込みをせず
  全件返す(単一店舗運用の現状では実害なし、§1.3で確認済みの制約をそのまま踏襲)。
- 「施術一致率」は解釈A(実施率のエイリアス)のまま、UIとAPIレスポンスの両方で独立した
  フィールド(`treatmentMatchRatePct`)として扱い、将来解釈Bへ差し替える際にUI側の変更を
  最小化できるようにした。
- 月別推移は「表示された月」と「実施された月」の和集合のみを対象にする(どちらにも
  データが無い月は表示しない)。CSSのdiv2枚重ねによる横棒(表示数の背景バー+実施数の
  アクセント色バー)で、新規チャートライブラリなしで表現した。
- 新規セクションは既存store(`useProposalFeedbackAnalyticsStore`)を拡張せず独立した
  新規storeにした(既存のテスト済み実装への影響をゼロにするため)。期間セレクタ(30d/90d/all)は
  共通UIとして両storeを同時に呼び出す。

### 7.3 検証結果

- **TypeScript**: `npx tsc --noEmit` — 新規/変更ファイル起因のエラー0件(全体の残り9件は
  本セッション開始前から存在する無関係な既存エラーと完全一致)。
- **単体テスト**: 新規13件全件成功。既存の関連テスト(ProposalOrchestrator/csvImportPipeline/
  generateCustomerProposal/mappers/proposals系)89件も全件成功、リグレッションなし。
- **build**: `npm run build` — exit 0、エラーなし。
- **全体テストスイート**: 821件成功・83件失敗(失敗はすべて本セッション以前からの既存の
  無関係な失敗と同一件数・内容。新規テスト13件分、成功数が808→821件に増加したことを確認)。
- **実データAPI確認**: ローカルdevサーバーで管理者(admin@salon-riora.jp)の本物のセッションを使い
  `GET /api/admin/proposal-analytics`を実行。range=all/90dで表示数176件・outcomes55件・
  実施率9.1%(実測値、§1・§6の事前調査と完全一致)、proposal_kind内訳(upsell22/none17/
  homecare13/pack3)も一致、月別推移(2026-06/07/08)・パターン別成功率
  (例: A1-step2が実施3件中3件成功=66.7%)とも実データで正しく算出されることを確認した。
  未認証リクエストは401を確認。
- **ブラウザでの目視確認**: 本セッション環境ではClaude in Chrome拡張が未接続のため未実施。
  API・集計ロジックの正しさは実データで確認済みだが、画面の実際のレンダリング結果は
  お手元でのご確認をお願いしたい(`/admin/proposal-feedback`を開き、サマリーカード3枚・
  月別推移バー・パターン別成功率テーブルが表示され、既存の👍👎セクションも従来通り
  表示されることを確認)。

commit/pushはまだ行っていない。
