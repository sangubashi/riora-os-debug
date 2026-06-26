# MD-4 スタッフ分析 完成レポート

作成日: 2026-06-23

## 1. 実装範囲

設計根拠: `docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md` 画面④(スタッフ分析)。ユーザー指示(2026-06-23)により表示・制約を以下に確定した。

| 表示項目 | 実装 |
|---|---|
| 売上 | `monthlySales`(当月・このスタッフ担当来店分) |
| 指名率 | `nominationRate`(全履歴・担当来店のうちis_nomination=trueの割合) |
| リピート率 | `repeatRate`(全履歴・担当来店のうちvisit_count_at>1の割合) |
| LTV | `ltv`(担当顧客のLTV平均・MD-3と同じ算出式) |
| 成長率 | `growthRate`((当月売上−前月売上)÷前月売上) |

**制約の実装方法**:
- **ランキング禁止・順位表示禁止**: APIレスポンスに`rank`/順位に相当するフィールドを一切持たせていない(テストで明示的に確認・§5)
- **売上単体比較禁止**: UIは売上カードを必ず指名率/リピート率/LTV/成長率と同一カード内に表示し、売上のみを切り出して表示する経路を作っていない
- **五十音順表示**: `Intl.Collator('ja')`でスタッフ名(漢字)をソート。クライアント側での並び替え・ソート機能は実装していない(常にAPIが返した順序をそのまま表示)

## 2. DB確認

- `brain_staff`に**ふりがな(yomi/kana)列が存在しない**ことを確認(旧`customers`スキーマの`name_kana`に相当する列がBrain側に無い)。正確な五十音順には別途ふりがな列の追加(migration)が必要だが、本タスクのスコープ外のため`Intl.Collator('ja')`による漢字名の近似ソートで対応した(§7残課題)
- `brain_visits.staff_id`(担当来店の特定)・`brain_visits.visit_count_at`(リピート判定)・`brain_customers`/`brain_subscriptions`(LTV算出)はすべて既存列で対応可能。新規列・migrationは不要

## 3. Repository確認

`IStaffRepo.listByStore()`・`IVisitRepo.listByStore()`・`ISubscriptionRepo.listByStore()`(MD-1〜MD-3で追加済み)をそのまま再利用。本タスクでのRepository層の変更なし。

## 4. API実装

`app/api/admin/staff-analytics/route.ts`(GETのみ・閲覧専用)。`app/api/_schemas/query.ts`に`staffAnalyticsQuerySchema`追加。

## 5. UI実装

`src/lib/staffAnalytics/StaffAnalyticsEngine.ts`(集計の純粋関数)・`src/store/useStaffAnalyticsStore.ts`・`src/components/admin/staffAnalytics/StaffAnalyticsScreen.tsx`(カード表示・ソートUIなし)・`app/admin/staff-analytics/page.tsx`。

## 6. 集計ロジック(すべて決定論的コード・LLM/AI不使用)

`computeStaffAnalytics()`

| 項目 | 算出方法 |
|---|---|
| `monthlySales` | このスタッフが担当(`visit.staffId`一致)した来店のうち当月(月初〜基準日)分の`treatment_amount+retail_amount`合計 |
| `nominationRate` | 担当来店の全履歴のうち`is_nomination=true`の割合(担当来店0件はnull) |
| `repeatRate` | 担当来店の全履歴のうち`visit_count_at>1`の割合(担当来店0件はnull) |
| `ltv` | 担当した(来店履行歴を持つ)顧客ごとのLTV(その顧客の全履歴の累計売上+継続中サブスクのMRR×6・MD-3と同式)を平均したもの(担当顧客0件はnull) |
| `growthRate` | `(当月売上−前月売上)÷前月売上`。前月売上が0(前月データなし含む)はnull |

**設計判断の要確認**: LTVは「担当顧客」を`assigned_staff_id`ではなく「来店履行歴上でこのスタッフが対応した顧客」で定義した。理由: 現状`brain_customers.assigned_staff_id`はCSV Importのどの工程からも設定されておらず常にnullのため、`assigned_staff_id`基準では全スタッフのLTVが常にnullになってしまう(MD-3で確認した事実と同じ制約)。`visit.staffId`基準であれば実データで意味のある値が算出できる。

## 7. テスト結果

`npm test`: **43 files / 429 tests 全成功**(既存416件 + 本タスクで13件追加)
`npm run typecheck`: 既存無関係2件のみ残存。

新規テスト:
- `tests/lib/staffAnalytics/StaffAnalyticsEngine.test.ts`(7件): 担当来店0件/当月売上の月フィルタ(他スタッフ来店を含めない)/指名率・リピート率(全履歴)/LTV(担当顧客平均)/成長率(前月比・前月データ無しはnull)/年をまたぐ前月計算/五十音順ソート+ランキングフィールド不在の確認
- `tests/api/staff-analytics.test.ts`(6件): 一覧取得・レスポンスにrank/rankingフィールドが無いことの確認・全スタッフ返却・バリデーション・エラー系

## 8. 実データ確認・スクリーンショット

`GET /api/admin/staff-analytics?storeId=00000000-0000-0000-0000-000000000001`を実行し、3名(外舘/亀山/鈴木・Intl.Collator('ja')順)の実データを取得:

| スタッフ | 売上(今月) | 指名率 | リピート率 | LTV | 成長率 |
|---|---|---|---|---|---|
| 外舘 | ¥93,050 | 56% | 0% | ¥10,339 | — |
| 亀山 | ¥100,000 | 18% | 0% | ¥9,091 | — |
| 鈴木 | ¥608,710 | 42% | 0% | ¥32,037 | — |

`docs/screenshots/MD-4_staff_analytics_real_data.png` — 3名のカードが五十音順(近似)で表示され、各カード内で売上が指名率・リピート率等と同居していること、順位番号やランキング表示が一切無いことを確認。

リピート率が全員0%・成長率が全員「—」なのは、当店舗の全39来店が現状すべて初回来店(MD-1/MD-2/MD-3で確認済みの事実)かつ前月(5月)の実績データが無いため。設計どおりの正しい挙動。

## 9. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_staff` | スタッフ一覧(`IStaffRepo.listByStore()`) |
| `brain_visits` | 担当来店の特定・売上/指名率/リピート率/成長率の算出元(`IVisitRepo.listByStore()`) |
| `brain_subscriptions` | LTVのMRR算出元(`ISubscriptionRepo.listByStore()`) |

新規業務テーブル・新規列の追加なし。

## 10. 残課題

1. **五十音順の精度**: `brain_staff`にふりがな列が無いため`Intl.Collator('ja')`による漢字名の近似ソート。正確な五十音順にはふりがな列追加(別migration)が必要
2. **API認可(owner/manager専用)の横断的な未検証**: MD-1〜MD-3と同じ既知のギャップ
3. **LTVの「担当顧客」定義**: `assigned_staff_id`が未運用のため`visit.staffId`基準で代替した設計判断(§6)。将来`assigned_staff_id`の運用が始まった場合は再検討の余地がある
4. **成長率の実データ検証は未実施**: 前月(5月)の実績データが無いため、全スタッフ「—」表示のみの確認に留まる。来月以降のデータ蓄積後に実値での再確認が望ましい
