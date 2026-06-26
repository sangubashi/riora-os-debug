# Riora CSV Import Security Architecture v1.0

**株式会社martylabo / Salon Riora — Salon Board CSV取込の個人情報保護設計(確定版)**
作成日: 2026-06-12
正典関係: Master Schema v1.0–v1.6 / Brain完成設計(匿名化境界) / Repository & RPC v1.0 に準拠。本書はCSV取込経路のセキュリティの唯一の正。
基本思想: **「AI学習に不要な個人情報は、保存しないのが最強の保護」。破棄はSanitizer1箇所で、入口で、不可逆に行う。**

---

## 1. データ分類ポリシー(ColumnPolicy・確定表)

Salon Board CSVの全カラムを4分類する。**分類されていないカラムは既定DROP**(ホワイトリスト方式・未知カラムを通さない)。

| 分類 | 対象 | 処理 |
|---|---|---|
| **DROP(即時破棄)** | 電話番号 / 携帯番号 / メールアドレス / 郵便番号 / 建物名 / 部屋番号 / 番地以降 / 生年月日(年代変換後に破棄) / 自由記述メモ全列 | パース直後にメモリ上で破棄。DBに到達しない・ログにも出さない |
| **TRANSFORM(変換保持)** | 住所→都道府県+市区町村のみ / 生年月日→age_group('20s'等)+birth_month / 会員番号→sha256ハッシュ(照合キー) | 変換後の値のみ保存。原値は破棄 |
| **KEEP(そのまま保持)** | 氏名(表示用途限定) / 性別 / 来店履歴 / 施術メニュー / 購入履歴 / 指名スタッフ / 来店日 | 既存customers/visitsスキーマへ |
| **DERIVE(取込後に計算)** | 来店周期 / 継続率 / visit_count_at | 既存エンジンが算出(CSVから直接取らない) |

学習対象の確定(Brainに渡るもの): 来店履歴・施術履歴・購入履歴(band化)・継続率・来店周期・指名履歴のみ。**電話番号・メールアドレスはそもそも店舗DBにすら存在しない**ため、Brain層への流出経路は構造的にゼロ。

## 2. パイプライン(全体フロー)

```
CSVファイル(iPhone/PCアップロード)
 ↓ ①受領: メモリストリーム処理。Storage・/tmp・Supabase Storageへの書込禁止
 ↓ ②ヘッダ検証: ColumnPolicyと突合 → 未知カラムは警告リスト化+DROP
 ↓ ③PII Sanitizer(本書3章): 行単位で DROP→TRANSFORM→残存PII走査
 ↓ ④CustomerMatcher(本書4章): external_key_hash照合 → 既存更新 or 新規customer_id採番
 ↓ ⑤検証: 型・必須・重複 → 不合格行は「行番号+理由コードのみ」返却(内容は返さない)
 ↓ ⑥保存: customers / visits(過去履歴)へUPSERT(RPC・1トランザクション/チャンク500行)
 ↓ ⑦完了: 件数レポート → ops_logs(kind='csv_import'・内容ゼロ)
 ↓ ⑧破棄: ストリームバッファ解放。原本はどこにも残らない
```

UI上の同意: 取込実行ボタンに「電話番号・メール・詳細住所は保存されず即時破棄されます」を常時表示(運用者の認知=ポリシーの一部)。

## 3. PII Sanitizer 実装仕様

```
src/services/import/
  CsvImportService.ts      # パイプライン編成(②〜⑧)
  ColumnPolicy.ts          # 1章の分類表(定数・Salon Boardカラム名マッピング込み)
  PiiSanitizer.ts          # 行サニタイズの本体
  AddressTruncator.ts      # 住所切詰め
  CustomerMatcher.ts       # 照合・採番
tests/services/import/
```

### 3-1. PiiSanitizer.ts

