# Customer Type Engine 実装 完成レポート(Pass H)

作成日: 2026-06-25
事前調査: `docs/CustomerTypeEngine_事前調査.md`

## 1. customer_type生成ロジック調査 / 2. 設計書上の定義調査

事前調査で実施済み(詳細は`docs/CustomerTypeEngine_事前調査.md`参照)。要点:

- `brain_customers.customer_type`(A_acne/B_pore/C_sensitive/D_aging/E_bridal)はスキーマCHECK制約として定義されているが、**この値を実際に計算・代入するロジックはコード上どこにも実装されていなかった**(Pass Eで既に確認済みの事実を再確認)
- A_acne〜E_bridalは「肌悩み・施術ニーズ」カテゴリ(`Riora_P0_API_Schema_v1.0.md`の実例 B_pore↔「毛穴の黒ずみ改善」で確認)

## 3. 判定可能な実データ調査(読み取り専用)

事前調査で全件確認済み:

| 信号 | 結果 |
|---|---|
| `goal_note` | 0/40 |
| `wedding_date` | 0/40 |
| `brain_skin_records` | 0件 |
| `brain_menus.target_types`(来店履歴経由) | **設計上は正しい実信号**(メニューごとに1customer_typeが設定済み)だが、**本番来店39件全てがCSV取込フォールバックメニュー(target_types=空)に集約**されており使用不可 |
| `retail_category` | 13/39件に実データあるが、製品名→customer_typeの対応は設計書に存在せず推測になるため不採用 |

この調査結果をユーザーに報告し、「設計上正しいCustomerTypeEngineを実装し、現在は40件中0件分類されると誠実に報告する」方針で実装することの承認を得た。

## 4. 顧客タイプ分類エンジン実装

`src/engines/customerType/CustomerTypeEngine.ts`(新規・決定論・LLM不使用・推測なし)。

判定根拠は2つの実信号のみ(優先順):
1. `weddingDate`が設定済み → `E_bridal`(confidence=1。対応する単独メニューが存在しないため唯一の根拠)
2. 来店履歴の`menuId`→`brain_menus.targetTypes`。**単独タイプを明示するメニューの来店のみ**を実信号として集計し、最頻出タイプ・実比率をconfidenceとして採用。`targetTypes`が空(CSV未マッチ)または複数タイプを跨ぐ汎用メニュー(entry等)は判別材料として使わない
3. 実信号が1件も無い場合は`customerType: null, confidence: 0, reason: 'no_classifiable_signal'`(架空のタイプを割り当てない・ハードコードなし)

テスト: `tests/engines/customerType/CustomerTypeEngine.test.ts`(8件・本番の実状態を再現するケース含む)。

## 5. brain_customersへの保存処理実装

- `src/repositories/interfaces.ts` / `CustomerRepo.ts`: `updateCustomerType()`を追加(customer_type/type_confidenceのみ更新。`customerType: null`の場合もNULLのまま正しく保存する)
- `src/lib/customerType/runCustomerTypeClassification.ts`(新規): 店舗の全顧客に対しエンジンを適用し保存する。**既にcustomer_typeが設定済みの顧客は上書きしない**(誰かが正しく設定した値を壊さないため・既存顧客削除/brain_customers削除は一切行わない)
- `POST /api/admin/customer-type/classify?storeId=...`(新規API)

テスト: `tests/repositories/supabase/CustomerRepo.test.ts`(+3件)、`tests/lib/customerType/runCustomerTypeClassification.test.ts`(4件)、`tests/api/customerTypeClassify.test.ts`(4件)。

## 6. AI提案成功率再検証 / 7. Before/After比較

本番(`store_id=00000000-0000-0000-0000-000000000001`)に対し、上記APIを実際に実行した。

### Before(実行前)

```
brain_customers: 40件
customer_type NULL: 40件(100%)
AI提案生成成功: 0件 / 40件(0%)
失敗理由: no_customer_type 100%
```

### CustomerTypeEngine実行結果

```json
{
  "totalCustomers": 40,
  "alreadyClassifiedSkipped": 0,
  "classifiedNewly": 0,
  "stillUnclassified": 40
}
```

40件全件が`no_classifiable_signal`(実信号なし)で、`customer_type`はNULLのまま保存された(架空の値は書き込んでいない)。

### After(実行後)

```
brain_customers: 40件
customer_type NULL: 40件(100%・変化なし)
AI提案生成成功: 0件 / 40件(0%・変化なし)
失敗理由: no_customer_type 100%(変化なし)
```

`GET /api/admin/proposals`を実際の顧客IDで再実行し、実行後も`{"success":false,"error":"no_customer_type"}`が返ることを確認した。

### 結果の解釈(誠実な開示)

**Before/Afterで数値上の変化はない。** これはエンジンの不具合ではなく、エンジンが「判定根拠が無いときに架空の値を作らない」という禁止事項(推測禁止・ハードコード禁止)を正しく遵守した結果である。実際の根本原因は**CSV取込時のメニュー名マッチング精度**(全39来店がフォールバックメニューに集約されている)にあり、これが改善されれば本エンジンは自動的に分類を開始する設計になっている(エンジン自体の再実装は不要)。

## 8. 禁止事項の遵守

- **推測による分類禁止**: 設計書で明示的にcustomer_type判定用に用意された実信号(`wedding_date`/`brain_menus.targetTypes`)のみを使用。商品名等からの連想・自由記述のキーワード推定は一切行っていない
- **ハードコード禁止**: 顧客ごとの個別値を埋め込んだ処理は無く、全顧客に同一の決定論ルールを適用する汎用エンジン
- **既存顧客削除禁止 / brain_customers削除禁止**: 削除操作は一切実装していない(読み取り+`customer_type`/`type_confidence`の更新のみ)

## 9. テスト結果

`npx vitest run`: **67 files / 620 tests 全成功**(直前601件 + 本タスクで19件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

## 10. 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/engines/customerType/CustomerTypeEngine.ts`(新規) | 決定論分類エンジン |
| `src/lib/customerType/runCustomerTypeClassification.ts`(新規) | 店舗全体への適用+保存オーケストレーション |
| `src/repositories/interfaces.ts` / `CustomerRepo.ts` | `updateCustomerType()`追加 |
| `app/api/admin/customer-type/classify/route.ts`(新規) | 実行API |
| `app/api/_schemas/customerType.ts`(新規) | 入力検証 |

## 11. 残課題(別タスクとして提起)

1. **CSV取込メニュー名マッチング精度の改善**が最優先(現状全39来店がフォールバックメニューに集約。改善されればCustomerTypeEngineが自動的に機能し始める)
2. `goal_note`/`wedding_date`/`brain_skin_records`を収集する仕組み(問診・初回カウンセリングUI等)の整備(Pass Eで提起済み・未着手)
3. 上記が整備されない限り、AI提案エンジンは引き続き本番データで提案を生成できない
