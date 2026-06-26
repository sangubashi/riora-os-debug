# MD-2 失客リスク管理(離脱予兆センター) 完成レポート

作成日: 2026-06-23

## 1. 実装範囲

設計根拠: `docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md` 画面②(離脱予兆センター)。ただしユーザー指示(2026-06-23)により表示・操作範囲を以下に絞った(v2.0の「推定損失額」「早期警報」「LINE/ScenarioSelector連携」は今回スコープ外)。

| 表示・操作項目 | 実装 |
|---|---|
| 危険顧客一覧 | `GET /api/admin/churn-risk` |
| 最終来店日 | `lastVisitDate` |
| 来店間隔 | `avgIntervalDays`(顧客個人の平均来店間隔) |
| 失客リスクスコア | `churnRiskScore`(0〜1) |
| 担当スタッフ | `assignedStaffName`(`brain_customers.assigned_staff_id` → `brain_staff.name`) |
| 「担当スタッフへ指示」アクション | `POST /api/admin/churn-risk/instruct`(`brain_ops_logs`への記録のみ) |

**管理者は閲覧と指示のみ**: 指示アクションは`brain_ops_logs(kind='churn_instruction')`への書込のみで、LINE送信(`brain_line_send_queue`)・予約操作(`brain_bookings`)には一切アクセスしないことをコードレベルで保証(該当リポジトリ・テーブルをimportしていない)。

## 2. DB設計確認(実装着手前に調査・新規テーブル追加なし)

- `brain_customers.churn_score`(numeric 0〜1)・`churn_reason`(text)は既存列だが、CSV Importを含むどの工程からも更新されておらず常に既定値0のまま → **使用しない**(代わりに来店履行履歴から都度算出するライブ集計方式を採用)
- `brain_customers.assigned_staff_id`(uuid → `brain_staff.id`)は既存列。担当スタッフ解決に使用
- `brain_ops_logs`(`store_id, kind, actor_id, detail jsonb, created_at`)は「汎用運用ログ」として設計されており(`20260621_csv_import_security_diff.sql`のCOMMENT ON TABLE参照)、`kind='churn_instruction'`を追加するだけで対応可能。**migration不要**
- 危険判定の閾値・スコア式はアーキ文書に厳密な数式定義が無いため、本タスクで新規に決定(§4参照)

新規業務テーブル・新規列の追加は一切なし。

## 3. 実装順序(指示通りDB→Repository→API→UIを厳守)

1. **DB設計確認**(§2)
2. **Repository**: 既存の`ICustomerRepo.listByStore()`/`IVisitRepo.listByStore()`/`IStaffRepo.listByStore()`/`IOpsLogRepo.insert()`をそのまま再利用(MD-1のDashboardAggregator実装時に追加済みの`IVisitRepo.listByStore()`が活用できたため、Repository層の新規メソッド追加は不要だった)
3. **API**:
   - `app/api/admin/churn-risk/route.ts`(GET・一覧)
   - `app/api/admin/churn-risk/instruct/route.ts`(POST・指示記録)
   - `app/api/_schemas/query.ts`に`churnRiskQuerySchema`追加
4. **UI**:
   - `src/lib/churn/ChurnRiskEngine.ts`(集計の純粋関数・決定論ルール・LLM不使用)
   - `src/store/useChurnRiskStore.ts`
   - `src/components/admin/churn/ChurnRiskScreen.tsx`
   - `app/admin/churn-risk/page.tsx`
5. **テスト**(§5)
6. **スクリーンショット**(§6)
7. **本レポート**

## 4. 危険判定ロジック(すべて決定論的コード・LLM/AI不使用)

`src/lib/churn/ChurnRiskEngine.ts` `computeChurnRisk()`

1. 顧客ごとに来店履行履歴(`brain_visits.visit_date`)を時系列ソート
2. 来店が2回未満(新規客)は平均来店間隔を算出できないため**対象外**(`phase5/customerRiskEngine.ts`の`new`フェーズと同じ考え方を踏襲)
3. `avgIntervalDays` = 来店間隔の平均(日数)
4. `daysSinceLastVisit` = 基準日(既定は本日) − 最終来店日
5. `cycleOverRate = daysSinceLastVisit / avgIntervalDays`
6. `churnRiskScore = clamp((cycleOverRate − 1) / 2, 0, 1)`(本タスクで新規定義)
7. `churnRiskScore >= 0.25`(≒ `cycleOverRate >= 1.5`・平均間隔の1.5倍を超えて来店が無い)のみ「危険顧客」として一覧に含め、スコア降順で返す