```typescript
export class PiiSanitizer {
  /** 行単位サニタイズ(pure・throwしない) */
  sanitizeRow(raw: Record<string, string>, policy: ColumnPolicy):
      { clean: SanitizedRow; report: RowReport } {
    // 1. DROP列の物理削除(delete・参照を残さない)
    // 2. TRANSFORM:
    //    address → AddressTruncator.truncate()
    //    birth → ageGroup(raw) + birthMonth(raw) → 原値delete
    //    member_no → sha256(member_no + store.anon_salt) → 原値delete
    // 3. 残存PII走査(KEEP列への混入対策・最終防衛線):
    //    PHONE: /0\d{1,4}-?\d{1,4}-?\d{3,4}/ → '[削除済]'置換+report.piiFound++
    //    EMAIL: /[\w.+-]+@[\w-]+\.[\w.]+/ → 同上
    //    POSTAL: /〒?\d{3}-?\d{4}/ → 同上
    //    (例: 氏名欄に『田中様 090-xxxx』と入っているケースを想定)
    // 4. report: { dropped: string[], transformed: string[], piiFound: number }
    //    ※reportに「何を見つけたか」の値は含めない。件数のみ
  }
}
```

### 3-2. AddressTruncator.ts(都道府県+市区町村)

```typescript
export class AddressTruncator {
  truncate(address: string): { prefecture: string | null; city: string | null } {
    // 1. 都道府県: 47件の固定辞書で前方一致(辞書順は文字数降順 — 「京都府」より先に
    //    該当しうる誤マッチを防ぐため完全一致リスト)
    // 2. 市区町村: 都道府県除去後、以下の優先順で最初の区切りまで:
    //    a. 政令市の「市+区」(例: 横浜市港北区 → 横浜市港北区まで保持)
    //    b. 「〜市」「〜区」「〜町」「〜村」の最初の出現位置で切る
    //    c. 既知の罠ケース辞書: 市川市/野々市市/四日市市/廿日市市/大町町/玉村町 等は
    //       辞書側で完全一致を優先(TRAP_CITIES定数・約30件を同梱)
    // 3. フォールバック(最重要): 確信を持って切れない場合は
    //    { prefecture: 判定できた都道府県 or null, city: null } を返す。
    //    **「迷ったら捨てる」— 原文をそのまま通す分岐は存在しない**
    // 例: '東京都渋谷区神宮前1-2-3 ○○マンション501' → {東京都, 渋谷区}
  }
}
```

### 3-3. CustomerMatcher.ts(顧客識別)

```typescript
// 原則: customer_id(UUID)は内部採番。外部IDは生値で持たない。
export class CustomerMatcher {
  async match(row: SanitizedRow, storeId: UUID): Promise<MatchResult> {
    // 1. external_key_hash = sha256(SalonBoard会員番号 + store.anon_salt)で完全一致照合
    //    → hit: 既存customer_idへ履歴を紐付け(冪等・再取込安全)
    // 2. 会員番号なし: 氏名+性別+初回来店日の複合一致で候補提示
    //    → 自動マージはしない(誤名寄せ防止)。「確認待ち」リストとして件数返却し
    //      運用者が画面で[同一人物][別人]を選択(Phase1は別人=新規として安全側)
    // 3. 新規: customer_id採番+external_key_hash保存
  }
}
// AI学習・Brain・Explainabilityは全てcustomer_idベース(既存正典どおり)。
// 氏名の用途は UI表示とLINE文面の{customer_name}差込のみ。
```

## 4. ログ・原本破棄の規律

| 規律 | 実装 |
|---|---|
| 原本非保存 | ファイルはRoute Handlerのメモリストリームのみ。`fs`書込・Storage upload・console.log(row)は**lintルールで禁止**(src/services/import/配下のfs/storage import検出) |
| ログ内容 | ops_logs(kind='csv_import')に記録するのは: 総行数/取込成功数/スキップ数/DROP列名リスト/piiFound件数/sanitizer_version のみ。**セル値・氏名・行内容は一切記録しない** |
| エラー行 | UIへの返却は {rowNumber, reasonCode}('invalid_date','duplicate','unmatched'等)のみ。行の内容をエラーメッセージにエコーバックしない |
| 取込履歴 | 「いつ・誰が・何件」をops_logsで監査可能に。原本がないため「何を」は再現不能 — **これが仕様**(漏洩時に失うものがない状態を作る) |
| 再取込 | external_key_hash+visit_date のUPSERTで冪等。原本を保存しなくても再取込で復旧できる設計(原本保持の言い訳を消す) |

