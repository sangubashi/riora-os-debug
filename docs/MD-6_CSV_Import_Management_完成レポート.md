# MD-6 CSV Import Management 完成レポート

作成日: 2026-06-23

## 1. 実装範囲・前提

ユーザー指示により**既存CSV Import APIを再利用し、新規Importロジックは作らない**方針。調査の結果、Repository・API・UIの主要部分は前回セッション(CSV Import実フォーマット対応タスク)で既に実装済みであることを確認した。本タスクの主な作業は**①既存実装の各層の確認、②未着手だったAPI層のテスト追加、③実データでのエンドツーエンド動作確認(dry-run連携・import連携・履歴表示)、④スクリーンショット・レポート**。

## 2. DB確認

`docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md` §5の方針どおり、新規業務テーブルは追加していない。使用テーブル: `brain_customers`/`brain_visits`(冪等UPSERT先)、`brain_staff.name_aliases`(JSONB・スタッフ名表記ゆれ辞書)、`brain_ops_logs`(`kind='csv_import'`・取込履歴)。いずれも既存テーブルで、本タスクでの変更・migrationなし。

## 3. Repository確認

`PipelineRepos`(`src/lib/import/csvImportPipeline.ts`)が`customerRepo`/`visitRepo`/`staffRepo`/`menuRepo`/`storeRepo`/`opsLogRepo`を束ねる構成で既に実装済み。`app/lib/repos.ts`の`getRepos()`経由でAPI Routeに渡る。本タスクでの変更なし(確認のみ)。

## 4. API確認

| エンドポイント | 状態 |
|---|---|
| `POST /api/admin/csv/dry-run` | 既存実装(`buildDryRunResult`呼び出し)。確認のみ |
| `POST /api/admin/csv/import` | 既存実装(`runImportPipeline`呼び出し)。確認のみ |
| `GET /api/admin/csv/history` | 既存実装(`brain_ops_logs`から件数のみ返却・PIIなし)。確認のみ |
| `GET/POST /api/admin/staff-aliases` | 既存実装(`brain_staff.name_aliases`の閲覧・追加)。確認のみ |

4エンドポイントとも**テストが1件も無い状態だった**ため、本タスクで新規にルート契約テストを追加した(§7)。

## 5. UI実装

`src/components/admin/csv-import/CsvImportScreen.tsx`(状態機械: idle→parsing→dryrun_done→importing→done/error)・`StaffAliasManager.tsx`・`mockApi.ts`(関数名は`mock*`のままだが実体はすべて実API呼び出し)・`app/admin/csv-import/page.tsx`は前回セッションで実装済みであることを確認した。本タスクでのコード変更なし(UIレイヤーは「確認」のみで完了)。

## 6. dry-run連携・import連携・import履歴表示(実データ確認・完了)

Playwrightで本番同様のSupabaseプロジェクトに対し、実際のブラウザUIを操作して一連の流れを確認した(ユーザー承認済み・同一CSVのため取込は冪等性により新規0件)。

1. **① CSVを選択**: `売上明細_20260619145911.csv`(135行)を選択
2. **② Dry Run結果**: 取込可135 / 要確認0 / 除外0 / PII検出0 を画面に表示。プレビュー3行も正しく表示(スクリーンショット: `MD-6_csv_import_dryrun.png`)
3. **⑤ この内容で取り込む**ボタンをクリック → **取込完了**画面: 新規0 / 更新40 / 来店履歴0 / PII混入検出0(冪等性により新規作成なし。前タスクで投入済みの40顧客と一致)
4. **取込履歴**: クリック直後に新しい履歴行(`6/23 15:50 新規0 更新40 来店0`)が追加されて表示されることを確認(スクリーンショット: `MD-6_csv_import_done.png`)
5. **スタッフ名エイリアス管理**モーダル: 鈴木/亀山/外舘のスタッフ選択肢が正しく表示され、登録済みエイリアス0件(現状未登録)を正しく表示(スクリーンショット: `MD-6_staff_alias_manager.png`)

## 7. テスト結果

`npm test`: **41 files / 416 tests 全成功**(既存395件 + 本タスクで21件追加)
`npm run typecheck`: 既存無関係2件のみ残存。

新規テスト(API契約テストが0件だった4ルートに追加):
- `tests/api/csv-dry-run.test.ts`(5件): file_required/file_too_large/storeId既定値/エラー整形/Repository例外
- `tests/api/csv-import.test.ts`(5件): file_required/reviewDecisionsパース/不正JSON時の空オブジェクト化/エラー整形/Repository例外
- `tests/api/csv-history.test.ts`(5件): PIIを含まない履歴整形/0件時/storeId既定値/エラー系
- `tests/api/staff-aliases.test.ts`(6件): GET一覧/POST追加/バリデーション/404/不正JSON

いずれもルート自身の責務(multipart解析・バリデーション・エラー整形)のみを検証し、集計ロジック本体(`buildDryRunResult`/`runImportPipeline`)は`tests/lib/import/csvImportPipeline.test.ts`で別途検証済みのためモック化した(レイヤー間の責務分離をテスト設計でも維持)。

## 8. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_customers` | 冪等UPSERT先(氏名/会員番号ハッシュ突合) |
| `brain_visits` | 冪等UPSERT先(来店実績・`source='salonboard_import'`/`'reconciled'`) |
| `brain_staff` | `name_aliases`(JSONB)でスタッフ名寄せ辞書を保持 |
| `brain_ops_logs` | `kind='csv_import'`で取込履歴を記録(内容・PIIは含まない) |

新規業務テーブルの追加なし。

## 9. 残課題

1. **API認可(owner専用)の横断的な未検証**: MD-1〜MD-3と同じ既知のギャップ(前回CSV Importタスクの完成レポートでも既に明記済み)
2. **`imported_other`フォールバックメニューの他店舗への適用状況**: 前回タスクの残課題のまま(本タスクのスコープ外)
3. **大量行CSV(数千行規模)でのUI応答性は未検証**: 今回の実データ(135行)では問題なく完了したが、より大規模なファイルでの進捗表示・タイムアウトの検証は別途必要
