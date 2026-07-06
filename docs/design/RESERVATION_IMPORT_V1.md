# 予約CSV取込設計書 v1(RESERVATION_IMPORT_V1)

- 作成: Phase RES-2(調査のみ・実装禁止)
- 位置づけ: **設計確定のための設計書のみ。DDL適用・コード実装は行わない。**
- 調査対象CSV: `予約一覧_20260702125005.csv`(SalonBoard予約一覧エクスポート、Shift-JIS、59列)
- 先行調査: Phase MD5-Q1(reservations時刻不在の確認)・Phase RES-CSV-VERIFY(実CSV列確認)

---

## 0. 前提として確定している事実(実DB・実コード確認済み)

### 0.1 `reservations`テーブルの実スキーマ

```
id                 uuid        PK
customer_id        uuid        NULL可  FK → customers(id)            ※legacy(旧)顧客表
staff_id           uuid        NOT NULL FK → profiles(id)            ※brain_staffではない
menu               text        NOT NULL                              ※FKではなく直接文字列
price              integer     NOT NULL
scheduled_at       timestamptz NOT NULL
duration_minutes   integer     NOT NULL
status             text        NOT NULL  CHECK: confirmed / in_progress / completed / cancelled
is_new_customer    boolean     NOT NULL
notes              text        NULL可
created_at         timestamptz NOT NULL
customer_hash_id   text        NULL可  FK → customers_pii(hash_id)
brain_customer_id  uuid        NULL可  FK → brain_customers(id)      ※新(brain)顧客表
```

現在のDB実データでの`status`実測値: `completed` / `confirmed`(2値のみ)。

**重要**: `reservations.staff_id`は`brain_staff`ではなく`profiles`を参照する。既存CSV取込パイプライン(`csvImportPipeline.ts`)が使う`staffResolver.ts`は`brain_staff.id`を解決するため、そのままでは`reservations.staff_id`に使えない(§4で詳述)。

**重要**: `reservations.menu`はFKではなくtext列。`menuResolver.ts`(→`brain_menus.id`解決)は必須ではない(§5で詳述)。

**重要**: `reservations`には予約CSVの一意キーである「予約番号」を保存する列が存在しない(§6で詳述)。

### 0.2 対象CSVの構造(59列。詳細はPhase RES-CSV-VERIFY報告を参照)

主要列(インデックス): `0 ステータス` `3 スタッフ名` `6 来店日` `7 開始時間` `8 終了時間` `9 所要時間` `17 予約時メニュー` `24/28 お名前` `25/29 電話番号` `30 お客様番号(全行空欄)` `31 予約時合計金額`

`ステータス`実測値: `受付待ち` / `お客様キャンセル` / `会計済み`

---

## ① CSV→reservationsマッピング表

| reservationsカラム | CSV列(インデックス) | 変換要否 |
|---|---|---|
| `scheduled_at` | `来店日`(6) + `開始時間`(7) | 要変換: `YYYYMMDD`+`HHMM` → JST timestamptz へ結合(`toIsoJst`相当の関数を新設。既存`salonBoardDetailParser.ts`の`toIsoJst`と同様のロジックを流用可能) |
| `duration_minutes` | `所要時間`(9) | そのまま数値変換のみ(例: `"90"` → `90`) |
| `staff_id` | `スタッフ名`(3) | 要新規解決ロジック(§4) |
| `menu` | `予約時メニュー`(17) | そのまま文字列格納(§5) |
| `price` | `予約時合計金額`(31) | そのまま数値変換のみ。空欄は`0` |
| `status` | `ステータス`(0) | 要変換テーブル(§2) |
| `customer_id` | ― | **常にNULL**(legacy customers表とは連携しない。既存の`today-briefing`実装と同じ方針) |
| `brain_customer_id` | `お名前`+`電話番号`(24/25/28/29) | 要名寄せロジック(§3) |
| `customer_hash_id` | ― | 対象外(会員番号なしのため生成不可。NULLのまま) |
| `is_new_customer` | `このサロンに行くのは初めてですか？`(46) | 値が「はい」相当なら`true`、それ以外`false`。空欄時は`false`とする(要確認: 実データでのこの列の実際の値パターンは今回のサンプルでは確認できていないため、Import実行前に値のバリエーションを再確認すること) |
| `notes` | `ご要望・ご相談`(40) or `予約時ご要望`(43) | 任意。どちらを採用するか要決定(本設計では`予約時ご要望`を優先し、空なら`ご要望・ご相談`を採用する案) |
| `created_at` | ― | DB既定値(`now()`) |

