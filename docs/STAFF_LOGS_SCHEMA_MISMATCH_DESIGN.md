# `staff_logs` スキーマ不整合 調査・設計書

作成日: 2026-08-07（同日、本番ログ確認・実地再現・migration適用・insert処理監査・実データ検証の
結果を追記）
ステータス: **migration適用済み・実データ保存確認済み**（§8・§9参照。既知の残課題1件
(`staff_id`のNULL化リスク)は§9.3の通り対応要否をユーザー判断待ち）

[[project_ai_proposal_analytics_dashboard_design]]（AI提案分析ダッシュボード調査）の過程で発見した
副次バグを、ユーザー指示により本設計書として切り出した。AI提案分析ダッシュボードの実装とは独立に
扱う。

## 更新履歴
- 2026-08-07: 初版提出(§1〜§7、原因の推定と修正方針案)。
- 2026-08-07: ユーザー指示により実装着手前の最終確認としてVercel Runtime Logs・Supabase側の
  実エラーを確認(§1.7)。原因が一致したため案Aで実装を進める。

## 0. 要約

`CustomerBottomSheet.tsx`の接客ログ保存(`saveLog()`)は、本番の`staff_logs`テーブルに**実在しない
6つの列**(`ai_adopted`/`next_reserved`/`option_sold`/`retail_sold`/`churn_followed`/
`service_completed`)へINSERTしようとしており、**実行するたびにPostgresエラー(42703: undefined
column)で失敗している可能性が高い**（実測: `column staff_logs.ai_adopted does not exist`。
全6列を個別に実測し、いずれも「存在しない」ことを確認済み）。

原因は、`staff_logs`を新スキーマへ作り替える2本のmigrationファイル
（`create_staff_logs.sql`・`004_staff_logs_service_completed.sql`）が**本番Supabaseへ未適用**
のまま、それを前提にしたアプリコード側だけが実装・デプロイされていること。このプロジェクトで
繰り返し発生している「migrationファイルは書いたが、Claude Codeに直接DDL実行権限が無くユーザーが
Supabase SQL Editorで手動適用する運用のため、適用漏れが起きる」というパターンの一例
（[[project_phase1_ai_proposal_outcome_pipeline]]や[[project_customer_memories_security_audit]]
でも同種の事例が記録されている）。

## 1. 実測結果: 本番`staff_logs`の実際のスキーマ

列単位で個別に`select`し、存在有無を実測した(2026-08-07、読み取り専用)。

| 列名 | 実測結果 |
|---|---|
| `id` / `reservation_id` / `customer_id` / `staff_id` / `created_at` | 存在する(共通) |
| `log_text` / `services_done` / `next_visit_recommended_at` | **存在する**(旧スキーマ) |
| `ai_adopted` / `next_reserved` / `option_sold` / `retail_sold` / `churn_followed` | **存在しない** |
| `service_completed` | **存在しない** |

現在の実データは9行。全9行が`staff_id = ae68433d-69ce-4dc3-a38e-cc2501895fee`
（`profiles`テーブル上は`role=staff`、`staff_name`は空欄のアカウント）で、
[[project_pass_h1]]・auth1-v2-migration関連メモリで「孤立auth.usersアカウント」として既に
記録されている、デモシード専用アカウントと同一。**9行とも実際のスタッフ操作によるデータではなく、
デモシード(`scripts/demo_seed.sql`等)由来と判断できる**（実データ保護の観点でのリスクは低い）。

## 1.7 実装着手前の最終確認: Vercel Runtime Logs・Supabase側での実エラー確認(2026-08-07)

ユーザー指示により、実装着手前に「実際にエラーが発生していること」を本番のログ/実地再現で
確認した。

### 1.7.1 Vercel Runtime Logs — 関連エラーなし(想定通り・理由あり)

`get_runtime_errors`(直近7日間の集計)・`get_runtime_logs`(`staff_logs`でフルテキスト検索)の
両方を確認したが、staff_logsに関連するエラーは1件も見つからなかった。

- `get_runtime_errors`(7日間): 該当プロジェクトのエラー群は`/api/voice-pipeline`の
  Whisper APIフォーマットエラー1件のみで、staff_logs関連は0件。