## 5. Explainability・学習への伝播禁止(既存正典への追補)

| 防衛点 | 実装 |
|---|---|
| PatternContext | 氏名/住所/連絡先フィールドを型レベルで持たない(既存定義のまま・本書で恒久化を宣言)。prefecture/cityも**学習変数に追加しない**(Phase1。多店舗後の地域学習はL2匿名集計のみで検討) |
| DecisionRecord/evidence | EvidenceBuilder・ExplainabilityEngineの出力に customer_name を含めない契約(現行は customerId のみ — テストで恒久検査: 出力JSONを走査し氏名辞書との一致ゼロ) |
| brain_events | 既存ETL除外リストに従う(本書で追加なし=電話/メールは店舗DB自体に存在しないため) |
| LLM(⑥オンデマンド分析) | 入力パックは集計値のみ(Dashboard v1.0確定済み)。CSV由来データも同規律 |
| AI提案根拠の表示 | 画面上の根拠文に氏名・住所・連絡先を使用禁止。「同型のお客様(n=18)で72%」のように常にセル統計で語る(既存テンプレ準拠) |

## 6. Master Schema差分(v1.7=W14)

```
brain_customers 追加列:
  prefecture TEXT NULL / city TEXT NULL          -- TRANSFORM結果のみ
  external_key_hash TEXT NULL                    -- UNIQUE(store_id, external_key_hash)
brain_customers に存在しないことを恒久宣言する列(アンチスキーマ・CIで検査):
  phone / email / postal_code / address_line / building / room
  → schema-checksum CIに「禁止列名リスト」検査を追加(誰かが将来追加したらCI失敗)
ops_logs: kind='csv_import' 追加(detailスキーマは4章)
```

## 7. テスト戦略(受入条件)

| # | テスト |
|---|---|
| S-1 | DROP列: 電話/メール/郵便/建物/部屋を含むCSV → DB全テーブル全行を走査し該当値が0件(完全一致+正規表現の二重走査) |
| S-2 | 住所切詰め: 『東京都渋谷区神宮前1-2-3』→{東京都,渋谷区} / 政令市『横浜市港北区〜』/ 罠ケース『千葉県市川市〜』『石川県野々市市〜』/ 不正形式→{pref,null}(原文残存ゼロ) |
| S-3 | 混入PII: 氏名欄『田中様090-1234-5678』→ '[削除済]'置換+piiFound=1+ログに番号自体が出ない |
| S-4 | 原本非保存: 取込完了後にfs/Storage/tmpを走査しCSV断片ゼロ。lintルール(fs import禁止)発火テスト |
| S-5 | エラーエコーバック: 不正行のレスポンスにセル値が含まれない(JSON全文走査) |
| S-6 | 冪等再取込: 同一CSV2回 → customers/visits増分ゼロ |
| S-7 | 照合: 会員番号一致で既存更新 / 番号なし同姓同名は自動マージされない |
| S-8 | アンチスキーマCI: customersにphone列を追加するmigrationを流す→CI失敗 |
| S-9 | Explainability恒久検査: DecisionRecord/evidence/briefing出力に取込顧客の氏名が不出現 |
| S-10 | 性能: 5,000行CSVをメモリ内で<30s・ピークメモリ<256MB(ストリーム処理の証明) |

## 8. 実装順(Claude Code)

```
C-1 ColumnPolicy+PiiSanitizer+AddressTruncator(pure・テスト先行 S-1〜S-3)
C-2 CustomerMatcher+UPSERT RPC(csv_import_chunk)+W14マイグレーション(S-6,S-7)
C-3 CsvImportService+Route Handler(ストリーム・lintルール追加)(S-4,S-5,S-10)
C-4 アンチスキーマCI+Explainability恒久検査をschema-checksumに統合(S-8,S-9)
依存: Step8-3(既存顧客移行)の実装実体は本機能。移行作業前にC-1〜C-4完了必須。
```

---
*Riora CSV Import Security Architecture v1.0 — 「保存しないものは漏れない。迷ったら捨てる。破棄は入口で不可逆に」。CSV取込経路の唯一の正とする。*
