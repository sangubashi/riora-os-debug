# Pass D: CSV Import完成 完成レポート

作成日: 2026-06-25
対象: `customerMatcher.ts` / `staffResolver.ts` / `menuResolver.ts` / `csvImportPipeline.ts` / `ImportReport`
前提: `docs/CSV_IMPORT_MENU_RESOLUTION_PassC_完成レポート.md`(Pass C: メニュー名名寄せ改善)の続き。

---

## 最終報告(必須記載)

| 項目 | 値 | 算出方法 |
|---|---|---|
| **顧客解決率** | **0%**(会員番号一致) | 実データ形式フィクスチャ(50会計)で会員番号(`customerNumber`)が全行空欄のため、`customerResolutionRate`(=会員番号による確定一致件数/総会計数)は0。氏名のみでの突合に100%依存している |
| **スタッフ解決率** | 異体字未対応時: **62%**(31/50) / alias登録後: **100%**(50/50) | `staffResolutionRate` = 1 − unresolvedStaffCount/総会計数。「外館」(U+9928)→「外舘」(U+8218)のalias登録で解消 |
| **メニュー解決率** | **30%**(15/50) | `menuResolutionRate`。Pass Cの4段階解決(exact/normalized/partial)で確定。残り70%は`brain_menus`マスタ不足(§3) |
| **imported_other残件数** | 本番: **39/39件(100%)**・変化なし / フィクスチャ再現: **35/50件(70%)** | 本番は既存データのため再取込しても冪等スキップで不変(§4)。フィクスチャはPass Cの新ロジックでの再現値 |
| **本番再取込可能か** | **可能(条件付き)** | コード上、既存データを削除・破壊する経路は存在しない(§5で確認済み)。ただし「重複顧客の新規作成」リスクがあるため、Dry Run+`reviewDecisions`明示指定を必須とする運用手順(`docs/CSV_IMPORT_本番再取込手順書.md`)に従うことが条件 |
| **実施推奨手順** | 本番再取込手順書(`docs/CSV_IMPORT_本番再取込手順書.md`)の§2(Dry Run)→§4(Import)→§5(差分確認)を順守。`unresolved_staff`は実行前に必ず`staff-aliases`へ解消すること | — |

---

## 1. 顧客名寄せ精度検証(`customerMatcher.ts`)

### 1.1 確認項目別の評価

| 確認項目 | 現状 |
|---|---|
| 完全一致 | `toNameKey()`で対応済み(敬称除去含む) |
| 空白差異 | `normalizeCustomerName()`で対応済み(全角/半角スペース統一・連続スペース圧縮) |
| 全角半角差異 | `toHalfWidth()`で対応済み(全角英数字→半角) |
| カナ表記差異 | ひらがな→カタカナは対応済みだが、**半角カタカナ→全角カタカナは未対応だったため本Passで追加**(`halfWidthKatakanaToFullWidth()`・濁点/半濁点の合成含む) |
| 電話番号一致 | **実装不可(アーキテクチャ上の制約)**。`CSVImportSecurityArchitecture.md`の方針により、電話番号は`DROP_COLUMN_ALIASES`でCSV読込の最初の段階で意図的に破棄される(PII方針)。実装するには電話番号を保持・ハッシュ化する設計変更が必要で、セキュリティ方針の変更を伴うため本Passでは行っていない(別途ユーザー承認のもとで検討) |
| LINE User ID一致 | **対象外**。SalonBoard売上明細CSVにLINE User IDの列は存在しない(`予約経路`列は「LINE/電話/ホットペッパービューティー」という来店経路の分類でしかない)。`line_user_ids`テーブルは別の仕組み(LINE公式アカウント連携)であり、CSV Importとは接続点が無い |

### 1.2 重複顧客作成率(実測)

本番`brain_customers`(40件)を確認した結果、**6名が同姓同名で2件ずつ重複**(12件)していることを確認した。

実データ形式フィクスチャ(`test-data/csv-import/salonboard_test_real_fixed.csv`・50会計、スタッフ異体字を解消した状態でフルパイプラインを実行)で再現した結果:

```
作成された顧客レコード: 42件
一意な顧客名:           10名
重複顧客作成率:         (42-10)/42 = 76%
```

**会員番号が空欄のCSVでは、来店ごとに同一人物が複数回登場すると`reviewDecisions`を明示しない限り大半が別人として複製される。** これは`customerMatcher.ts`の「自動マージしない」という設計(同姓同名の別人を誤統合しないため)が意図的に作っている挙動であり、アルゴリズムの不備ではない。

### 1.3 対応

`customerMatcher.ts`の判定ロジックは変更していない(方針は正しい)。`computeCsvQualityReport()`が`duplicateCustomerNames`としてリスクを可視化し、`customerResolutionRate`(会員番号一致率)が重複リスクの「先行指標」として機能するようにした。

---

## 2. スタッフ名寄せ精度検証(`staffResolver.ts`)

