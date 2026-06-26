# SalonBoard CSV Import Implementation Architecture v1.0

**株式会社martylabo / Salon Riora — SalonBoard CSV取込 実装仕様(確定版)**
作成日: 2026-06-12
正典遵守: **CSV Import Security Architecture v1.0に完全準拠**(本書はその実装実体)。Master Schema v1.7(W14)/ Repository & RPC v1.0 の規約を継承。
実装時期: Step8-3(既存顧客移行)の前提ツール。画面はManager専用ユーティリティ(/admin/import)として実装し、既存UIロック対象外のadmin枠で追加(UIルール4色・銀座系は準拠)。

## 0. ファイル構成と命名対応

```
src/app/admin/import/
  CSVUploadPage.tsx            # UI(Manager専用)
src/services/import/
  CsvParser.ts                 # ②解析(SJIS対応・ストリーム)
  CsvSanitizer.ts              # ④PII除去(Security Arch『PiiSanitizer』の実装名)
  AddressTruncator.ts          # 住所切詰め(Security Arch 3-2そのまま)
  ImportValidationService.ts   # ③検証(dry-run)
  CustomerImportService.ts     # ⑤⑥取込・UPSERT(Security Arch『CsvImportService+CustomerMatcher』を統合)
  ColumnPolicy.ts              # 分類表定数(Security Arch 1章)
supabase/migrations/W14_csv_import.sql   # 列追加+RPC csv_import_chunk+アンチスキーマCI
tests/services/import/
```

## 1. UIフロー(CSVUploadPage.tsx)

```
[1] ファイル選択(.csv のみ・上限10MB)
     画面常設文言: 『電話番号・メール・郵便番号・建物名・部屋番号・メモ欄は
     保存されず、読み込み時点で破棄されます』
[2] 解析+ドライラン(自動実行・保存なし)
     表示: 総行数 / 取込可能 / 要確認 / スキップ / 破棄した列の一覧(列名のみ)
     プレビュー: 先頭3行を**サニタイズ後の保持項目のみ**で表示
       (氏名・性別・年代・都道府県市区町村・初回来店日 — 破棄済み項目は欄ごと非表示)
[3] 要確認リスト(同姓同名候補): 各行 [同一人物として統合][別人として新規](既定=別人)
[4] [取り込みを実行する] → チャンク進捗バー(500行単位)
[5] 完了レポート: 新規N名 / 更新N名 / 来店履歴N件 / PII混入検出N件(値は表示しない)
     [ops_logsで監査可能]の注記。エラー行は「行番号+理由」のみのリスト
```

状態機械: idle → parsing → dryrun_done → importing → done / error。**[2]までは一切書込なし**(プレビュー=メモリ上のサニタイズ結果)。離脱・リロードで全破棄。

## 2. CsvParser.ts(アップロード・解析)

```typescript
export class CsvParser {
  /** File→行ストリーム。原本をどこにも書かない */
  async *parse(file: File): AsyncGenerator<RawRow, ParseSummary> {
    // 1. エンコーディング判定: 先頭バイトでShift_JIS/UTF-8(BOM)判別
    //    → SalonBoard既定はShift_JIS。TextDecoder('shift_jis')でストリームデコード
    // 2. CSV解析: papaparse(stream mode)。クォート内改行・カンマ対応
    // 3. ヘッダ正規化: 全角空白除去・ゆらぎ吸収マップ
    //    ('携帯電話番号'/'携帯TEL'→'mobile' 等。ColumnPolicy.HEADER_ALIASES)
    // 4. 未知ヘッダ → unknownColumns[]に列名のみ記録(値は読み捨て)
    // 制約: file.text()一括読みの禁止(10MB上限でも streamで統一・S-10メモリ条件)
  }
}
```

## 3. ColumnPolicy.ts(SalonBoard列マッピング確定)

