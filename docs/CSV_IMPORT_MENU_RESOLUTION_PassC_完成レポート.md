# Pass C: CSV Import メニュー名名寄せ改善 完成レポート

作成日: 2026-06-25

## 1. 背景・調査結果

### 1.1 imported_otherへの集約原因(特定済み)

調査対象(`customerMatcher`/`menuResolver`/`csvImportPipeline`周辺)を確認したところ、根本原因は**メニュー名突合アルゴリズムの精度不足ではなく、突合自体が実行されていなかったこと**だった。

`src/lib/import/salonBoardDetailParser.ts`の`aggregateCheckouts()`(CSV行→会計単位の集約処理)は、各会計の`menuName`を**常に空文字列`''`に強制**していた:

```ts
// (修正前)
// 実SalonBoard売上明細は区分=施術の行が0件/複数件あり、安定した名称一致が
// 期待できないため名前突合は試みず常にimported_otherへ集約する(ユーザー承認済み方針)。
menuName: '',
```

このため`menuResolver.resolveMenuId('', lookup)`は常に空文字列を渡され、`brain_menus`にどんな名前のメニューが存在していても一致しようがなく、必ず`role='imported_other'`のフォールバック行に集約されていた。これが**39件中39件(100%)がimported_otherになっていた直接の原因**。

なお`docs/CSV_IMPORT_REAL_FORMAT_IMPLEMENTATION_DESIGN.md`(§の集計仕様)を確認すると、当初設計は「区分='メニュー'の行(ちょうど1件)のitemNameをmenuNameに使う」という方針だった。実データ確認(2026-06-22)で区分=施術系の行が0件/複数件になりうることが分かった際、安定した代表値の決め方を設計せずに**全面的に名前突合を諦める**判断がされていた。本Passはこの代表値選定ロジックを実装することで、当初設計の意図(itemNameを使った突合)を、複数行/0行のケースも扱える形で復元するもの。

### 1.2 menuResolver自体の精度

`menuResolver.resolveMenuId()`(修正前)は正規化なしの完全一致のみで、別名辞書(`normalizeTreatmentName`のTREATMENT_ALIAS)も旧モック店舗名(プレミアムエイジングケア等)向けで実カタログ(ヒト幹15000等)とは無関係だった。完全一致以外の救済手段が無かった。

## 2. 実装内容

### 2.1 メニュー名突合の4段階解決(`src/lib/import/menuResolver.ts`)

| 優先順 | 手法 | 内容 |
|---|---|---|
| 1 | `exact_match` | 元の文字列のまま完全一致(正規化なし) |
| 2 | `normalized_match` | 前後/内部空白除去・全角半角統一・大文字小文字統一後に完全一致 |
| 3 | `partial_match` | 正規化後、どちらかの文字列が他方を部分文字列として含む(例: `毛穴洗浄` ⊂ `毛穴洗浄+ヒト幹19000`) |
| 4 | `fallback_other` | 上記いずれにも一致せず、`role='imported_other'`のフォールバック行へ集約 |
| 5 | `unresolved` | フォールバック行も存在しない場合(取込側でエラー行として扱う・既存仕様を維持) |

正規化は`src/lib/import/normalizer.ts`に追加した`normalizeForMenuMatch()`(汎用関数・全角半角統一+空白除去+大文字小文字統一のみ)で行う。**既存の`normalizeTreatmentName`(店舗特有の別名辞書)は変更していない**(別パイプライン`salonBoardParser.ts`/`csvQualityChecker.ts`が依存しているため、無関係な既存機能への影響を避けた)。部分一致は1〜2文字の極端に短い文字列同士の偶発一致を避けるため、正規化後2文字未満は対象外にしている。

### 2.2 メニュー名の代表値選定(`src/lib/import/salonBoardDetailParser.ts`)

会計内の「区分=施術/メニュー/オプション/サービス」行のうち**金額が最大の行**のitemNameを代表値として採用する(0件の会計=店販・割引のみは空文字のまま・既存どおりfallback/unresolvedへ)。

### 2.3 brain_menus.role/target_typesの活用(調査済み・本Passでは見送り)

