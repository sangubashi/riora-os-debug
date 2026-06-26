# CSV Import完成レポート

作成日: 2026-06-22

## 1. 実装済機能

### 1.1 パイプライン本体(`src/lib/import/csvImportPipeline.ts`)

| 機能 | 内容 |
|---|---|
| CSVデコード | SJIS/UTF-8自動判定(`csvEncoding.ts`)。実機SalonBoard CSV(SJIS)で動作確認済み |
| パース・会計ID集約 | `salonBoardDetailParser.ts`(1行=1明細→会計ID単位で1来店に集約) |
| PII除去 | `piiSanitizer.ts`(電話番号・メール・郵便番号・建物名等を読込時点で破棄、`piiFoundTotal`で件数報告) |
| menu_count_anomaly | 1会計内の`区分=メニュー`行が0件/2件以上 → `checkout_integrity_error`として除外 |
| スタッフ名寄せ | `staffResolver.ts`(`brain_staff.name`/`name_aliases`完全一致のみ。未解決はdry-runで集計・取込前に画面③で紐付け必須) |
| メニュー名寄せ | `menuResolver.ts`(完全一致のみ。フォールバック`role='imported_other'`は未適用店舗では存在せず、不一致は`checkout_integrity_error`) |
| 顧客突合 | `customerMatcher.ts`(会員番号ハッシュ完全一致→`matched`、氏名のみ一致候補→`needs_review`、候補無し→`new`) |
| **冪等性(本セッションで追加)** | 会員番号なし(氏名一致のみ)で再投入した場合、候補のうち「同日付でimport起源(`salonboard_import`/`reconciled`)のvisitを既に持つ候補」が一意であれば自動確定マッチとして扱う。`reviewDecisions`はリクエスト間で永続化されないため、これがないと氏名一致のみの行は再投入ごとに重複顧客を作ってしまう |
| reconciled対応 | 既存`staff_input`来店と同日付で突合した場合は`visitRepo.reconcile()`で`source='reconciled'`に切替(上書き、重複作成なし) |
| 冪等スキップ | 既存visitが既に`reconciled`/`salonboard_import`済みの場合は無処理(件数加算なし) |
| ops_log記録 | `brain_ops_logs`に`kind='csv_import'`で`{newCustomers, updatedCustomers, visitsImported, piiFoundTotal, unresolvedStaffCount, durationMs}`のみ記録(顧客名等PIIは一切含まない) |

### 1.2 管理者UI(`src/components/admin/csv-import/`)

- `CsvImportScreen.tsx`: ①CSV選択→②Dry Run結果→③未解決スタッフ紐付け→④要確認顧客(同姓同名)決定→⑤取込実行→完了レポート→取込履歴、の状態機械(`idle→parsing→dryrun_done→importing→done/error`)
- `StaffAliasManager.tsx`: `brain_staff.name_aliases`の閲覧・追加モーダル
- `mockApi.ts`: 関数名は`mock*`のままだが実体は全関数が実API(`fetch`)化済み

## 2. API一覧

| Method | Path | 用途 | DB書込 |
|---|---|---|---|
| POST | `/api/admin/csv/dry-run` | CSVアップロード→検証のみ(`buildDryRunResult`) | なし |
| POST | `/api/admin/csv/import` | CSVアップロード+`reviewDecisions`→実取込(`runImportPipeline`) | あり(customers/visits/ops_logs) |
| GET | `/api/admin/csv/history?storeId=` | `brain_ops_logs(kind='csv_import')`から取込履歴を返す | なし |
| GET | `/api/admin/staff-aliases?storeId=` | スタッフ一覧+登録済みエイリアス一覧 | なし |
| POST | `/api/admin/staff-aliases` | エイリアス追加(`brain_staff.name_aliases`) | あり |

いずれも`app/lib/repos.ts`の`getRepos()`経由でSupabaseに接続(直接`@supabase/supabase-js`をAPIルートからimportしない構成を遵守)。

## 3. テスト結果

### 3.1 単体テスト(fake repos・DB接続なし)

`tests/lib/import/csvImportPipeline.test.ts` 8件、すべて成功:

1. dry-runはDBへ一切書込まずunresolved_staff/needsReview/importableを集計する
2. menu_count_anomalyを`checkout_integrity_error`としてskippedに集計する
3. 会員番号一致の既存顧客を`matched`判定する(needsReviewに出さない)
4. 新規顧客+来店を作成し、`brain_ops_logs`へPIIゼロで記録する
5. 既存`staff_input`来店をCSVで突合して`reconciled`へ切替(会員番号で確定マッチ)
6. **冪等性**: 会員番号ありの同一CSVを複数回投入しても顧客・来店が重複しない
7. **冪等性**: 会員番号なし(氏名一致のみ)でも同一CSVの再投入で重複顧客を作らない
8. メニュー名不一致・フォールバック無しの会計はスキップする(来店・顧客を作らない)

全体テストスイート: **28 files / 312 tests 全成功**(`npm test`)

### 3.2 実APIによるE2E確認(実DB・dry-runのみ・書込なし)

ローカルでdevサーバーを起動し、`/api/admin/csv/dry-run`へ実ファイルをPOSTして確認(本番/PreviewとSupabaseプロジェクトを共有するDBのため、importの書込・重複投入テストはユーザー判断により**スキップ**し、上記単体テストの結果で代替報告)。