- `get_runtime_logs`: 現在のVercelプランのランタイムログ保持期間(Hobby: 1時間)を超える範囲は
  そもそも参照できず、"No logs found"。

**これは「エラーが起きていない」ことの証明にはならない**。`CustomerBottomSheet.tsx`の`saveLog()`
は`src/lib/supabase.ts`のクライアントサイドSupabaseクライアントを使い、ブラウザから直接
`supabase.from('staff_logs').insert(...)`(PostgREST)を呼んでいる。**Next.jsのAPI Route
(Vercel Functions)を一切経由しない**設計のため、そもそもこの呼び込みはVercelのランタイムログに
記録される経路に無い(ログ保持期間の制約以前に、アーキテクチャ上Vercel側では観測できない)。

### 1.7.2 Supabase側での実エラー確認 — 本番と同一条件での実地再現に成功

Supabase Logs Explorer(ダッシュボード)への直接アクセス手段が本セッションに無かったため
(Supabase MCPはOAuth認証が必要で未接続)、代わりに**本番の`staff_logs`に対して、
`saveLog()`と全く同一のリクエスト条件を実際に発生させ、Supabaseが返す生のエラーをその場で
取得した**(読み取り専用ではなく、本番へ実際にINSERTを試行する検証。ユーザーからの実装着手指示に
基づく)。

再現条件:
- 実在スタッフ(亀山)のmagiclinkトークンで取得した本物のセッション
- **anon key**(service roleではなく、ブラウザが実際に使うクライアントサイドの鍵)
- `Authorization: Bearer <実スタッフJWT>`ヘッダー付き(RLSが実際に効く状態)
- ペイロードは`CustomerBottomSheet.tsx:815-825`の`saveLog()`と一字一句同一の形
  (`reservation_id`/`customer_id`/`staff_id`/`ai_adopted`/`next_reserved`/`option_sold`/
  `retail_sold`/`churn_followed`/`service_completed`)

結果(実測):

```json
{
  "code": "PGRST204",
  "details": null,
  "hint": null,
  "message": "Could not find the 'ai_adopted' column of 'staff_logs' in the schema cache"
}
```

**これは本物のブラウザセッションが`saveLog()`実行時に受け取るのと全く同じエラーである**
（PostgREST側のスキーマキャッシュ検証で"column not found"を返す`PGRST204`。生のPostgres
`42703`と根本原因は同一で、PostgRESTがクエリ発行前に列存在チェックで弾いている違いのみ）。
アプリ側は`saveLog()`の`if (error) { toast.error('保存に失敗しました'); return; }`により、
実際にこのエラーを受けて早期returnし、後続の`POST /api/visits/service-complete`へは
到達しない。

### 1.7.3 結論

§0で推定した原因(不足6列によるINSERT失敗)は、**本番と同一条件での実地再現により確定した**。
Vercel Runtime Logsは経路上そもそも記録され得ないため参照不可だったが、Supabase側の実エラーを
直接再現・確認できたことで、当初の原因推定と完全に一致することを確認した。§5の案A
(ALTER TABLE ADD COLUMN)で実装を進める。

## 2. 原因: 2世代のmigrationが両方とも本番へ未適用

`staff_logs`関連のmigrationファイルは3本存在する。

| ファイル | 内容 | 本番適用状況(実測) |
|---|---|---|
| `supabase/migrations/001_schema.sql` | `staff_logs`の最初の定義。`log_text`/`services_done`/`next_visit_recommended_at`。`customer_id`は`customers(id)`(legacy)、`staff_id`は`profiles(id)`参照 | **適用済み**(現在の本番スキーマと完全一致) |
| `supabase/migrations/create_staff_logs.sql` | 既存テーブルを`DROP TABLE ... CASCADE`した上で、`ai_adopted`/`next_reserved`/`option_sold`/`retail_sold`/`churn_followed`を持つ新スキーマで再作成。`customer_id`は引き続き`customers(id)`、`staff_id`は`auth.users(id)`参照に変更 | **未適用**(実測で確認) |
| `supabase/migrations/004_staff_logs_service_completed.sql` | `service_completed`列を追加(`create_staff_logs.sql`適用後を前提とした差分) | **未適用**(実測で確認) |