未使用列(設計上マッピング不要と判断): `キャンセル料`・`設備名称`・`指名予約有無`(→将来`is_nomination`相当の列が`reservations`に追加されれば利用可、現状は破棄)・`予約経路`・`支払い種別`・各種HotPepperBeautyクーポン列・ギフト券/ポイント列・`会計時*`系列(来店処理後の実額であり、予約時点の`reservations`とは責務が異なる。将来`brain_visits`との突合に使える可能性はあるが本設計のスコープ外)。

---

## ② status変換ルール

| CSV「ステータス」 | `reservations.status` | 理由 |
|---|---|---|
| `受付待ち` | `confirmed` | 予約確定・未来店 |
| `会計済み` | `completed` | 来店・精算完了 |
| `お客様キャンセル` | `cancelled` | 予約取消 |
| (該当なし) | `in_progress` | 本CSVには対応する状態が存在しない(施術中はSalonBoard上リアルタイム性がなくエクスポートに現れないため)。マッピング対象外とし、想定外のステータス文字列が来た場合は取込エラー(スキップ+ログ記録)として扱う |

既存DB実データの`status`実測値(`completed`/`confirmed`)と矛盾しないマッピング。

---

## ③ customer_id(brain_customer_id)名寄せロジック

### 方針: 電話番号優先・氏名補助

CSVの`お客様番号`(列30)が**全行空欄**のため、既存`customerMatcher.ts`の主戦略(会員番号=`external_key_hash`完全一致)は使えない。代わりに以下の優先順位を提案:

```
① 電話番号(お客様番号相当の代替キー)で brain_customers を検索
   一致 → 確定マッチ
   不一致 ↓
② 氏名(お名前 / フリガナ)で既存 customerMatcher.findNameCandidates() を流用
   1件のみ一致 → 既存の「氏名+初回来店日」フォールバック方式(csvImportPipeline.tsの
   findAlreadyImportedCandidate/Pass Nロジック)を参考に確定 or needs_review
   複数一致 → needs_review(運用者確認)
   0件 → 新規顧客 として扱うか、reservations単体では新規customer作成をせず
   「未マッチ(brain_customer_id=NULL)」のまま保存する(要方針決定、下記参照)
```

### 既存customerMatcher流用可否: **部分的に流用可**

- `findNameCandidates()` / `decideCustomerMatch()`はそのまま再利用可能(brain_customers一覧を受け取り氏名キー一致を返すだけの汎用関数のため)
- ただし**電話番号による一致検索は既存コードに存在しない**(既存は`external_key_hash`のみ)。`brain_customers`に電話番号を保持する列があるか要確認(未調査。本設計書の範囲外だが実装着手前に必須の確認事項として明記する)
- 「予約のみでcustomer未特定」の場合の扱い(新規customer作成 or brain_customer_id=NULLで保留)は**運用方針の決定が必要**(既存の売上明細CSVは必ず来店実績を伴うため新規作成一択だったが、予約は来店前の情報のため同じ判断基準が使えない可能性がある)

---

## ④ staff_id解決方法

### 既存staffResolver流用可否: **流用可・ただし追加の変換層が必須**

`staffResolver.ts`は「CSV担当者名(生文字列) → `brain_staff.id`」を解決する(既存ロジックそのまま再利用可)。

しかし`reservations.staff_id`のFK先は`profiles`であり、`brain_staff`ではない。実DBを確認した結果、次の対応関係が存在する:

```
brain_staff.user_id  =  profiles.id   (1:1、値が入っている場合)
```

現状(実データ確認済み): `brain_staff`6件中、`鈴木`・`亀山`・`外舘`の3件のみ`user_id`(=`profiles.id`)が設定済み。この3名は今回調査したCSVの「スタッフ名」列に実際に出現する名前と一致する。

### 解決フロー(新設が必要)