### 2.1 確認項目別の評価

| 確認項目 | 現状 |
|---|---|
| 本名(完全一致) | 対応済み |
| ニックネーム(例: 亀山→亀山彩) | **意図的に未対応**。部分一致による自動解決は行わない(誤って別人の売上を帰属させるリスクが指名率・スタッフ分析に直結するため、メニュー名のpartial_matchとは異なる判断)。`brain_staff.name_aliases`への明示登録が正しい解決手段 |
| CSV表記揺れ(ローマ字大文字小文字: KAMEYAMA/kameyama) | **本Passで対応**。`normalizeStaffName()`に大文字小文字統一を追加(汎用正規化・ハードコードではない) |
| 半角カタカナ表記 | **本Passで対応**。`halfWidthKatakanaToFullWidth()`を適用 |
| 漢字の異体字(実データで発見: 外館/外舘) | **未対応(対応不能)**。Unicode上の汎用正規化では救済できない(辞書が無いと判別不可能)。`name_aliases`への登録で解決する方針とした |

### 2.2 実データで判明した精度問題

`test-data/csv-import/salonboard_test_real_fixed.csv`(50行)で、CSV側のスタッフ名「外**館**」(U+9928)が`brain_staff.name`「外**舘**」(U+8218)と異体字違いで一致せず、**19/50行(38%)が来店データとして取り込まれず脱落**することを発見した。`brain_staff.name_aliases`に`'外館'`を登録すると全行が解決することを確認済み(テストで実証)。

本番`brain_ops_logs`(過去3回の取込)は`unresolvedStaffCount: 0`であり、本番で実際に使われたCSVではこの問題は発生していない(鈴木/亀山/外舘の表記がCSVと一致していた)。

### 2.3 staffResolver改善の実施内容

- `normalizeStaffName()`に大文字小文字統一・半角カタカナ→全角カタカナ変換を追加(汎用的なUnicode正規化のみ・店舗固有の辞書は追加していない)
- 異体字・ニックネームの解決は既存の`name_aliases`機構に委ねる方針を維持(テストで動作を保証)

---

## 3. imported_other残件数分析(分類A/B/C)

Pass Cのシミュレーション(フィクスチャ50会計、スタッフ解決済み)における`fallback_other`35件を原因別に分類した:

| 分類 | 件数 | 内容 |
|---|---|---|
| **A. アルゴリズム不足(改善検討したが見送り)** | 10件(小顔矯正オプション) | `EMS+小顔19000`と「小顔」という語を共有するが、文字列の包含関係(部分一致)では繋がらない。キーワード重複による曖昧一致(fuzzy match)を検討したが、**無関係なメニュー間の誤マッチリスクが高い**ため実装を見送った(Pass C方針を継承) |
| **B. brain_menus未登録** | 17件(フェイシャルエステ60分8件・保湿パック6件・美白美容液導入3件) | `brain_menus`(5件・「ヒト幹細胞コスメ」系の名称)に対応する施術が存在しない。マスタ拡充以外に解決手段が無い(マスタ変更禁止のため対応不可) |
| **C. CSV元データ不足** | 8件(店販・割引のみで施術行が無い会計) | 会計内に施術系の行(区分=施術/メニュー/オプション/サービス)が1件も無く、突合対象となるメニュー名自体が存在しない。データ不足であり改善不可能 |
| (参考)解決済み | 15件(毛穴洗浄) | partial_matchで`毛穴洗浄+ヒト幹19000`に解決済み(Pass C) |

**A+B+C = 35件 = フォールバック総数と一致。**

---

## 4. 本番再取込手順作成

`docs/CSV_IMPORT_本番再取込手順書.md`に以下を文書化した(運用担当者が実施できるレベル):

1. **本番データ影響調査**(§1): `brain_visits`/`brain_customers`への影響は新規INSERTまたは限定的なUPDATEのみで、DELETE経路はコード上存在しないことを確認
2. **Dry Run手順**(§2): `qualityReport`の各警告への対応表
3. **Rollback手順**(§3): 事前(Dry Run時点で中止)が唯一の確実な手段であり、Import実行後のロールバック(取消)は構造的に不可能であることを正直に開示
4. **再取込手順**(§4): Import実行・冪等性の説明
5. **差分確認手順**(§5): `csv_import_health_check.ts`による前後比較チェックリスト
6. **既知の残課題**(§7): 既存重複顧客・既存imported_other・brain_menus不足は本手順では解消されないことを明記

### `brain_reservations`調査結果

指示にあった`brain_reservations`は本番Supabaseに**存在しないテーブル**であることを確認した。類似テーブルは`brain_bookings`(0件・CSV Importは未参照)と、別スキーマの`reservations`(Phase1スタッフアプリ専用・CSV Importとは無関係)の2つ。いずれもCSV Importコードから一切参照されておらず影響範囲はゼロ。

---