**設計判断の要確認**: 閾値(0.25=1.5倍)とスコア式はアーキ文書に数式定義が無いため本タスクで新規に決定したもの。実運用で「危険」の感度を調整したい場合は`CHURN_RISK_THRESHOLD`定数の変更で対応可能。

## 5. テスト結果

`npm test`: **34 files / 378 tests 全成功**(既存358件 + 本タスクで20件追加)
`npm run typecheck`: 本タスク関連ファイルはエラーなし。既存無関係2件のみ残存。

新規テスト:
- `tests/lib/churn/ChurnRiskEngine.test.ts`(7件): 新規客(来店1回)除外/閾値未満除外/危険客検出/担当スタッフ解決/未割当時null/スコア降順ソート/スコア1クランプ/同日来店ガード
- `tests/api/churn-risk.test.ts`(6件): 一覧取得・バリデーション・0件時の正常応答・エラー系
- `tests/api/churn-risk-instruct.test.ts`(7件): 正常記録(LINE/予約系リポジトリ不使用の確認込み)・バリデーション・顧客の店舗越境防止・スタッフ未存在404・JSONパースエラー・Repository例外

## 6. 実データ確認・スクリーンショット

**API実DB確認**: `GET /api/admin/churn-risk?storeId=00000000-0000-0000-0000-000000000001`を実行し、`{"success":true,"dangerCustomers":[]}`を確認。当店舗の全39来店が現状すべて初回来店(2回目来店を持つ顧客が0件・MD-1タスクで確認済みの事実と整合)のため、**危険顧客0件は正しい挙動**(バグではない)。

ユーザー確認のうえ、本番データはこの空状態のままスクリーンショットを取得する方針とした(カード表示・指示ボタンの実際の見た目は、ロジックを検証済みの単体テスト+API契約テストで代替保証)。

`docs/screenshots/MD-2_churn_risk_empty_state.png` — 「現在、危険顧客はいません」の空状態を確認。

**指示APIの実DB動作確認**: `POST /api/admin/churn-risk/instruct`を実DBに対して実行し、`brain_ops_logs(kind='churn_instruction')`への記録を確認。

調査の過程で、Git Bashのcurlコマンドライン経由で日本語の`note`を送信すると文字化け(mojibake)することを発見したが、Node.js `fetch`(実際のブラウザUIの送信経路と同じ仕組み)で再送信したところ正常に保存されることを確認した。**これはAPIコードの不具合ではなく、Windowsシェル(Git Bash)のcurl引数エンコーディングに起因する検証手順上の問題**と判断した(根拠: ブラウザ`fetch`/Next.jsの`req.json()`はUTF-8前提で一貫しており、CSV Import等の既存機能で日本語の氏名・スタッフ名が正しく保存・表示されていることと矛盾しない)。検証用に作成した2件のテストログは確認後に削除済み(本番データへの影響なし)。

## 7. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_customers` | 危険顧客候補・担当スタッフID(`ICustomerRepo.listByStore()`) |
| `brain_visits` | 来店履行履歴(最終来店日・平均来店間隔の算出元・`IVisitRepo.listByStore()`) |
| `brain_staff` | 担当スタッフ名の解決(`IStaffRepo.listByStore()`) |
| `brain_ops_logs` | 「担当スタッフへ指示」の記録先(`kind='churn_instruction'`・新規列追加なし) |

新規業務テーブルの追加なし。`brain_line_send_queue`(LINE送信)・`brain_bookings`(予約)は一切参照していない(コード上importもしていない)。

## 8. 残課題

1. **スタッフ側の受信UIは未実装**: 本タスクは「管理者が指示を記録する」までがスコープ。スタッフアプリ側で`brain_ops_logs(kind='churn_instruction')`を読んで通知表示する機能は別タスク
2. **危険判定閾値の運用調整**: `CHURN_RISK_THRESHOLD=0.25`は本タスクでの新規決定。実運用データが増えた段階で感度の見直しが必要になる可能性がある
3. **API認可(owner専用)の横断的な未検証**: CSV Import管理APIと同様、`/api/admin/churn-risk*`もコードレベルのrole=owner強制チェックは未実装(既存のCSV Import管理APIと同じ既知のギャップ・本タスクで新たに導入したものではない)
4. **実データでの populated 表示確認は未実施**: 現状0件のため、カード表示・指示フォームの実際の見た目は本番データでは確認できていない(単体テスト・API契約テストでロジックは保証済み)。来店2回目以降のデータが蓄積された時点で再確認が望ましい