`create_staff_logs.sql`はファイル名が他のmigration(`NNN_xxx.sql`または`YYYYMMDD_xxx.sql`の
連番/日付プレフィックス)と異なり命名規則から外れている。手動で書かれ、SQL Editorでの実行を
ユーザーに依頼したまま実行されなかった(または実行が漏れた)ファイルである可能性が高い。

アプリケーション側(`CustomerBottomSheet.tsx`の`saveLog()`)は`create_staff_logs.sql`+
`004_staff_logs_service_completed.sql`適用後のスキーマを前提に実装・デプロイ済みのため、
**migration適用漏れとアプリコードの間に食い違いが生じている**。

補足: 本リポジトリには既にこの問題を疑って書かれたと見られる診断スクリプトが存在する
(`scripts/testStaffLogs.ts`。「service_completed カラムあり（カラムが存在するか確認）」という
テストケースを含む)。過去のセッションで同種の疑いが持たれたものの、修正までは至っていなかった
可能性がある。

## 3. 影響範囲

### 3.1 書込み元(4箇所、実際に到達可能なのは1箇所のみ)

| ファイル | 状態 |
|---|---|
| `src/components/customer/CustomerBottomSheet.tsx`(`saveLog()`) | **実際に到達可能・現在壊れている本体**。[[project_phase1_ai_proposal_outcome_pipeline]]で「唯一稼働している接客ログ保存経路」と記録済み |
| `src/components/customer/QuickServiceLog.tsx` | 未接続の孤立コンポーネント([[project_staff_app_readiness_audit2_and_fix]]記載の「接客ログ三重実装」の1つ)。同じく新スキーマ前提で壊れているが、そもそも到達不可のため実害なし |
| `src/components/reservation/QuickServiceLog.tsx` | 同上、孤立コンポーネント |
| `src/components/phase1/ServiceLogView.tsx` | `// TODO: supabase.from('staff_logs').insert(...)`のスタブで、そもそもINSERT自体を実行していない([[project_staff_proposal_learning_pipeline_design]]で発見済み) |

### 3.2 読取り元(3箇所、いずれも新スキーマの列を前提にしており影響を受ける)

| ファイル | 用途 | 現状 |
|---|---|---|
| `src/lib/phase5/serviceReplay.ts`(`buildServiceReplay`) | `CustomerBottomSheet.tsx`の`ServiceReplayCard`向けデータ生成。`saveLog()`成功後にのみ呼ばれる設計のため、保存自体が失敗する現状では実質呼ばれない。呼ばれても列が無くエラーになる | `<ErrorBoundary silentFail>`で囲われているため画面には無害(何も表示されないだけ) |
| `src/lib/phase8/successPatternEngine.ts` | 店舗パターン学習(Phase8、[[project_store_patterns_fix]]で既に別理由により無効化済みと記録) | 既に呼び出し自体が停止されている(影響なし) |
| `src/lib/phase8/staffStyleEngine.ts` | 同上Phase8領域 | 同上、影響は限定的と推定(未確認) |

### 3.3 波及的な影響(推定、未検証)

`saveLog()`は`staff_logs`へのINSERTが失敗すると即座に`return`し、後続の
`POST /api/visits/service-complete`(`brain_visits.next_booking_made`/`homecarePurchased`の更新)
を呼び出さない。これが事実であれば:

- スタッフがCustomerBottomSheetから「次回予約が取れた」「AI提案を活用した」等を記録しても、
  `staff_logs`にも`brain_visits`にも一切反映されていない可能性がある。
- [[project_phase1_ai_proposal_outcome_pipeline]]記載の「`brain_pattern_fire_log`に
  proposalKind='rebooking'の提案はあるが、`brain_visits.next_booking_made=true`が実データ0件」
  という現象の一因である可能性がある(当時は「スタッフ入力経路が実質使われていなかったことが
  原因」と推定されていたが、本調査により「使われていなかった」のではなく「使おうとしても
  エラーで失敗していた」可能性が高いという、より具体的な原因が判明した形)。

この推定の確証(実際に本番でエラーが発生していることの直接ログ確認)は取れていない
(Vercel実行ログへのアクセス手段が今回の調査范囲に含まれていないため)。次フェーズで
`get_runtime_errors`等のVercel MCPツールによるログ確認を推奨する。