```
CSVスタッフ名(生文字列)
   │
   ▼
staffResolver.resolveStaffId()  ── 既存関数そのまま再利用 → brain_staff.id
   │ 未解決 → unresolved(既存と同じ扱い)
   ▼
【新規】brain_staff.id → brain_staff.user_id 引き当て
   │ user_id が NULL → 解決不能(reservations.staff_idはNOT NULLのため取込不可・要スキップ)
   ▼
profiles.id として reservations.staff_id へ格納
```

「brain_staffは解決できたがuser_idが未設定」のケースが発生しうるため、CSV取込前に対象スタッフ全員へ`brain_staff.user_id`を設定しておく運用が前提となる(既存の`brain_staff.user_id`設定作業はPass AUTH-1で導入済みの仕組みを流用)。

---

## ⑤ menu解決方法

### 既存menuResolver流用可否: **不要(必須ではない)**

`reservations.menu`はFKではなく**text列**であるため、`予約時メニュー`(列17)の文字列をそのまま格納すればよく、`menuResolver.ts`によるIDの解決は必須ではない。

任意選択肢として、将来`brain_visits`(来店実績)とのクロス集計(例: 「予約時メニューと実際の施術メニューの乖離率」)を行う場合に限り、`menuResolver.resolveMenuId()`を使って参考的に`brain_menus.id`へ正規化・記録することは可能(その場合`reservations`に新規列追加が必要になるため、本フェーズのDB変更禁止の対象外＝将来検討事項とする)。

---

## ⑥ UPSERTキー候補

### 「予約番号」の利用可否: **現状は不可(対応するカラムがreservationsに存在しない)**

CSVの`予約番号`(例: `YG80499999`)は理想的な冪等キーだが、`reservations`には`予約番号`(外部予約ID)を保存する列が存在しない。これを正式に使うには**新規カラム追加(例: `external_reservation_id text UNIQUE`)のマイグレーションが必要**であり、本フェーズは「DB変更禁止」のため対象外。**この制約は次フェーズへの申し送り事項とする。**

### 暫定UPSERTキー案(スキーマ変更なしで実現する場合)

既存カラムのみを使った複合キー案:

```
(staff_id, scheduled_at, brain_customer_id)
```

**リスク・限界(要明記)**:
- 予約の日時変更(リスケジュール)があった場合、旧`scheduled_at`との一致が取れず**同一予約が別レコードとして重複登録される**(真の冪等性は担保できない)
- `brain_customer_id`が未解決(NULL)の予約が複数ある場合、`(staff_id, scheduled_at, NULL)`同士の重複を区別できない

**結論**: 暫定キーでの運用は「重複よりは欠損の方がマシ」という前提での妥協案であり、正確な冪等インポートを実現するには**「予約番号」列の追加マイグレーションが実質的に必須**である。この設計書では両案を併記し、意思決定を次フェーズに委ねる。

---

## ⑦ MD-5接続設計

### 前提: `brain_business_settings.seat_capacity`(jsonb)は現状未設定(null)

既存`app/api/admin/occupancy/route.ts`のコメントで明記されている通り、真の「稼働率(%)」算出には曜日×時間帯別の席数設定(`seat_capacity`)が別途必要。本設計は`reservations`導入により**「時間帯別来店数」と「稼働時間ベースの推移」までは算出可能**にするが、`seat_capacity`設定が別途完了するまでは「稼働率(%)」表示は引き続き`available:false`とする2段階設計を提案する。

### 時間帯別来店数(算出SQL案)

```sql
-- JST時間帯(0-23時)別の来店件数(status='completed'=実来店のみ集計する案)
SELECT
  EXTRACT(HOUR FROM scheduled_at AT TIME ZONE 'Asia/Tokyo')::int AS hour_of_day,
  COUNT(*) AS visit_count
FROM reservations
WHERE store相当の絞り込み(既存reservationsにstore_id列が無いため、
      staff_idをbrain_staff経由でstoreに紐付けるなど別途検討が必要)
  AND status = 'completed'
  AND scheduled_at >= :from_date
  AND scheduled_at <  :to_date
GROUP BY 1
ORDER BY 1;
```

