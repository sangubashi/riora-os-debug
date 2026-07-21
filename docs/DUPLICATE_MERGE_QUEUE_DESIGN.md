# 統合候補キュー(案2) 具体設計

**ステータス: 調査・設計のみ・コード変更禁止・migration禁止・commit禁止・push禁止・deploy禁止**
**作成日: 2026-07-20**
**前提**: `docs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md`で案2(統合候補キュー)を推奨方式として選定済み。本書はその具体設計。
**土台とする既存設計**: `docs/CUSTOMER_DUPLICATE_MANAGEMENT_V1.md`(UI・データ移行ルールの先行設計。本書は「キュー」という永続状態管理の追加と、実データで新規発見した技術的補強を行う)

---

## 0. 結論の先出し

```
① UI配置: 新規メニュー「顧客統合」を推奨(顧客管理は閲覧専用という既存の設計制約に
   抵触するため不可。CSV Import管理はCSV1回の取込に紐づく一時的な要確認リストであり、
   横断的に持ち越す永続キューとは性質が異なるため不適)

② 一覧項目: 依頼の6項目に加え、区分(A/B)・グループ内件数・表記ゆれ有無・禁忌情報有無を
   追加提案

③ フロー: 候補一覧 → グループ詳細(比較ビュー) → 統合先選択・確認 → 実行 → 完了、の
   4画面。CUSTOMER_DUPLICATE_MANAGEMENT_V1.mdの設計をほぼ踏襲

④ DB更新: brain_customers(論理削除+first_visit_date更新)・brain_visits(customer_id
   付け替え+visit_count_at再採番)。再採番は「来店日昇順に1から振り直す」方式を提案。
   新規テーブルは作らず、既存brain_customers.merge_statusの追加(将来migration)と
   既存brain_ops_logsへの監査ログ記録で完結させる設計とする

⑤ rollback: 統合直後(生き残り顧客に新しいvisitが追加される前)であれば、監査ログを
   元にbrain_customers/brain_visitsとも完全復元可能。統合後に新しいvisitが追加されると
   visit_count_atの再採番が絡むため完全な取り消しは困難になる(この制約はCUSTOMER_
   DUPLICATE_MANAGEMENT_V1.mdが既に明記済み。本書はvisit_count_at観点で具体化する)

⑥ 工数: 設計0.5〜1日・実装3〜4日・テスト1〜1.5日、合計4.5〜6.5日
```

---

## 1. UI設計: 管理画面のどこに置くべきか

### 1.1 候補の評価

| 候補 | 評価 | 理由 |
|---|---|---|
| CSV Import管理(`/admin/csv-import`) | **不採用** | 既存の`needsReview`は**1回のCSV取込セッションに閉じた一時的なリスト**(`reviewDecisions`はHTTPリクエスト1回分のstateで永続化されない設計、`docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md`参照)。統合キューは複数のCSV取込・複数週にまたがって持ち越される永続的な管理対象であり、性質が異なる。同じ画面に無理に同居させると「今回のCSVの話」なのか「過去からの積み残し」なのか運用者が混乱する |
| 顧客管理(`/admin/customer-assets`) | **不採用** | `CustomerAssetsScreen.tsx`のコード内コメントに明記された設計制約: 「表示は顧客一覧/来店回数/最終来店日/LTV/累計売上/指名状況/来店間隔のみ(ユーザー指示・2026-06-23)。管理者は閲覧のみ。顧客編集・削除のUIは置かない」。統合(=既存顧客の論理削除+visit付け替え)は明確に「編集・削除」に該当し、この画面の確立した設計方針と正面から矛盾する |
| **新規メニュー(推奨)** | **採用** | サイドバー(`AdminSidebar.tsx`)は既に「経営TOP/失客リスク/顧客管理/LINE/スタッフ分析/スタッフ管理/稼働率分析/CSV Import/メニュー管理/設定」と**1関心事=1メニュー項目**の構成を一貫して採っている。「顧客統合」も独立した関心事として同列に追加するのが既存の情報設計と整合する |

### 1.2 推奨案

**新規メニュー項目「顧客統合」を追加する。**