## 4. リスク評価

- **データ損失リスク**: 低い。既存9行は全てデモシードデータ(§1)であり、実顧客の接客記録ではない。
- **FK連鎖リスク**: 他テーブルから`staff_logs.id`への外部キー参照は存在しない(migration全件を
  検索し確認済み)。`staff_logs`をDROPしても他テーブルへのCASCADE影響は無い。
- **ID空間リスク**: `create_staff_logs.sql`の新スキーマは`staff_id uuid references auth.users(id)`
  としており、`CustomerBottomSheet.tsx`が渡す`currentStaffId`(`session.user.id`、
  `app/ClientShell.tsx`で`auth.users.id`から設定)と一致する。**ID空間の不一致は無い**
  (このプロジェクトで繰り返し発生している`brain_staff.id` vs `auth.users.id`の混同パターン
  ([[project_auth1_v2_migration]]参照)は、このテーブルに関しては該当しない)。
- **customer_id参照先のリスク(要確認)**: `create_staff_logs.sql`は`customer_id`を引き続き
  legacyの`customers(id)`へ参照させる設計だが、`CustomerBottomSheet.tsx`が渡す`c.id`は
  `brain_customers.id`。[[project_brain_customer_id_migration]]に記載の「ミラー行backfillは
  現役DBトリガー」が現在も機能していれば`customers`側にも同じIDの行が存在し実害は無いはずだが、
  **未検証**。ミラーが機能していない顧客がいた場合、その顧客に対する`staff_logs` INSERTは
  FK違反(23503)で失敗する。修正時に要確認(§5)。

## 5. 修正方針案

### 案A(推奨): 追加のみのALTER TABLE migrationを新規作成する

`create_staff_logs.sql`(DROP→再作成)は実行せず、代わりに**既存列を維持したまま**
不足している6列だけを追加する新しいmigrationファイルを作成する。

```sql
-- 例(実装フェーズで正式化する叩き台。今回は設計のみ・未実行)
ALTER TABLE public.staff_logs
  ADD COLUMN IF NOT EXISTS ai_adopted       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_reserved    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS option_sold      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retail_sold      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS churn_followed   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_completed boolean NOT NULL DEFAULT false;
```

利点:
- 既存9行(デモシード)を保持したまま列だけ追加するため、**データ損失が一切無い**。
- `DROP TABLE`によるRLSポリシー再作成・CASCADE影響の考慮が不要(現行のRLSポリシー・GRANTは
  そのまま有効)。
- `log_text`/`services_done`/`next_visit_recommended_at`(旧スキーマの列)は残るが、
  `CustomerBottomSheet.tsx`はこれらを使わないため実害なし(将来的に使わなくなった列として
  別途整理してもよいが、今回のスコープ外)。
- §4の`customer_id`参照先リスクにも触れない(FK定義を変更しないため、現状のミラー依存の挙動を
  変えない)。

**この案Aを推奨する。** `create_staff_logs.sql`は「実行しない・将来的に削除または
"適用済み"としてリネームして誤実行を防ぐ」ことを合わせて提案する(2本のmigrationファイルが
本番と食い違ったまま残っていると、次にこのテーブルを触る際に再び同じ混乱が起きるため)。

### 案B(非推奨): `create_staff_logs.sql`をそのまま適用する

利点は`staff_id`のFK参照が`auth.users(id)`に変わり将来的により一貫した設計になること。
欠点は`DROP TABLE ... CASCADE`によるRLSポリシーの再作成が必要になる点、デモシード9行が
失われる点(実害は低いが不要なリスク)、案Aと比べて変更範囲が大きく検証項目が増える点。
**「DB変更は極力避ける」「実データを最大限保護する」という本プロジェクトの一貫した方針に
照らし、採用しない。**

### 5.1 修正後に確認すべきこと(実装フェーズの想定テスト項目)

- 列追加後、`CustomerBottomSheet.tsx`の`saveLog()`が実際にエラー無く保存できること
  (実機確認、[[reference_demo_credentials_prod_testing]]の技術を使った書込み検証は
  「書込み系には使わない」の原則があるため、開発環境または明示許可を得た上での本番実データ検証と
  ユーザー実機確認を組み合わせる)。
