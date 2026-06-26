# Riora 管理者ダッシュボード 実装パッケージ

VSCode / Claude Code へ渡す設計正典一式。`docs/architecture/` にこのまま配置してください。

## 使い方(Claude Codeへの指示文・例)

> `docs/architecture/` 内の設計書を正として、Management Dashboard v2.1 を実装してください。
> 矛盾時の優先順位は: Master Schema > API/P0 > Event Flow/Repository > Management Dashboard v2.1 > UI仕様 > 損益分岐。
> 実装順は DB差分 → API → UI。コードはこれらの規約(engines=pure・RLS二重防衛・1画面1リクエスト)に従うこと。

## 同梱ファイルと役割(11本)

### ★ 今回の主対象
| ファイル | 役割 |
|---|---|
| Riora_Management_Dashboard_Architecture_v2.1.md | **最新・正**。CSV Import統合・B案ハイブリッド・6画面+CSV画面 |
| Riora_Management_Dashboard_Architecture_v2.0.md | v2.1の土台(画面①〜⑤の詳細はこちらが本体)。v2.1とセットで読む |
| Riora_管理者ダッシュボード_UI仕様_v1.0_モック注釈版.md | レイアウト・モックのどこを直すか(サイドバー6項目/KPI帯/配色) |
| Riora_損益分岐_コスト構造_設計書_v1.0.md | 利益・損益分岐・着地予測の計算式と実数(固定費約172万/損益分岐月商約185〜194万/社保ハイブリッド) |

### 依存する正典(整合のため必須)
| ファイル | 役割 |
|---|---|
| Riora_Database_Master_Schema_v1.0.md | テーブル・RLS・business_settings拡張先。**DB構造の最上位の正** |
| Riora_API_Architecture_v1.0.md | GET /api/dashboard/* の体系 |
| Riora_P0_API_Schema_v1.0.md | リクエスト/レスポンス/権限/冪等の型 |
| Riora_Event_Flow_Architecture_v1.0.md | 夜間バッチ(dashboard_daily生成)の順序・Silent Error |
| Riora_Repository_RPC_Architecture_v1.0.md | 計算はTS/原子性はDB/JWT信頼の規約 |
| CSVImportSecurityArchitecture.md | CSV取込の個人情報破棄ルール(画面⑥の前提) |
| SalonBoard_CSV_Import_Implementation_Architecture_v1.0.md | 画面⑥の実装実体(Parser/Sanitizer/UPSERT) |

## 実装着手の前提(順番厳守)

1. **DB差分を先に通す**:
   - Master Schema W19(dashboard_daily列追加・business_settings: seat_capacity / variable_cost_rate / fixed_costs JSONB / variable_rates JSONB)
   - brain_staff.name_aliases JSONB(CSV名寄せ用・新規業務テーブルは作らない)
   - brain_visits.source CHECK に 'reconciled' 追加(B案突合用)
2. **API**(GET /api/dashboard/* と owner専用 /api/admin/csv/*)
3. **UI**(モック注釈版どおり・管理者画面はadmin枠=現場アプリのUIロック対象外)

## 確定済みの経営数値(損益分岐設計書より)

- 固定費 約¥1,715,446/月(役員報酬・固定給・交通費¥42,800・家賃¥437,646・HotPepper¥55,000・freee月割¥10,000・社保概算¥150,000)
- 変動費率 約7.5%(歩合5%+Square2.5%)+指名バック¥250/件・物販原価
- 損益分岐点 月商 約¥1,854,536(光熱費等込みで約¥194万)
- 社保=報酬総額ベース15.5%・月1回freee実額で上書き(給与計算はfreeeが正)

## 注意

- 新規業務テーブルは作らない(brain_customers/bookings/visits利用・reservations/sales_data禁止)
- 経営ダッシュボードに現場操作(LINE送信・予約取得)を置かない(スタッフアプリの責務)
- スタッフにランキング・順位を見せない / 売上は指名率・リピート率とセット