- 配置場所案: `/admin/customer-merge`
- サイドバー内の位置: 「顧客管理」の直後(関連性が高いため隣接配置)
- アイコン案: `GitMerge`(lucide-react、他のアイコンと系統を合わせる)
- 権限: `requireAdmin`ゲート必須(`CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §3.4の方針を継承。統合は不可逆性の高い操作のため、既存の`admin@salon-riora.jp`単一アカウントゲートに限定する)

---

## 2. 一覧項目設計

### 2.1 依頼された6項目

| 項目 | 表示内容 | データソース |
|---|---|---|
| 氏名 | `brain_customers.name`(生の表記のまま。正規化前の表記ゆれが見えることが重要) | `brain_customers` |
| 顧客ID | UUID(先頭8桁表示+全体はホバー/コピーで確認できるようにする) | `brain_customers.id` |
| visit数 | `brain_visits`の件数(deleted_at IS NULL) | `brain_visits`集計 |
| 最終来店 | `brain_visits.visit_date`の最大値(visit数0件なら「来店なし」表示) | `brain_visits`集計 |
| 担当 | このレコードのvisitに紐づく担当スタッフ名(複数ある場合は全件をカンマ区切り) | `brain_visits.staff_id` → `brain_staff.name` |
| 作成日 | `brain_customers.created_at` | `brain_customers` |

### 2.2 不足項目の追加提案

| 追加項目 | 理由 |
|---|---|
| **グループ内件数** | 「このレコードは何件のグループに属しているか」が一覧だけで分かると、パターンB(全件visit実績あり=統合確度が高い)かパターンA(1件のみ実績あり=要確認)かを一覧上で素早く判別できる |
| **区分バッジ(A/B)** | `docs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md` §2の分類をそのまま表示する。Aは「安全に統合可能」、Bは「要確認」の色分け表示。C(統合禁止)は現状0件だが、将来別グループで検出された場合に備えて表示ロジック自体は3値対応にしておく |
| **表記ゆれフラグ** | グループ内に全角スペース有無等の表記差異があるかを示す(スタッフが「本当に同一人物か」を判断する補助情報。`docs/CSV_IMPORT_DUPLICATE_ROOT_CAUSE_AUDIT_V1.md`の分類と整合) |
| **禁忌情報の有無** | `CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §3.2の設計判断を継承: 「禁忌情報の有無は他の項目より視覚的に強調する(赤枠・警告アイコン等)。統合判断において最も見落としてはいけない情報」。誤って禁忌情報を持つレコードを消す側に選んでしまう事故を防ぐため、一覧の時点で警告表示する |
| **推定生き残り候補マーク** | `docs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md` §2の選定ロジック(visit件数最多、同数ならcreated_at最古)に基づき、システムが「これが主レコード候補です」という推奨マークを付ける(あくまで推奨であり、最終選択は管理者が行う。`CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §4.2「システムが自動選択しない」方針を維持) |
| **統合ステータス** | 未処理/統合済み/統合しない(別人と判断・却下)の3状態。キューとして永続化するために必須(§4で詳述) |

---

## 3. 統合作業フロー(画面遷移)

`CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §3〜§4の設計を土台に、キュー方式へ合わせて整理する。

```
┌─────────────────────────────────────────────────────────┐
│ 画面A: 統合候補一覧(/admin/customer-merge)                │
│  - グループ単位でカード/行表示(氏名・件数・区分バッジ)     │
│  - フィルタ: 区分(A/B)・ステータス(未処理/統合済み/却下)   │
│  - 「詳細を見る」ボタンで画面Bへ                            │
└─────────────────────────────────────────────────────────┘
                          │ グループ選択
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 画面B: グループ詳細(比較ビュー)                             │
│  - グループ内全レコードを横並び比較(§2.1+§2.2の全項目)     │
│  - 禁忌情報・引継ぎメモは強調表示(赤枠)                     │
│  - 推奨生き残り候補にマーク                                │
│  - アクション: 「統合先を選ぶ」/「統合しない(別人)」        │
└─────────────────────────────────────────────────────────┘
                          │ 「統合先を選ぶ」
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 画面C: 統合先選択・最終確認                                 │
│  - 統合先(生き残る側)をラジオボタンで選択(初期値=推奨候補) │
│  - 統合後のfirst_visit_date・visit件数合計等、統合結果の    │
│    プレビューを表示(実際のDB更新前にシミュレーション表示)   │
│  - 「この操作は取り消しが難しくなる場合があります」の警告文  │
│  - 「統合を実行する」ボタン(確認ダイアログでもう一段確認)    │
└─────────────────────────────────────────────────────────┘
                          │ 実行
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 画面D: 完了                                                │
│  - 統合結果サマリ(生き残ったID・消えたID・移動したvisit数)  │
│  - 「一覧に戻る」ボタン(画面Aへ、対象グループはステータス   │
│    「統合済み」に変わって表示される)                        │
└─────────────────────────────────────────────────────────┘
```

「統合しない(別人と判断)」を選んだ場合は画面Bから直接ステータスを「却下」に更新し、以降その組み合わせを候補一覧の既定フィルタから除外する(再度確認したい場合はフィルタ切り替えで表示可能)。

---

## 4. DB更新内容

### 4.1 brain_customers

| 操作 | 対象 | 内容 |
|---|---|---|
| 論理削除 | 統合元(消える側)全レコード | `deleted_at = now()`をUPDATE(物理削除はしない。既存の`deleted_at`列をそのまま利用) |
| 更新 | 統合先(生き残る側) | `first_visit_date`をグループ内の最小値へ更新(現状は各レコードが自分の1回の来店日をそのまま持っているため、統合後は本来の初回来店日に補正する) |
| **(将来migration・本調査では未作成)** | 全レコード | `merge_status text CHECK (merge_status IN ('none','candidate','merged','rejected')) DEFAULT 'none'`列の追加を提案。候補一覧の永続的なステータス管理に使う。新規テーブルは作らずこの1列で完結させる方針(`docs/HMAC_MATCHING_IMPLEMENTATION_PLAN.md`で検討した`merge_status`設計と同じ考え方を流用) |

### 4.2 brain_visits

| 操作 | 対象 | 内容 |
|---|---|---|
| customer_id付け替え | 統合元に紐づく全visit | `customer_id`を統合先のIDへUPDATE(`CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §9.1と同じ) |
| **visit_count_at再採番(本調査で追加発見した必須ステップ)** | 統合先に紐づく全visit(元々の分+付け替えられた分) | 下記4.3で詳述 |

### 4.3 visit_count_at再採番方法

`brain_visits.visit_count_at`は`supabase/migrations/20260709_insert_visit_with_sequence_rpc.sql`により**顧客単位でCOALESCE(MAX(visit_count_at),0)+1**の原子的採番がされている。統合前は各分裂レコードが独立して「自分にとっての1件目」を採番されているため、単純に`customer_id`だけ付け替えると統合先の顧客が`visit_count_at=1`のvisitを複数件持つ不整合状態になる。

**再採番アルゴリズム(提案)**:

```
1. 統合先のcustomer_idに属する全visit(付け替え後)を visit_date昇順 で取得する
   (同日に複数visitがある場合は既存のcreated_at昇順をタイブレークに使う)
2. 取得した順に 1, 2, 3, ... と visit_count_at を振り直してUPDATEする
3. この処理は「customer_id付け替え」の直後、同一トランザクション内で実行する
   (CUSTOMER_DUPLICATE_MANAGEMENT_V1.md §4.2「統合は1操作=1トランザクション」の
   方針をvisit_count_atにも適用する)
```

既存の`insert_visit_with_sequence_rpc`(1件挿入用のRPC)とは別に、統合専用の「一括再採番」処理を新規に実装する必要がある(既存RPCの流用はできない。1件ずつの原子性ではなく、グループ全体の整合性を1トランザクションで担保する必要があるため)。

### 4.4 その他の関連テーブル(`CUSTOMER_DUPLICATE_MANAGEMENT_V1.md` §5〜§9を継承)

`customer_notes`・`voice_notes`・`customer_memories`・`contraindications`・`timeline_summary_cache`等、legacy `customers.id`空間を参照するテーブルへの対応は、既存設計書のミラー行確認ルール(§5.2)・テーブル別移行ルール(§5.3)をそのまま踏襲する。本書での追加検討は不要(前回の実データ監査で明らかになった通り、対象グループのレコードはほぼ全て`brain_customers`↔`customers`のミラーが健全なため、大きな逸脱は想定していない)。

### 4.5 監査ログ(新規テーブルなし)

統合実行時、`brain_ops_logs`(`kind='customer_merge'`)へ以下を記録する(既存テーブルの再利用。新規テーブルは作らない):

```
detail: {
  survivorId: <統合先customer_id>,
  mergedIds: [<統合元customer_id>, ...],
  visitReassignments: [{ visitId, fromCustomerId, oldVisitCountAt, newVisitCountAt }, ...],
  firstVisitDateBefore: <統合先の元のfirst_visit_date>,
  firstVisitDateAfter: <統合後のfirst_visit_date>,
  executedBy: <実行した管理者>,
  executedAt: <実行日時>,
}
```

この監査ログが§5のrollback可否を左右する最重要データになる。

---

## 5. rollback方法

### 5.1 統合直後(生き残り顧客に新しいvisitが1件も追加されていない場合)

**完全に復元可能。**

```
1. brain_customers: 統合元レコードの deleted_at を NULL に戻す
2. brain_customers: 統合先の first_visit_date を firstVisitDateBefore の値に戻す
3. brain_visits: 監査ログのvisitReassignmentsを逆順に適用
   - customer_id を fromCustomerId に戻す
   - visit_count_at を oldVisitCountAt に戻す
```

すべて`brain_ops_logs`の監査ログから機械的に導出できるため、手順としては明確。

### 5.2 統合後、生き残り顧客に新しいvisitが追加された場合

**完全な復元は困難になる。**

- 統合先の`visit_count_at`は、新しいvisit追加によって既に「統合後の並び」を前提に採番が進んでいる
- 統合元レコードのdeleted_at解除・customer_id引き戻し自体は可能だが、その後の`visit_count_at`を「もし統合していなかったら」の状態に戻すことは、新規追加visitとの絡み合いにより機械的に再現できない
- `CUSTOMER_DUPLICATE_MANAGEMENT_V1.md`も同じ趣旨を既に明記している(「取り消しは可能だが、統合後に新しいデータが追加されると完全な取り消しは難しくなる」)。本書はこれを`visit_count_at`の観点で具体的に裏付けた

### 5.3 運用上の推奨

- 統合実行後、**一定期間(例: 1週間)は同一顧客に新規CSV取込等でvisitが追加されないか注視**し、誤統合の可能性に気づいた場合は速やかに5.1の手順で復元する運用を推奨する
- 画面D(完了画面)に「この統合の取り消しは○日以内が確実です」といった注意書きを表示することを検討する

---

## 6. 工数見積(設計・実装・テストを分離)

| フェーズ | 内容 | 見積 |
|---|---|---|
| **設計** | UI詳細設計(画面B・Cのワイヤーフレーム)、`merge_status`migrationの正式設計、visit_count_at再採番ロジックの詳細設計・境界値整理(同日複数visit時の順序決定等) | **0.5〜1日** |
| **実装** | 新規画面4面(候補一覧・詳細比較・統合先選択・完了)、新規API(候補取得・統合実行・却下)、`merge_status`migration適用、visit_count_at一括再採番処理、`brain_ops_logs`監査ログ記録実装 | **3〜4日** |
| **テスト** | 再採番ロジックの単体テスト(同日複数visit・visit0件等の境界値)、実データでのDry Run的検証(実際にA区分1グループだけ試験統合→確認→rollback試験)、KPI/離脱予兆/ホームケア通知への影響が設計通りであることの実データ確認 | **1〜1.5日** |
| **合計** | | **4.5〜6.5日** |

**見積の前提・留保**:
- 上記はUI/API/DB更新ロジックの実装のみを対象とし、パターンA(§1.3で発見したスタブ顧客由来の新規重複)を止める別課題は含まない(別途見積が必要)
- `CUSTOMER_DUPLICATE_MANAGEMENT_V1.md`の既存設計(検出ロジック・比較UIの構成案)を再利用できる前提で見積もっている。ゼロから設計し直す場合はさらに1〜2日の追加を見込む

---

## まとめ

1. UI配置は新規メニュー「顧客統合」を推奨。既存の「顧客管理」は閲覧専用という明示的な設計制約があり不可、「CSV Import管理」は取込セッション単位の一時リストで性質が異なる
2. 一覧項目は依頼の6項目に加え、区分バッジ・グループ内件数・表記ゆれフラグ・禁忌情報強調・推奨生き残り候補マーク・統合ステータスを追加提案
3. 画面遷移は「候補一覧→詳細比較→統合先選択・確認→完了」の4画面
4. DB更新は`brain_customers`(論理削除+first_visit_date補正)・`brain_visits`(customer_id付け替え+**visit_count_at再採番**)。新規テーブルは作らず`merge_status`列(将来migration)+既存`brain_ops_logs`で完結
5. rollbackは統合直後(新規visit追加前)なら監査ログから完全復元可能。新規visit追加後は`visit_count_at`が絡み完全復元が困難になる
6. 工数は設計0.5〜1日・実装3〜4日・テスト1〜1.5日、合計4.5〜6.5日

本調査ではコード変更・migration作成・commit・push・deployのいずれも行っていません。