**`test-data/csv-import/salonboard_test_real_fixed.csv`(50会計・SJIS)**

```
totalRows: 50, importable: 0
skipped: 50件 (checkout_integrity_error)
unresolvedStaff: [{rawName: "外館", occurrenceCount: 2}]
```

このファイルは50会計のうち42会計が単一行で`区分≠メニュー`(menu_count_anomaly)、残り8会計は`メニュー`行はあるがメニュー名「フェイシャルエステ 60分」がデモ店舗の実メニュー名(ヒト幹15000/毛穴洗浄+ヒト幹19000等)と完全一致しないため除外。スタッフ名「外館」はデモ店舗の実スタッフ「外舘」と漢字が異なり不一致(表記ゆれの実例)。**いずれもパイプラインの誤動作ではなく、テスト用CSVの内容とデモ店舗マスタの不一致による正しい挙動**。

**`test-data/csv-import/salonboard_demo_sales_50customers.csv`(158行・93会計・SJIS)**

```
totalRows: 158, importable: 83
skipped: 75件 (すべてcheckout_integrity_error)
unresolvedStaff: [{rawName: "田中", occurrenceCount: 51}, {rawName: "久保田", occurrenceCount: 15}]
needsReview: 0
preview: 実데이터(氏名・性別・初回来店日)が正しく抽出されることを確認
```

実DBの実メニュー名・実スタッフ名に対して**正しく取込可否を判定し、importable=83件を検出**。`unresolvedStaff`(田中・久保田=デモ店舗未登録スタッフ)・`checkout_integrity_error`(メニュー名不一致)とも実DBに対して正しく動作することを確認。

GET `/api/admin/csv/history` も実DBに対して`{success:true, history:[]}`(未取込のため空)を確認。

### 3.3 エラーケース確認結果

| ケース | 確認方法 | 結果 |
|---|---|---|
| `unresolved_staff` | 実API+実DB(上記2ファイル) | ✅ 確認済み(外館/田中/久保田) |
| `checkout_integrity_error`(menu_count_anomaly含む) | 実API+実DB(上記2ファイル) | ✅ 確認済み |
| `needs_review` | 単体テスト(fake repos) | ✅ 確認済み(実DBには同姓同名候補となる既存顧客が0件のため実DBでは未検証) |
| `duplicate import`(冪等性) | 単体テスト(fake repos、会員番号あり/なし両方) | ✅ 確認済み(実DBへの重複投入はユーザー判断によりスキップ) |

### 3.4 型チェック

```
npm run typecheck
```
CSV Import関連ファイル(`csvImportPipeline.ts`/API routes/UIコンポーネント/テスト)はエラーなし。`e2e/prod-verify.spec.ts`・`e2e/voice-memo-verify.spec.ts`に既存の(本セッションの変更と無関係・git差分なし)型エラー2件があるが、CSV Importの範囲外。

## 4. 残課題

1. **`imported_other`フォールバックメニュー未適用**: `supabase/migrations/20260621_csv_import_fallback_menu_seed.sql`がデモ店舗に未適用。完全一致しないメニュー名はすべて`checkout_integrity_error`になる(実検証で確認した通り、実際のSalonBoard CSVのメニュー名はマスタと完全一致しないことが多い)。
2. **`needs_review`・重複投入の実DB検証が未実施**: 本番/Previewと共有するDBのため書込テストをスキップした。別店舗ID(テスト専用store)を用意するか、ステージング専用Supabaseプロジェクトを分離すれば実DBでも安全に検証可能。
3. **テスト用CSV(`salonboard_test_real_fixed.csv`)のデータ品質**: 50会計中42会計が単一行・`区分≠メニュー`という非現実的な構造になっている。実機相当の検証には`salonboard_demo_sales_50customers.csv`(メニュー行を必ず含む)の方が適している。
4. **顧客一覧0件表示問題(既知・別タスク)**: `brain_customers`への実投入後にUI(顧客一覧)へ反映されるか自体は今回未検証(import書込をスキップしたため)。過去に「30件取得/0件表示」問題が報告されている([[project_demo_mode]]参照)。CSV Import経由で顧客を作成した場合も同じ表示問題に当たる可能性がある。

## 5. 本番適用前チェックリスト

- [ ] `imported_other`フォールバックメニューseedを対象店舗に適用(残課題1)
- [ ] テスト専用store(またはステージングSupabaseプロジェクト)でimport書込・重複投入・reconcileを実DBで検証
- [ ] 同姓同名の既存顧客が存在する状態で`needs_review`→`merge`/`new`選択UIが実DBで正しく動作することを確認
- [ ] 顧客一覧UIがCSV Import経由で作成した顧客を正しく表示することを確認(既知の0件表示問題と合わせて)
- [ ] 実際のSalonBoardエクスポートCSV(複数明細行/複数行区分混在)で本番相当のファイルサイズ・行数での動作確認
- [ ] `brain_ops_logs.detail`にPIIが含まれないことを本番データでも再確認(現状はテストでのみ保証)
- [ ] owner権限以外のユーザーで`/api/admin/csv/*`・`/api/admin/staff-aliases`にアクセス制御(認可)が掛かっていることを確認(本レポートでは未検証)