| SalonBoard列(別名含む) | 分類 | 先 |
|---|---|---|
| 会員番号/お客様番号 | TRANSFORM | external_key_hash=sha256(値+anon_salt) |
| 氏名/カナ | KEEP | customers.name(カナはname_kana) |
| 性別 | KEEP | customers.gender |
| 生年月日 | TRANSFORM | age_group+birth_month → 原値破棄 |
| 住所 | TRANSFORM | AddressTruncator → prefecture/city |
| **電話番号/携帯/TEL** | **DROP** | — |
| **メールアドレス** | **DROP** | — |
| **郵便番号** | **DROP** | — |
| **建物名/マンション名/部屋番号** | **DROP** | — |
| **メモ/備考/カウンセリング内容(自由記述全列)** | **DROP** | — |
| 来店日/利用日 | KEEP | visits.visit_date(履歴行) |
| メニュー/コース | KEEP | visits.menu_name_raw → menus突合(不一致は'imported_other') |
| 担当/指名スタッフ | KEEP | staff名寄せ(3名固定辞書)+is_nomination |
| 利用金額/技術/店販 | KEEP | visits.treatment_amount/retail_amount |
| 初回来店日 | KEEP | customers.first_visit_date |

住所TRANSFORM注記: 番地以降・建物・部屋はAddressTruncatorの構造上**通過不可能**(出力型が{prefecture, city}の2フィールドのみ — 「保存しない」を型で保証)。

## 4. CsvSanitizer.ts(PII除去)

Security Architecture 3-1の実装。確定追加事項のみ記す:

```typescript
export class CsvSanitizer {
  sanitizeRow(raw: RawRow, policy: ColumnPolicy): { clean: SanitizedRow; report: RowReport } {
    // 処理順固定: DROP(物理delete) → TRANSFORM → 残存PII走査(KEEP列全て)
    // 残存PII正規表現(KEEP列の値に適用):
    //   PHONE  /(?:0\d{1,4}[-‐ー ]?\d{1,4}[-‐ー ]?\d{3,4})/   ※全角ハイフン・空白対応
    //   EMAIL  /[\w.+-]+@[\w-]+\.[\w.]+/
    //   POSTAL /〒?\s?\d{3}[-‐ー]?\d{4}/
    //   → '[削除済]'置換+report.piiFound++(値はreportに含めない)
    // 全角→半角正規化を走査前に実施(０９０-… の検出漏れ防止)
  }
}
// pure・throwしない・1行の異常は当該行をinvalid化して継続(Engine規約継承)
```

## 5. ImportValidationService.ts(ドライラン)

```typescript
export interface ValidationResult {
  importable: number; needsReview: ReviewItem[]; skipped: SkipItem[];
  unknownColumns: string[]; piiFoundTotal: number;
  preview: SanitizedPreviewRow[];          // 先頭3行・保持項目のみ
}
export class ImportValidationService {
  async dryRun(rows: AsyncGenerator<RawRow>, storeId: UUID): Promise<ValidationResult> {
    // 行検証(理由コード固定):
    //  'invalid_date'(来店日不正) / 'missing_name' / 'duplicate_in_file'(同一会員番号×来店日)
    //  'future_date' / 'amount_out_of_range'(0〜500,000外)
    // 照合プレチェック: external_key_hash既存→『更新』/ 会員番号なし×氏名一致→needsReview
    // SkipItem/ReviewItem = { rowNumber, reasonCode } のみ(セル値を持たない型 — エコーバック禁止を型で強制)
  }
}
```

## 6. CustomerImportService.ts(Import・UPSERT)

```typescript
export class CustomerImportService {
  async execute(rows: SanitizedRow[], decisions: ReviewDecision[],
                storeId: UUID, actorId: UUID): Promise<ImportReport> {
    // 1. 顧客解決(行→customer_id):
    //    a. external_key_hash完全一致 → 既存
    //    b. needsReview決定: merge指定→既存 / それ以外→新規(安全側既定)
    //    c. 新規: customers INSERT(consent_anonymized_learning=false で開始
    //       — CSV移行客は同意未取得。初回来店時にカウンセリングで取得・ETL除外が効く)
    // 2. チャンクUPSERT: RPC csv_import_chunk(jsonb[], 500行/TX)
    //    customers: ON CONFLICT(store_id, external_key_hash) DO UPDATE(prefecture/city/
    //      age_group等の空欄補完のみ・既存の手入力値を上書きしない COALESCE方向)
    //    visits(過去履歴): ON CONFLICT(store_id, customer_id, visit_date, menu_name_raw)
    //      DO NOTHING(再取込冪等)。visit_count_atは取込後に一括再採番(時系列ソート)
    //    source='salonboard_import' を必ず付与(学習側で移行データを区別可能に
    //      — 移行履歴は周期計算に使うが提案outcomes学習には使わない)
    // 3. チャンク失敗: 当該チャンクのみロールバック・他チャンク継続・failedChunks記録
    // 4. ImportReport → ops_logs(kind='csv_import')。内容は件数とdurationのみ
  }
}
```

