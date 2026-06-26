# Customer Type Migration レポート(Pass E)

作成日: 2026-06-25
結論: **移行は実施しない**(設計書根拠・実データ根拠のいずれも存在しないため。調査結果はユーザー確認済み)

---

## 1. customer_type設計確認

設計書(`docs/architecture/Riora_Database_Master_Schema_v1.0.md`/`Riora_API_Architecture_v1.0.md`/`Riora_P0_API_Schema_v1.0.md`/`Riora_Repository_RPC_Architecture_v1.0.md`/`Brain_Evolution_Architecture_v1.0.md`/`Brain_Learning_Code_Architecture_v1.0.md`/`Riora_ScenarioEngine_Code_Architecture_v1.0.md`/`Riora_PatternEngine_Code_Architecture_v1.0.md`/`Riora_SuccessPattern_Final_Architecture_v1.0.md`/`Riora_Brain_実装タスク分解_v1_2.md`/`ER_DIAGRAM.md`/`DB_AUDIT_REPORT.md`/`CSV_IMPORT_TARGET_SCHEMA.md`)を全て確認した。

### 正式定義(スキーマレベル)

```sql
-- supabase/migrations/20260612000001_core_tables.sql:60-61
customer_type text CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
type_confidence numeric NOT NULL DEFAULT 0 CHECK (type_confidence BETWEEN 0 AND 1),
```

`docs/architecture/Riora_P0_API_Schema_v1.0.md:203`の実例 `"customerType": "B_pore"` は `"goalNote": "毛穴の黒ずみ改善"`(毛穴の黒ずみ＝pore)と対応しており、**A_acne〜E_bridalは「肌悩み・施術ニーズ」のカテゴリ**(ニキビ/毛穴/敏感肌/エイジング/ブライダル)であると確認できる。

### customer_typeを「誰が・どうやって設定するか」の調査結果

設計書全体を確認した結果、以下の2箇所のみに言及があるが、いずれも1行のみで具体的なロジックは一切記載されていない:

- `docs/architecture/Riora_Database_Master_Schema_v1.0.md:166`(CRUDマトリクス): `U(タイプ確定・goal_note・birth_month・同意)` — 「タイプ確定」がUpdate操作の一部として記載されているのみ
- `docs/architecture/Riora_API_Architecture_v1.0.md:28`: `POST /api/customers | 初回カウンセリング登録(タイプ分類実行・同意込み) | P0` — 「タイプ分類実行」と記載されているのみ

**しかし、この`POST /api/customers`は詳細スキーマ集である`Riora_P0_API_Schema_v1.0.md`(SaveVisitRecord/GetCustomerDetail/GetBriefing/GetDashboard/ApproveLineSend/ApproveRevisionの6本のみを詳細化)に含まれておらず、実際の分類アルゴリズム・問診・肌診断ロジックはどの設計書にも一切記載されていない。**

`type_confidence`についても、`docs/ai/Riora_SuccessPattern_Final_Architecture_v1.0.md:38`で「タイプ分類の確信度」という1行の説明があるのみで、算出方法の記載はない(さらに同箇所では誤って`customers.type_confidence`と旧テーブル名で記載されており、ドキュメント自体に不整合がある)。

コード調査でも、`src/repositories/supabase/mappers.ts`の`toBrainCustomerInsert()`(実際の顧客作成処理)は`customer_type`/`type_confidence`を一切書き込まないことを確認済み(前回調査`docs/AI提案ブロッカー調査レポート.md`と一致)。

**結論: customer_typeの分類ロジック(問診/肌診断/AI分類器)は設計書上に存在を示唆する記述(「タイプ分類実行」「タイプ確定」)はあるが、具体的なアルゴリズムはどこにも仕様化されておらず、コード上も未実装。**

---

## 2. 対応表作成

### 推測による対応表(VIP型→A_acne等)は作成しない

調査の結果、旧`customers.customer_type`と`brain_customers.customer_type`は**設計上まったく異なる分類軸**であることが判明した:

| | 旧`customers.customer_type` | 新`brain_customers.customer_type` |
|---|---|---|
| 分類軸 | 接客スタイル・心理傾向(サブスキーマコメント「接客分類」) | 肌悩み・施術ニーズ |
| 値 | VIP型 / 慎重・不安型 / 感情重視型 / 効果重視型 / 信頼構築型 | A_acne(ニキビ) / B_pore(毛穴) / C_sensitive(敏感肌) / D_aging(エイジング) / E_bridal(ブライダル) |
| 根拠 | `supabase/migrations/20250515000005_phase1_tables.sql:24-28`(コメント:「接客分類」) | `docs/architecture/Riora_P0_API_Schema_v1.0.md:203-204`(B_pore↔「毛穴の黒ずみ改善」の実例で確認) |

両者を結びつける設計書記述・移行スクリプト・コードは一切存在しない。「VIP型→A_acne」のような対応は**意味的に成立しない推測**であり、本タスクの禁止事項(customer_type推測禁止・設計書根拠なしのマッピング禁止)に該当するため作成しない。