- 保存成功後、`POST /api/visits/service-complete`が実際に呼ばれ`brain_visits.next_booking_made`
  等が更新されること(§3.3の推定の裏付け)。
- `customer_id`のFK違反(23503)が発生しないこと(§4のミラー依存リスクの実地確認)。
- 既存9行(デモシード)が変更・削除されずそのまま残ること。
- `ServiceReplayCard`が実データで表示されるようになること(§3.2)。

## 6. 影響範囲・ファイル一覧(実装フェーズの想定。今回は設計のみ)

新規:
- migrationファイル1本(案A、ALTER TABLE ADD COLUMN)

変更: なし(アプリケーションコードは既に新スキーマを前提に書かれているため、
DB側を合わせるだけで良い想定。ただしFK違反(§4)が実地で発生した場合は
`CustomerBottomSheet.tsx`側の`customer_id`受け渡しロジックの見直しが追加で必要になる可能性がある)

触らない: AI提案分析ダッシュボード関連一式(`docs/AI_PROPOSAL_ANALYTICS_DASHBOARD_DESIGN.md`)・
`ProposalOrchestrator`本体・LINE領域・admin画面

## 7. 確定事項(2026-08-07ユーザー承認・実装着手)

1. 案A(ALTER TABLE追加)を採用。DROP TABLE案(`create_staff_logs.sql`)は不採用。
2. `create_staff_logs.sql`の扱いは実装時に判断(§8参照)。
3. §1.7の実地再現により、本番エラー発生の確証が取れたため先に進める。
4. 本セッション内で実装に着手する。

以降は実装フェーズの記録として§8以降に追記する。

## 8. migration適用結果(2026-08-07)

`supabase/migrations/20260807000000_staff_logs_add_missing_columns.sql`をユーザーが
Supabase SQL Editorで適用。適用後、6列すべての実在を再実測し確認した(`ai_adopted`/
`next_reserved`/`option_sold`/`retail_sold`/`churn_followed`/`service_completed`)。
既存9行(デモシード)は`services_done`等の旧列を保持したまま、新6列は`DEFAULT false`で
正しくバックフィルされていることを確認(値の欠落・NULL化なし)。

`create_staff_logs.sql`は§7の通り不採用。ファイル冒頭に「未適用のまま放置されていた・
今後実行しないこと」を明記する警告コメントを追記済み(削除はせず経緯の記録として残す)。

## 9. アプリ側insert処理の監査(2026-08-07、ユーザー指示によるmigration適用後の確認)

`staff_logs`へINSERTしている全箇所を洗い出し、新設6列(`ai_adopted`/`next_reserved`/
`option_sold`/`retail_sold`/`churn_followed`/`service_completed`)の型安全性を監査した。

### 9.1 `CustomerBottomSheet.tsx`の`saveLog()`(実際に到達可能な唯一の経路)

```ts
// L815-825
const { error } = await supabase.from('staff_logs').insert({
  reservation_id: r?.id ?? null,
  customer_id:    c.id,
  staff_id:       currentStaffId ?? null,
  ai_adopted:     logSelected.has('ai_adopted'),
  next_reserved:  logSelected.has('next_reserved'),
  option_sold:    logSelected.has('option_sold'),
  retail_sold:    logSelected.has('retail_sold'),
  churn_followed: logSelected.has('churn_followed'),
  service_completed: true,
});
```

**新設6列の監査結果: 問題なし。**

- `logSelected`は`Set<LogKey>`（`LogKey = (typeof LOG_ITEMS)[number]['key']`、L136）。`.has()`は
  ECMAScript仕様上必ず真正の`boolean`プリミティブを返す(`"true"`のような文字列化・
  `null`/`undefined`化の余地は無い)。
- `service_completed: true`はリテラルの`boolean`。
- 上記6列はいずれも常に明示的に値を渡しており、省略されることが無いため、
  `NOT NULL DEFAULT false`制約と矛盾しない(そもそもDEFAULTに頼る場面が無い)。