CSVの`区分`/`ジャンル`/`カテゴリ`列は「施術」「エステ」等の汎用分類であり、`brain_menus.role`(entry/pore/sensitive/peeling/lifting)や`target_types`(A_acne等の肌タイプ)に対応する比較可能なシグナルがCSV側に存在しないことを確認した。無理な相関付け(暫定ハードコード)は行わず、見送りとした。CSV側に対応列が追加された場合に再検討する。

### 2.4 CSV取込ログへの記録(`src/lib/import/csvImportPipeline.ts` / `src/components/admin/csv-import/types.ts`)

`runImportPipeline()`内でCSV中の一意なメニュー名ごとに解決結果を集約し(`unresolvedStaffMap`と同じ方針・1行ごとでなく一意名ごとに集約してログを軽量に保つ)、`ImportReport.menuResolution`および`brain_ops_logs.detail.menuResolution`の両方に記録する:

```ts
interface MenuResolutionLogEntry {
  rawMenuName: string
  resolvedMenuId: string | null
  resolvedMenuName: string | null
  resolutionMethod: 'exact_match' | 'normalized_match' | 'partial_match' | 'fallback_other' | 'unresolved'
  occurrenceCount: number
}
interface MenuResolutionSummary {
  exactMatch: number; normalizedMatch: number; partialMatch: number; fallbackOther: number; unresolved: number
  entries: MenuResolutionLogEntry[]
}
```

メニュー名は個人情報ではないため(`CSVImportSecurityArchitecture.md`のPII方針は顧客の氏名・連絡先等が対象)、ops_logsへそのまま記録している。

## 3. Before / After 件数比較

### 3.1 既存brain_visits(本番・39件)の現状 — 変更していないことの確認

禁止事項のとおり既存データは一切変更していない。本番`brain_visits`を読み取り専用で確認した結果:

```
total brain_visits: 39
imported_other件数: 39
imported_other以外: 0
```

**既存39件は今回の修正後も100%imported_otherのまま**(過去データは遡って再解決されない・取込ロジックの修正は次回以降のCSV取込にのみ適用される)。

### 3.2 シミュレーション比較(`scripts/pass_c_before_after_report.ts`)

本番で実際に使われたCSVファイル(`scripts/run_real_import.ts`のFILE_PATH)はユーザーのデスクトップ上の個人環境にあり本リポジトリには存在しないため、**同一フォーマット(実SalonBoard「売上明細」形式)の実データ検証用フィクスチャ**である`test-data/csv-import/salonboard_test_real_fixed.csv`(50会計・既存の本番brain_visits作成時にも使われた実フォーマット確認用ファイル)を用いて、本番`brain_menus`(読み取り専用)に対し旧ロジック/新ロジックそれぞれでメニュー解決をシミュレートした(DB書込なし)。

```
=== Before(旧ロジック: menuName常に空文字) ===
exact_match: 0, normalized_match: 0, partial_match: 0, fallback_other: 50, unresolved: 0

=== After(新ロジック: 代表行選定 + exact/normalized/partial/fallback) ===
exact_match: 0, normalized_match: 0, partial_match: 15, fallback_other: 35, unresolved: 0

Before: imported_other(fallback)+unresolved = 50 / 50件(100%)
After:  imported_other(fallback)+unresolved = 35 / 50件(70%)
削減件数: 15件(30%削減)
```

生メニュー名ごとの内訳:

| 生メニュー名(CSV) | 件数 | After解決結果 |
|---|---|---|
| 毛穴洗浄 | 15件 | **partial_match** → `毛穴洗浄+ヒト幹19000` |
| 小顔矯正オプション | 10件 | fallback_other(一致するbrain_menusが無い) |
| (代表メニュー名なし・店販/割引のみ) | 8件 | fallback_other(設計どおり) |
| フェイシャルエステ 60分 | 8件 | fallback_other(一致するbrain_menusが無い) |
| 保湿パック | 6件 | fallback_other(一致するbrain_menusが無い) |
| 美白美容液導入 | 3件 | fallback_other(一致するbrain_menusが無い) |

### 3.3 残存するfallback_otherについて(誠実な開示)

35件(70%)が依然fallback_otherになる理由は**アルゴリズムの限界ではなく、`brain_menus`マスターデータの収録数が実際の施術メニュー数より少ないこと**である。本番`brain_menus`(5件、いずれも「ヒト幹細胞コスメ」系の名称)に対し、実際にサロンで提供されている施術は「フェイシャルエステ」「保湿パック」「美白美容液導入」「小顔矯正」など、名称・系統が異なるものが多数存在する。これらは正規化・部分一致のいずれを使っても文字列上一致しえない(例: `小顔矯正オプション`と`EMS+小顔19000`は「小顔」という共通語を含むが部分文字列としては包含関係にない)。