### 代替アプローチ(新規の実データ分類)も不可能と判明

旧customer_typeに依存せず、`brain_customers`自体が持つ実データ(`goal_note`/`wedding_date`/`brain_skin_records`)から新たにtypeを判定する透明なルールを検討したが、本番データを確認した結果、**判定材料となる実データが1件も存在しない**ため、この方法も不可能と判明した(§3参照)。

---

## 3. 本番データ調査(読み取り専用)

| 項目 | 結果 |
|---|---|
| 旧`customers`総件数 | 30件 |
| 旧`customers.customer_type`内訳 | VIP型 4件 / 慎重・不安型 9件 / 感情重視型 5件 / 効果重視型 5件 / 信頼構築型 7件(全30件設定済み) |
| `brain_customers`総件数 | 40件(有効・deleted_at IS NULL) |
| `brain_customers.customer_type` NULL件数 | 40件 / 40件(100%) |
| `goal_note`設定済み | 0件 / 40件 |
| `wedding_date`設定済み | 0件 / 40件 |
| `type_confidence` != 0 | 0件 / 40件 |
| `brain_skin_records`総件数 | 0件(全店舗) |

### 顧客対応関係

旧`customers`(30件)と`brain_customers`(40件)は**FKも共有キーも存在しない別ID空間**(`AI提案本物化_完成レポート.md`§2で先述確認済み)。件数も30件 vs 40件で一致しない。氏名の完全一致でのみ橋渡し可能だが、これは「対応関係」ではなく「最善努力でのベストエフォート照合」であり、本タスクが求める正式な「対応表」の根拠にはならない。

---

## 4. Dry Run Migration

「旧customers.customer_typeから新brain_customers.customer_typeへ変換する」という対応表ベースの移行をDry Runした結果:

```
移行対象(brain_customers.customer_type が NULL): 40件
適用可能な変換ルール: 0件(対応表が存在しないため)
変換後にcustomer_typeが設定される件数: 0件
変換後もNULLのまま残る件数: 40件

Before: NULL 40件 / 40件(100%)
After:  NULL 40件 / 40件(100%)  ※変化なし
```

**Dry Runの結果自体が「対応表が存在しないため移行不可能」であることを定量的に示している。**

---

## 5. Migration Script作成

**作成しない(ユーザー確認済み)。**

設計書根拠・実データ根拠のいずれも存在しない状態でスクリプトを作成すると、必然的に「推測によるcustomer_type割り当て」になり、本タスクの禁止事項(customer_type推測禁止・設計書根拠なしのマッピング禁止・ダミーデータ禁止の精神)に直接違反する。これを避けるため、ユーザーに本ブロッカーを報告し、「調査結果を確定し、移行は実施しない」という回答を得た。

---

## 6. AI提案再検証

移行を実施していないため、状態は前回調査(`docs/AI提案ブロッカー調査レポート.md`)から変化していない。`scripts/investigate_proposal_blocker.ts`(既存・無変更)を再実行して確認した:

```
AI提案対象顧客数: 40件
提案生成成功数: 0件(0%)
失敗理由内訳: no_customer_type 40件(100%)
提案生成率: 0%
```

---

## 7. 実機検証

上記の通り提案は1件も生成可能な状態にないため、「実提案表示」のスクリーンショットは取得できない(誠実な開示)。`docs/screenshots/AI提案_production_no_customer_type.png`(前回取得済み)が現在も本番の実状態と一致していることを確認した(顧客詳細→AI提案→`no_customer_type`エラー表示、変化なし)。

---

## 完了条件との対比(誠実な開示)

| 完了条件 | 結果 |
|---|---|
| customer_type NULL率 100%→0% | **未達(100%のまま)**。根拠なき値の割り当てを避けたため |
| ProposalOrchestrator成功率 0%→実データで提案生成可能 | **未達(0%のまま)** |
| AI提案画面で提案が表示されること | **未達** |

これらの完了条件は、現在利用可能な設計書・実データのみでは**達成不可能**であることが本調査で確定した。禁止事項(customer_type推測禁止等)を遵守する以上、両者は両立しない。

## 推奨される次のアクション(別タスクとして提起)

1. **顧客タイプ分類データの収集メカニズムを新規設計・実装する**(問診フォーム/初回カウンセリング時のスタッフ入力UI/肌診断ロジックのいずれか)。これは「移行」ではなく「新規データ収集」であり、Pass Eの範囲外。
2. 上記が整備されない限り、AI提案エンジン(`ProposalOrchestrator`)は本番データで提案を生成できない。これはエンジン側の不具合ではなく、前段データが存在しないことによる構造的な制約として記録する。

## 本調査で変更したコード

なし。`scripts/investigate_proposal_blocker.ts`(既存・前回作成)を無変更のまま再実行したのみで、新規コード作成・既存コード変更は行っていない。