## 5. CSV品質レポート(`ImportReport`への追加)

`src/lib/import/csvImportQualityReport.ts`(新規)を`buildDryRunResult`/`runImportPipeline`の両方から呼び、以下を`ValidationResult.qualityReport`/`ImportReport.qualityReport`として返す:

```ts
interface CsvQualityReport {
  score: number; level: 'excellent'|'good'|'fair'|'poor'
  warnings: CsvQualityWarning[]   // unresolved_staff/duplicate_customer_name/needs_review_pending/menu_unmatched
  menuResolution: MenuResolutionSummary
  duplicateCustomerNames: { name: string; occurrenceCount: number }[]
  rates: {
    customerResolutionRate: number   // 会員番号一致率
    staffResolutionRate: number
    menuResolutionRate: number
    importedOtherRate: number
    errorCount: number
    skippedCount: number
  }
}
```

### バグ修正

調査の過程で、`unresolvedStaffCount`が`runImportPipeline`内で計算されていたにもかかわらず`ImportReport`(APIレスポンス)には含まれず、`brain_ops_logs.detail`にのみ記録されていた欠落を発見し修正した。

---

## 6. 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/lib/import/normalizer.ts` | `halfWidthKatakanaToFullWidth()`新規追加(半角カナ→全角カナ・濁点合成)。`toNameKey()`/`normalizeStaffName()`へ適用。`normalizeStaffName()`に大文字小文字統一を追加 |
| `src/lib/import/csvImportQualityReport.ts`(新規) | `computeCsvQualityReport()`(rates算出含む)。`recordMenuResolution()`/`summarizeMenuResolution()`(Pass Cから移設) |
| `src/lib/import/csvImportPipeline.ts` | `matchCustomer()`が`isHashMatch`を返すよう変更。`buildDryRunResult`/`runImportPipeline`双方で品質レポート(rates含む)を算出。`ImportReport.unresolvedStaffCount`を追加(バグ修正) |
| `src/components/admin/csv-import/types.ts` | `CsvQualityReport`/`CsvImportRates`/`CsvQualityWarning`を追加 |
| `scripts/csv_import_health_check.ts`(新規) | 読み取り専用の健全性チェック |
| `scripts/pass_d_full_pipeline_simulation.ts`(新規) | フィクスチャCSVでのフルパイプライン再現(alias登録後のrates算出含む) |
| `docs/CSV_IMPORT_本番再取込手順書.md`(更新) | Dry Run/Rollback/再取込/差分確認の4手順を明確化 |

---

## 7. テスト結果

`npm test`(vitest): **53 files / 502 tests 全成功**(Pass C完了時点471件 + 本Pass Dで31件)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

新規/拡張テスト(31件):
- `tests/lib/import/normalizer.test.ts`(7件・新規): 半角カナ→全角カナ変換(濁点・半濁点合成含む)
- `tests/lib/import/csvImportQualityReport.test.ts`(8件): score/level/各警告・**rates算出(ゼロ除算ガード含む)**
- `tests/lib/import/staffResolver.test.ts`(7件): 完全一致・alias一致・**異体字未解決の再現**・alias登録での解決・**ローマ字大文字小文字統一**・**ニックネーム非対応の確認**
- `tests/lib/import/customerMatcher.test.ts`(5件): hash優先・needs_review判定・new判定
- `tests/lib/import/csvImportPipeline.test.ts`(4件): **重複顧客作成リスクの再現**・`reviewDecisions`明示指定での統合・`unresolvedStaffCount`バグ修正・dry-runでの品質レポート

---

## 8. 禁止事項の遵守

- **brain_visits削除禁止**: 削除コード自体が存在しない(§4で構造的に確認)
- **brain_customers削除禁止**: 削除コード自体が存在しない。既存6組12件の重複は解消せず残課題として明記
- **brain_reservations削除禁止**: 該当テーブルが存在しないことを確認(影響なし)
- **brain_menus直接編集禁止**: 直接変更は行っていない(分類A/B/Cの分析のみ)
- **ハードコード禁止**: 異体字・ニックネームの辞書は追加していない(汎用Unicode正規化のみ実装し、業務固有の表記ゆれは既存の`name_aliases`機構に委ねた)
- **実データ改変禁止**: 本番データへの書込・変更は一切行っていない(調査はすべて読み取り専用クエリ)

---

## 9. 成果物一覧

1. 実装コード: §6参照
2. テスト: §7参照(31件新規・全502件成功)
3. Before/After比較: 顧客解決率0%→(変更なし・設計上の制約)/スタッフ解決率62%→100%(alias登録後)/メニュー解決率30%(Pass C・変化なし)
4. CSV品質レポート: `ImportReport.qualityReport`(score/warnings/rates)
5. 本番再取込手順書: `docs/CSV_IMPORT_本番再取込手順書.md`
6. 本完成レポート: `docs/CSV_IMPORT_Pass_D_完成レポート.md`