## 7. エラーハンドリング・ログ戦略

| 事象 | 挙動 |
|---|---|
| エンコーディング判定不能/CSV破損 | parsing段階で中断。『ファイル形式を確認してください(SalonBoardの標準CSV出力をご利用ください)』のみ表示。**ファイル内容をエラーに含めない** |
| 行エラー | 行番号+理由コードのみ(5章の型で強制)。UIは理由コード→日本語辞書で表示 |
| チャンクTX失敗 | 該当500行をfailedとし継続。完了レポートに『N件は取り込めませんでした。同じファイルをもう一度実行すると未取込分のみ追加されます』(冪等が復旧手段) |
| ログ | ops_logs(kind='csv_import') detail={rows_total, imported_new, imported_update, visits, skipped, pii_found, unknown_columns(列名のみ), duration_ms, sanitizer_version, actor}。**console.log(row)はlint禁止**(Security Arch継承・src/services/import/配下でfs/Storage/console.log(変数)検出) |
| 監査 | 「いつ・誰が・何件」のみ追跡可能。原本非保存のため内容再現は不能(仕様) |

## 8. テスト戦略

Security Architecture S-1〜S-10を全継承した上で、実装固有を追加:

| # | テスト |
|---|---|
| I-1 | Shift_JIS実ファイル(SalonBoardサンプル)の解析・文字化けゼロ/UTF-8 BOM両対応 |
| I-2 | ヘッダゆらぎ: '携帯TEL'/'携帯電話番号'が共にDROPされる(ALIASES網羅) |
| I-3 | 全角PII: '０９０－１２３４－５６７８'が氏名欄から検出・置換される |
| I-4 | 住所型保証: SanitizedRowに address/building/room フィールドが型レベルで不存在(コンパイルテスト) |
| I-5 | 同姓同名: 既定で別人新規/merge指定で統合/自動マージ不発生 |
| I-6 | 冪等: 同一ファイル2回→増分ゼロ/チャンク失敗→再実行で未取込分のみ追加 |
| I-7 | visit_count_at再採番: 移行履歴3件+新規来店1件で1,2,3,4の時系列連番 |
| I-8 | consent: 移行客consent=falseでETL除外(brain_eventsに不出現) |
| I-9 | source区別: salonboard_import行がproposal学習の母集団に入らない |
| I-10 | UI: dryrun段階でDB書込ゼロ(クエリログ検証)/プレビューに破棄項目が非表示 |
| I-11 | 10MB/5,000行: ストリームで<30s・ピークメモリ<256MB(S-10再掲・実装で実測) |

## 9. 実装順(Claude Code)

```
M-1 ColumnPolicy+CsvParser(SJIS・ストリーム)         [I-1,I-2]
M-2 CsvSanitizer+AddressTruncator(Security Arch C-1) [I-3,I-4,S-1〜S-3]
M-3 W14マイグレーション+RPC csv_import_chunk         [I-6,I-7,S-8]
M-4 ImportValidationService+CustomerImportService     [I-5,I-8,I-9]
M-5 CSVUploadPage(admin枠・4色準拠)+lintルール        [I-10,S-4,S-5]
M-6 統合: SalonBoard実CSVサンプルでE2E+性能実測       [I-11]
依存: M-2はM-1と並行可。Step8-3の移行作業はM-6完了が前提。
```

---
*SalonBoard CSV Import Implementation Architecture v1.0 — Security Architecture v1.0の実装実体。「破棄は型で保証し、復旧は冪等で行い、原本はどこにも残さない」。*