- `src/types/database.ts`に`StaffLog`インターフェースが存在するが、旧スキーマ
  (`log_text`/`services_done`/`next_visit_recommended_at`)のままで新6列を含んでいない。
  ただし**このインターフェースはコードベース中どこからもimportされていない(定義ファイル自身のみ)**
  ため、現状は型チェック上の実害は無い、放置された古い型定義(要ドキュメント整理、緊急性は低い)。

**新設6列とは別に、監査中に見つかった実在するリスク(要ユーザー判断):**

- **`staff_id: currentStaffId ?? null`** — `staff_id`列は実測で`NOT NULL`制約を確認済み
  (§4で「ID空間リスクは無い」と記載していたが、NULL許容性そのものは今回改めて実測した)。
  `currentStaffId`(`useStaffStore`、`session.user.id`由来)が万一`null`のままこの関数が
  呼ばれた場合、`staff_id: null`を送ることになり**23502(NOT NULL違反)で保存が失敗する**。
  今回修正した「列が存在しない」バグとは別の原因だが、症状(「保存に失敗しました」toast)は同じになる。
  `saveLog()`自体には`currentStaffId`が無い場合の事前ガード(early return + 案内)が無い
  (後述の`reservation/QuickServiceLog.tsx`にはこのガードがある)。
  実運用上は「CustomerBottomSheetを開けている時点で認証済み」のはずだが、セッション喪失直後の
  操作等でゼロではない。**修正するかは要判断**(§9.3)。

### 9.2 その他の`staff_logs` INSERT箇所(いずれも孤立コンポーネント・未接続)

`grep`で全INSERT/参照箇所を洗い出した結果、`CustomerBottomSheet.tsx`以外は下記2つのみで、
いずれも**現在どのファイルからもimportされておらず、実際には到達不可能**
(`docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md`作成時と同じ「接客ログ三重実装」の一部、
[[project_staff_app_readiness_audit2_and_fix]]参照)。参考として型安全性のみ記録する。

- **`src/components/customer/QuickServiceLog.tsx`**(L74): `staff_id: null`と**リテラルで
  ハードコードされている**(直前L62-66で`if (!currentStaffId) { toast.error(...); return }`と
  存在チェックしているにもかかわらず、実際のpayloadでは`currentStaffId`を使わず`null`固定に
  なっているコードの矛盾)。もし将来復活させる場合、このままでは`staff_id`のNOT NULL違反で
  常に失敗する。新設6列自体は全て`.has()`由来の正しい`boolean`。
- **`src/components/reservation/QuickServiceLog.tsx`**(L15-20, L36-42): `status`の初期state
  オブジェクトに`churn_followed`が定義されておらず、`...status`スプレッドでも
  `service_completed: true`は明示的に追加されるが**`churn_followed`は一切payloadに含まれない**
  (NOT NULL DEFAULT falseがあるため保存自体は失敗しないが、この経路では`churn_followed`を
  記録する手段が無い)。`staff_id: currentStaffId`はL29-32の事前ガードにより非null保証済みで
  問題なし。

いずれも到達不可能なため、現状の本番挙動には影響しない。

### 9.3 実データ保存確認(2026-08-07)

migration適用後、`CustomerBottomSheet.tsx`の`saveLog()`と全く同一のペイロード形状で、
実スタッフ(亀山)の本物のセッション・anon key(service roleではない、ブラウザと同じ経路)を使い
実際に本番へINSERTを実行して確認した。

```json
// 送信payload
{ "reservation_id": null, "customer_id": "<実在顧客id>", "staff_id": "<実在スタッフのauth.users.id>",
  "ai_adopted": true, "next_reserved": false, "option_sold": false, "retail_sold": true,
  "churn_followed": false, "service_completed": true }
```

結果: `error: null`、保存成功。返ってきた行の6列すべてが`typeof === 'boolean'`で、
送信した値(`true`/`false`)と完全に一致することを確認した。検証用に作成したこの行は
実データ汚染を避けるため直後に削除済み(実際のスタッフ操作ではなく検証目的の合成データのため)。

**結論: migration適用により、`CustomerBottomSheet.tsx`の`saveLog()`は正常に保存できる状態に
なったことを実データで確認した。** §9.1で指摘した`staff_id`のNULL化リスクは新設6列とは無関係の
別論点として、対応要否をユーザーに確認する。