禁止事項「brain_menusのマスターデータを変更しない」「暫定ハードコード禁止」を守る前提では、この残差はメニューマスタの拡充(別タスク・ユーザー判断が必要)でのみ解消できる。本Passはアルゴリズム面で安全に改善できる範囲(文字列正規化・部分一致・代表値選定)を実装し、マスタ不足によるギャップは隠さずそのままfallback_otherとして可視化している。

## 4. 実装ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lib/import/normalizer.ts` | `normalizeForMenuMatch()`新規追加(既存`normalizeTreatmentName`/`TREATMENT_ALIAS`は無変更) |
| `src/lib/import/menuResolver.ts` | 4段階解決(exact/normalized/partial/fallback)へ全面改修。`MenuResolution`に`menuName`/`method`を追加 |
| `src/lib/import/salonBoardDetailParser.ts` | `menuName: ''`の強制を廃止し、金額最大の施術系行を代表値として採用するロジックに変更 |
| `src/lib/import/csvImportPipeline.ts` | メニュー解決結果をrawMenuNameごとに集計し`ImportReport.menuResolution`/`brain_ops_logs.detail.menuResolution`へ記録 |
| `src/components/admin/csv-import/types.ts` | `MenuResolutionLogEntry`/`MenuResolutionSummary`型を追加、`ImportReport`に`menuResolution`を追加(既存フィールドは変更なし) |
| `scripts/pass_c_before_after_report.ts`(新規) | 本番brain_menus(読み取り専用)+実データ形式フィクスチャでBefore/After比較を再現するスクリプト |

## 5. テスト結果

`npm test`(vitest): **49 files / 471 tests 全成功**(既存453件 + 本タスクで18件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし(既存無関係の`e2e/prod-verify.spec.ts`/`e2e/voice-memo-verify.spec.ts`のみ残存・本タスクと無関係)。

新規/更新テスト:
- `tests/lib/import/menuResolver.test.ts`(新規9件): exact/normalized/partial(双方向)/fallback/unresolved/空文字/極短文字列ガード/複数メニュー混在
- `tests/lib/import/salonBoardDetailParser.menuName.test.ts`(新規4件): 代表値選定(0件/1件/複数件・金額最大採用)
- `tests/lib/import/csvImportPipeline.test.ts`: 既存テストの古い前提コメントを更新(menuNameが常に空文字という記述を削除)。既存「新規顧客+来店」テストに`menuId`/`menuResolution`の検証を追加。新規5件(正規化一致/部分一致/複数施術行の代表値選定/店販のみのfallback/同名メニューのoccurrenceCount集約)
- `tests/api/csv-import.test.ts`: モックの`ImportReport`に`menuResolution`フィールドを追加(型整合のみ・既存アサーションは無変更)

既存テストで`menuId`の値を直接検証していたものは無く、本Passの変更によって既存テストのアサーションが意図せず変化した箇所は無い(全て確認済み)。

## 6. 禁止事項の遵守

- **brain_visits既存データを削除しない**: 一切のDELETE/UPDATEを行っていない。既存39件は変更前と変更後で完全に同一(§3.1で確認済み)
- **brain_menusのマスターデータを変更しない**: マスタへのINSERT/UPDATEは行っていない。読み取り専用でのみ使用
- **暫定ハードコード禁止**: 店舗固有の別名辞書・特定メニュー名の特別扱いは追加していない。正規化・部分一致は汎用ルールのみ

## 7. 今後の検討事項(本Passのスコープ外)

1. `brain_menus`マスタの拡充(フェイシャルエステ/保湿パック/美白美容液導入/小顔矯正等の実施術メニューの登録) — マスタ変更を伴うためユーザー判断が必要
2. CSV側に施術ジャンル・肌タイプに相当する列が将来追加された場合の`role`/`target_types`活用
3. `buildDryRunResult`(画面⑥のDry Run表示)へのメニュー解決内訳の表出 — 本Passはops_logs(実取込時)のみ対応。Dry Run時点でのプレビュー表示は別途UI実装が必要
