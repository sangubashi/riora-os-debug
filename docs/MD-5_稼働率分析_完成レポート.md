# MD-5 稼働率分析 完成レポート

作成日: 2026-06-23

## 1. DB設計確認(実装着手前に実施)

既存4テーブル(`brain_visits`/`brain_staff`/`brain_business_settings`/`brain_dashboard_daily`)のみで4項目すべてが算出可能か、実装前に実データへ直接クエリして検証した。

| 表示項目 | 判定 | 根拠(実データ確認結果) |
|---|---|---|
| ①スタッフ別稼働状況 | ✅ 可能 | `brain_visits`(staff_id/treatment_amount/retail_amount/is_nomination)+`brain_staff`(name)で算出可能 |
| ②曜日別来店数 | ✅ 可能 | `brain_visits.visit_date`(date型)から曜日をコード側で算出可能 |
| ③時間帯別来店数 | ❌ **不可能** | `brain_visits`に時刻を保持する列が存在しない。`visit_date`は`date`型(時刻無し)。`created_at`を代用候補として実データを確認したところ、同一store内で異なる`visit_date`の行が`created_at`では1秒以内に密集していることを確認 — CSV一括取込時のDB書込時刻であり来店時刻ではないため使用不可と判断 |
| ④稼働率推移 | ❌ **不可能** | 稼働率=来店数÷席数(時間帯別)の算出には(a)時間帯別来店データ(③同様に不存在)と(b)`brain_business_settings.seat_capacity`(曜日×時間帯別の席数)が必要。実データで`seat_capacity`が**null(未設定)** であることを確認。`brain_dashboard_daily.occupancy`も常に`{}`(MD-1のDashboardAggregatorでも意図的に未算出としたスコープ外項目) |

**ユーザー確認の結果**: ③④もダミーデータで埋めず、「取得不可」セクション+理由をUIに明示する方針で実装することとした。新規テーブル・migrationは追加しない。

## 2. Repository実装

ユーザー指示により、本タスクの集計ロジック(スタッフ別集計・曜日別集計)はRepository層に置く(MD-1〜MD-4で採用した`src/lib`配下のEngineファイル分離パターンとは異なる、本タスク限定の方針)。

`src/repositories/interfaces.ts`に`IOccupancyRepo`(`staffOccupancy()`/`visitsByDayOfWeek()`)を追加。`src/repositories/supabase/OccupancyRepo.ts`で実装:

- `staffOccupancy(storeId)`: `brain_staff`と`brain_visits`を並列取得し、スタッフごとの来店件数・売上(treatment+retail)・指名率(全履歴)を集計して返す
- `visitsByDayOfWeek(storeId)`: `brain_visits.visit_date`を取得し、UTC固定で曜日を算出(タイムゾーンによるずれを防止)。月〜日の7件を固定順で返す(来店0件の曜日も0として含む)

`app/lib/repos.ts`に`occupancyRepo`を追加。新規テーブル・migrationなし。

## 3. API実装

`app/api/admin/occupancy/route.ts`(GETのみ・編集機能なし)。`app/api/_schemas/query.ts`に`occupancyQuerySchema`追加。

①②は`OccupancyRepo`の結果をそのまま返す。③は常に`{available: false, reason: "..."}`(時刻列が存在しないため、店舗設定に関わらず常に不可能)。④は`businessSettingsRepo.findByStoreAndMonth()`で`seat_capacity`の設定状況を確認し、未設定なら「seat_capacity未設定」、設定済みでも時間帯データが無い旨を理由に含めて返す(設定済みでも③の制約がある限り④は常にfalse)。

## 4. UI実装

`src/store/useOccupancyStore.ts`・`src/components/admin/occupancy/OccupancyScreen.tsx`(①テーブル風リスト/②曜日別バーチャート/③④「取得不可」通知カード)・`app/admin/occupancy/page.tsx`。`src/components/admin/AdminSidebar.tsx`に「稼働率分析」(`/admin/occupancy`)を追加(経営TOP・失客リスク・顧客管理・スタッフ分析・CSV Importの間、スタッフ分析の次)。

## 5. テスト結果

`npm test`: **45 files / 442 tests 全成功**(既存429件 + 本タスクで13件追加)
`npm run typecheck`: 既存無関係2件のみ残存。

新規テスト:
- `tests/repositories/supabase/OccupancyRepo.test.ts`(6件): スタッフ別集計(担当来店0件はnominationRate=null)/エラー系2件/曜日別集計(複数来店の正しい曜日への振り分け・0件曜日含む7件固定)/来店0件時/エラー系
- `tests/api/occupancy.test.ts`(7件): ①②取得・③が常にavailable:false/④がseat_capacity未設定時とseat_capacity設定済みでも時間帯データ欠如により依然false/バリデーション/エラー系

## 6. 実データ確認

`GET /api/admin/occupancy?storeId=00000000-0000-0000-0000-000000000001`を実行し、以下を確認(`npm run dev`の実環境・実Supabaseプロジェクトに対して):

**①スタッフ別稼働状況**(全履歴):
| スタッフ | 来店件数 | 売上 | 指名率 |
|---|---|---|---|
| 鈴木 | 19件 | ¥608,710 | 42% |
| 亀山 | 11件 | ¥100,000 | 18% |
| 外舘 | 9件 | ¥93,050 | 56% |

合計39件で、これまでのタスク(MD-1/MD-4)で確認済みの全39来店という事実と一致。

**②曜日別来店数**: 月2/火5/水9/木4/金4/土6/日9(合計39件で一致)。

**③④**: いずれも`available: false`。③は「brain_visitsに来店時刻を保持する列が存在しないため算出できません」、④は「seat_capacityが未設定のため算出できません。加えて〜」を返すことを確認。

## 7. スクリーンショット

`docs/screenshots/MD-5_occupancy_real_data.png` — サイドバーに「稼働率分析」が追加され現在地としてハイライト表示、①テーブル・②曜日別バーチャート(実データ)・③④「取得不可」カード(理由付き)がすべて正しく表示されることを確認。

## 8. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_visits` | ①②の算出元(staff_id/visit_date/treatment_amount/retail_amount/is_nomination) |
| `brain_staff` | ①のスタッフ名解決 |
| `brain_business_settings` | ④の判定用(`seat_capacity`設定有無の確認のみ。実際の稼働率算出には使えない) |
| `brain_dashboard_daily` | 調査のみ(`occupancy`列が常に`{}`であることを確認・使用せず) |

新規業務テーブル・新規列の追加なし。

## 9. 残課題

1. **③時間帯別来店数・④稼働率推移は構造的に算出不可能**: 実装する場合は(a)`brain_visits`への来店時刻列の追加(例: `visit_time`または`visit_datetime`への変更)、(b)`brain_business_settings.seat_capacity`の運用開始、の両方が必要。いずれもmigration・運用変更を伴うため別タスクとして要判断
2. **API認可(owner/manager専用)の横断的な未検証**: MD-1〜MD-4と同じ既知のギャップ
3. **①スタッフ別稼働状況はMD-4スタッフ分析と算出対象が重複**: ユーザー承認済み(本タスクの指示どおり)。集計範囲が異なる(MD-4は当月売上+全履歴指名率/リピート率/LTV/成長率、MD-5は全履歴の来店件数+売上+指名率)ため、UI上は別画面として独立させている