### 稼働率推移(算出SQL案・Tier1: 稼働分数ベース、seat_capacity不要)

```sql
-- 日別・スタッフ別の稼働分数(予約ベース。confirmed+completedを稼働予定として集計する案)
SELECT
  (scheduled_at AT TIME ZONE 'Asia/Tokyo')::date AS visit_date,
  staff_id,
  SUM(duration_minutes) AS occupied_minutes
FROM reservations
WHERE status IN ('confirmed', 'completed')
  AND scheduled_at >= :from_date
  AND scheduled_at <  :to_date
GROUP BY 1, 2
ORDER BY 1, 2;
```

### 稼働率推移(算出SQL案・Tier2: 真の稼働率%、seat_capacity設定完了後)

```sql
-- Tier1のoccupied_minutesを、その曜日・時間帯のseat_capacity(営業可能分数)で除算する
-- (brain_business_settings.seat_capacityのjsonb構造確定後に具体化する。本設計書時点では未確定のためプレースホルダー)
occupancy_rate = occupied_minutes / capacity_minutes_for_that_day
```

`reservations`に`store_id`列が存在しない点は、今後の複数店舗対応時に別途検討が必要な既存の設計上のギャップとして申し送る(現状は単一店舗運用のため実害なし)。

---

## ⑧ 実装工数見積

| 作業項目 | 見積 | 理由 |
|---|---|---|
| CSVパーサー新規実装(59列ヘッダー解決・型変換・`toIsoJst`相当の日時結合) | 中 | 既存`salonBoardDetailParser.ts`と類似構造で流用可能な部分が多いが、列数が多くバリエーション調査(`is_new_customer`等の実値パターン)がまだ不足 |
| customer名寄せ(§3) | 中 | `customerMatcher.ts`の主要ロジックは流用可能だが、電話番号一致検索の新規実装・「未マッチ時の扱い」の方針決定が必要 |
| staff_id解決(§4) | 小〜中 | `staffResolver.ts`はそのまま流用可能だが、`brain_staff.user_id→profiles.id`の追加マッピング層が新規実装 |
| menu処理(§5) | 小 | text列にそのまま格納するだけで追加ロジック不要 |
| status変換(§2) | 小 | 単純なマッピングテーブル |
| UPSERTキー設計(§6) | 中〜大 | 「予約番号」列追加マイグレーションを行うかどうかで規模が大きく変わる(追加する場合はDB変更を伴うため別途承認・別フェーズが必要) |
| `IReservationRepo`新設・Repository層実装 | 中 | 既存`IVisitRepo`等と同水準のインターフェース設計・実装が必要 |
| Dry Run/Import両モードのAPI実装(既存`csv/dry-run`・`csv/import`と同パターン) | 中 | 既存パイプラインの構造(`buildDryRunResult`/`runImportPipeline`)を踏襲可能 |
| `occupancyRepo`拡張(時間帯別来店数・稼働率推移の実装、`hourlyVisits`/`occupancyTrend`をavailable:trueに変更) | 中 | 既存`IOccupancyRepo`への追加メソッド実装 |
| テスト(dry-run/importの単体テスト、既存パターン踏襲) | 中 | 既存CSV importテストと同水準を新規作成 |

**総合見積: 中〜大**

最大の不確定要素は⑥UPSERTキー(予約番号カラムの追加要否)であり、ここで「DB変更を伴うか否か」の意思決定次第で全体規模が変動する。DB変更を避ける場合は暫定複合キー案(§6)で「中」規模に収まるが、正確な冪等性を優先する場合は移行スコープが「大」に拡大する。

---

## 未確定・要決定事項(次フェーズへの申し送り)

1. `brain_customers`に電話番号カラムが存在するか(§3の名寄せロジック実装に必須)
2. 予約のみでcustomer未特定の場合、新規customer作成を行うか/`brain_customer_id=NULL`のまま保存するか
3. `予約番号`列追加マイグレーションの実施可否(§6)
4. `is_new_customer`列(46列目相当)の実データバリエーション再調査
5. `brain_business_settings.seat_capacity`のjsonb構造確定(Tier2稼働率%算出に必須)
6. 複数店舗対応時の`reservations.store_id`欠如への対応方針
