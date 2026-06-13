# Riora API Architecture v1.0

**株式会社martylabo / Salon Riora — Riora OS 全体API設計 確定版**
作成日: 2026-06-11
正典関係: Database Master Schema v1.0 を上位の正とする。**API設計に矛盾があれば本書を正とする。**

## 0. アーキテクチャ前提

| 項目 | 確定 |
|---|---|
| 実行形態 | 3層: ①公開API = Next.js Route Handlers(/api/*) ②中核書込 = Supabase RPC(Postgres Function・トランザクション保証) ③バッチ = Edge Functions(cron起動・REST非公開) |
| 認証 | Supabase Auth。JWTクレームに store_id / role(owner/manager/staff)。RLSは current_setting('app.store_id') と連動 |
| 命名規約 | リソース複数形・動詞はPOSTのアクションサフィックスのみ許可(/approve, /reject, /cancel, /adopt) |
| 書込の正面玄関 | Master Schema 5章の原則を継承: **SaveVisitRecord / Revision Approve / Line Approve の3つに集約**。progress・outcomes・log系への直接書込APIは存在させない |
| レスポンス規約 | `{ ok: boolean, data?, degraded?: string[], error? }`。degraded配列がSilent Error UXの伝達路(8章) |

---

# 1. API一覧(全38本)

## Staff App(施術スタッフが使う)

| # | API | 説明 | P |
|---|---|---|---|
| 1 | POST /api/visits/save | **SaveVisitRecord(中核・2章)** | P0 |
| 2 | GET /api/bookings/today | 本日の予約一覧(ブリーフィング添付) | P0 |
| 3 | GET /api/briefing?date= | 自分の担当顧客の当日ブリーフィング(dashboard_cache読取) | P1 |
| 4 | POST /api/customers | 初回カウンセリング登録(タイプ分類実行・同意込み) | P0 |
| 5 | GET /api/customers/:id | 顧客詳細(Context Bundle: 基本+progress+肌推移+直近メモ要約) | P0 |
| 6 | GET /api/customers/:id/skin-trend | 肌レベル時系列(チャート用) | P1 |
| 7 | POST /api/visits/:id/voice-memo | 音声メモアップロード→構造化キュー投入 | P1 |

## Manager Dashboard(久保田さん・オーナー)

| # | API | 説明 | P |
|---|---|---|---|
| 8 | GET /api/dashboard/top | トップ画面(dashboard_daily 1行読取) | P1 |
| 9 | GET /api/dashboard/staff | スタッフ画面(staff_matrix+affinity) | P1 |
| 10 | GET /api/dashboard/customers | 顧客画面(segment_matrix+離脱リスト+候補) | P1 |
| 11 | GET /api/dashboard/patterns | 成功パターン画面(funnel+承認待ちrevision) | P2 |
| 12 | GET /api/dashboard/monthly?month= | 月次分析 | P2 |
| 13 | GET /api/customers?segment=&type=&churn= | 顧客リスト(セルタップのドリルダウン) | P1 |
| 14 | PATCH /api/customers/:id | 顧客情報修正(タイプ・目標・担当) | P1 |
| 15 | POST /api/subscriptions | サブスク契約登録 | P1 |
| 16 | POST /api/subscriptions/:id/cancel | 解約(理由必須) | P1 |
| 17 | PUT /api/settings/business | 月次目標・固定費設定 | P1 |
| 18 | GET /api/insights | AIインサイト一覧 | P2 |
| 19 | POST /api/insights/:id/instruct | [指示を出す]→ツンくま下書き生成→line_send_queue起票 | P2 |
| 20 | GET /api/reports/monthly/export | 月次レポート出力(LINE共有用・solid背景規約) | P2 |

## Revision System(学習の承認)

| # | API | 説明 | P |
|---|---|---|---|
| 21 | GET /api/revisions?status=proposed&scope= | 承認待ち一覧(evidence込み) | P1 |
| 22 | POST /api/revisions/:id/approve | 承認+apply(pattern_steps書換+version+1を内包) | P1 |
| 23 | POST /api/revisions/:id/reject | 却下(理由任意) | P1 |

## Line Queue(LINE承認)

| # | API | 説明 | P |
|---|---|---|---|
| 24 | GET /api/line-queue?status=pending | 承認待ちLINE一覧(evidence・シナリオ出所込み) | P1 |
| 25 | POST /api/line-queue/:id/approve | 承認→送信予約 | P1 |
| 26 | POST /api/line-queue/:id/reject | 却下(reject_reason→scenario_outcomes・2回却下で恒久停止) | P1 |
| 27 | POST /api/line/webhook | LINE Messaging API webhook(送達・既読・返信受信) | P2 |

## Pattern / Scenario(参照・店舗カスタム)

| # | API | 説明 | P |
|---|---|---|---|
| 28 | GET /api/patterns | アクティブパターン+steps(2層解決済み) | P1 |
| 29 | GET /api/patterns/fire-log?customerId= | 発火トレース(なぜ提案が出た/出なかったか) | P2 |
| 30 | GET /api/scenarios | シナリオ60本(2層解決済み) | P2 |
| 31 | PATCH /api/scenarios/:uid | 店舗オーバーライド(Manager・Lv4 Guard通過必須) | P2 |

## Brain(中央・本部)

| # | API | 説明 | P |
|---|---|---|---|
| 32 | GET /api/brain/benchmarks | 自店の同クラスタ内位置(p25/50/75) | P2 |
| 33 | GET /api/brain/library | ブランド標準パターンの新version通知一覧 | P2 |
| 34 | POST /api/brain/library/:code/adopt | 店舗が新versionを[採用](NULL行復帰 or 店舗行置換) | P2 |
| 35 | GET /api/brain/learning-history | 学習・配信の監査履歴 | P2 |

## 内部・バッチ(REST非公開・Service Role/Brain Batchのみ)

| # | 実体 | 説明 | P |
|---|---|---|---|
| 36 | RPC save_visit_record | #1の実体(Postgres Function) | P0 |
| 37 | Edge: nightly-dashboard(23:30) / nightly-etl(23:50) / monthly-learning(毎月1日) / after-visit-learning(随時) | 4バッチ | P0/P1 |
| 38 | Edge: brain-distribute(月次) / queue-expire(毎時) / outcome-confirm(日次: 14日転換確定) | 配信・期限切れ・転換確定 | P2 |

---

# 2. SaveVisitRecord API(最重要・トランザクション仕様)

`POST /api/visits/save` → `RPC save_visit_record(input)`

```
■ 同期トランザクション TX1(失敗 = 全ロールバック・APIエラー返却)
 1. brain_visits INSERT
    - visit_count_at = 過去visits数+1(SELECT ... FOR UPDATEで同時実行を直列化)
    - visit_score = VisitScoreCalculator(タイプC重み入替・初回正規化込み)
 2. brain_skin_records INSERT(primary_delta = タイプ主要指標の初回比)
 3. nextBookingMade=true → brain_bookings INSERT(status='active')
 ── ここまでが「現場の事実」。これだけは絶対に守る ──

■ 同一リクエスト内・ベストエフォート区画 BE1(失敗してもTX1は確定済み)
 4. PatternContext再構築(customerRepository: 1クエリJOIN)
 5. brain_pattern_progress UPDATE(advance/stall/completed判定)
 6. brain_proposal_outcomes INSERT/UPDATE
    - 入力トグル→自動マッピング(homecare✓=executed+accepted / declined=executed+not accepted /
      rebooking=nextBookingMadeで判定)
    - 前夜briefing(dashboard_cache)に載っていた提案の消込(was_briefed=true)
 7. churn_score再計算 → brain_customers UPDATE
 8. pattern_fire_log INSERT(次回向け発火トレース)
 9. ScenarioSelector同期トリガ分(first_visit_done/no_rebooking/proposal_declined/peeling_done)
    → scenario_trigger_log + line_send_queue(pending)
 BE1内のいずれか失敗 → evaluation_queue INSERT(visit_id, reason) + ops_logs。
 レスポンスの degraded[] に区画名を記載(UIは気にしない・夜間バッチが回収)

■ 非同期(リクエスト外)
 10. after-visit-learning invoke(音声メモ構造化)
 11. dashboard_daily への反映は **しない**(リアルタイム更新せず23:30バッチに一任。
     当日数値はdashboard/topが visits を軽量COUNTで補完表示)

レスポンス: { ok: true, data: { visitId, visitScore, churnLevel }, degraded: [...] }
冪等性: リクエストに client_request_id(UUID) 必須。同一IDの再送はTX1をスキップし前回結果を返す
       (電波の悪い店内でのダブルタップ対策)
```

反映順序の確定: **visit → skin_record → booking →(境界)→ pattern_progress → proposal_outcome → churn → fire_log → scenario起票 →(夜間)→ dashboard_daily**。

# 3. Pattern Engine 接続(データフロー)

```
入力源: ①save_visit_record BE1(来店直後・次回向け) ②nightly-dashboard(翌日予約者分)
 ↓
customerRepository.loadContextBundle(customerId)
  = customers + visits(昇順) + skin_records + progress + subscription を1クエリ
 ↓
PatternContextBuilder.buildContext() → PatternContext(13変数)
 ↓
ProposalGenerator.generateProposals({ctx, steps(2層解決済), recentOutcomes, staffStyle, timingOffsets})
  内部順序: ①timing_offset仮context補正 ②ハードゲート(subsc4条件/churn>0.7)
            ③CooldownController ④ConditionEngine(JSON Logic) ⑤priority→上位2件
 ↓ 出力2系統
 A. Briefing(店内): ScriptComposer(style補正+NG検査) → dashboard_cache(kind='briefing')
    → GET /api/briefing で配信(リオラちゃん表示・isMandatory赤1件)
 B. trace: 全step判定 → pattern_fire_log(blockedBy込み)
 ↓ 実行結果
翌来店のsave_visit_record入力トグル → proposal_outcomes確定(消込)
 ↓ 月次
monthly-learning → セル集計 → RevisionDrafter → Lv4 Guard → brain_revisions(scope='store')
```

# 4. Scenario Engine 接続(発火→送信)

```
発火3系統:
 A. 同期: save_visit_record BE1(初回/予約なし/拒否/peeling)
 B. 夜間: nightly-dashboard内(周期倍率クロス/skin_improved/subsc_cond遷移/CSI/ペース低下)
 C. 月暦: monthly-learning+カレンダー(季節/誕生月/解約後30日/E1転生)
 ↓ ScenarioTriggerEvent
ScenarioSelector(pure・5段)
 1. 候補抽出(trigger×タイプ×is_active・2層解決)
 2. scenario_trigger_log冪等キー確認(既存なら即終了)
 3. fire_condition評価(Pattern Engineと評価器共用)
 4. 抑制(7日1通/同一30日/同群14日/販売系クールダウン/churn販売停止/2回却下恒久停止/静音時間)
 5. priority解決→1顧客1通(販売系同士の統合禁止)
 ↓
line_send_queue INSERT(pending, evidence, scheduled_at, expires_at=+72h)
 ↓ 人間
GET /api/line-queue → POST /api/line-queue/:id/approve(または reject)
 ↓ 送信ワーカー(queue-expireが期限切れをexpired化)
LINE Messaging API送信 → status='sent' → scenario_outcomes INSERT
 ↓ 反応
POST /api/line/webhook(既読・返信) → scenario_outcomes UPDATE
outcome-confirmバッチ(日次) → booking_within_14d / revenue_within_30d 確定
 ↓
nightly-etl → brain_events(event_type='dm') → 月次学習(successScore上書き・Lv2起票)
```

# 5. Dashboard API(利用者別)

| 利用者 | API | 内容・設計判断 |
|---|---|---|
| Staff | #2 bookings/today | 予約+顧客タイプ+パターン段階のみ(売上情報は出さない) |
| Staff | #3 briefing | **自分の担当分のみ**(RLS+API二重フィルタ)。isMandatory1件赤表示用フラグ |
| Staff | #5/#6 顧客詳細・肌推移 | 施術中参照用。CustomerBottomSheetのデータ源 |
| Manager/Owner | #8 top | dashboard_daily 1行+当日visitsの軽量COUNT(売上速報)。**3分ルールの実装はこの1本のレスポンスで完結させる** |
| Manager/Owner | #9-#12 | 各画面1API・1画面1リクエスト原則(モバイル速度優先。画面内の追加fetch禁止) |
| Manager/Owner | #13 顧客リスト | segment_matrixセルタップのドリルダウン(ページング必須) |
| Manager/Owner | #18-#19 insights | 既読管理+[指示を出す]→ツンくま下書き→line_send_queue(承認フロー合流) |

# 6. Brain API(中央の流れ)

```
nightly-etl(店舗・23:50)
  店舗層の当日確定分 → 匿名化変換(hash/band/style/日付化・同意false除外)
  → brain_events 冪等upsert → ops_logs(kind='etl', 件数/除外数)

monthly-learning(Brain Batch・毎月1日)
  brain_events 6ヶ月分 → クラスタ別集計
  → brain_benchmarks 更新(sample_stores<5はis_reference)
  → brain_params 更新候補(churn重み/style_affinity/タイミング行列)
  → 改善候補 → brain_revisions(scope='brand', test_design込み)起票

本部承認(Owner: 久保田さん/岸さん)
  GET /api/revisions?scope=brand → approve
  → brain_pattern_library 新version INSERT(superseded_byチェーン)
  → brain_learning_history INSERT(何を学び何を配信したかの監査)

brain-distribute(月次)
  approved版 → 各店 brain_success_patterns / brain_scenarios の store_id=NULL行へUPSERT
  → 店舗オーバーライド行は不可侵 → 店舗は #33 で通知確認・#34 で[採用]
```

# 7. 権限設計(ロール×API)

| API群 | Owner | Manager | Staff | Service Role | Brain Batch |
|---|---|---|---|---|---|
| #1 visits/save | ○ | ○ | ○(自分が担当の来店のみ) | — | — |
| #2-#7 Staff App | ○ | ○ | ○(自担当スコープ) | — | — |
| #8-#20 Dashboard/設定 | ○ | ○ | —(※#3,#5,#6のみ可) | — | — |
| #21-#23 Revisions | ○(approve可) | ○(approve可) | — | 起票のみ(API外・RPC) | scope='brand'起票 |
| #24-#26 Line Queue | ○ | ○ | R(自担当顧客の送信履歴閲覧のみ) | 起票・sent遷移 | — |
| #27 webhook | — | — | — | ○(署名検証必須) | — |
| #28-#31 Patterns/Scenarios | R | R+#31(オーバーライド) | R(script閲覧) | R | NULL行UPSERT |
| #32-#35 Brain | ○ | ○ | — | — | ○(集計・配信) |
| #36-#38 内部 | — | — | — | ○ | ○ |

強制方法: ①JWT roleでRoute Handler入口判定 ②RLSで二重防衛(Master Schema 4章の30ポリシー) ③approve系はrole判定に加えdecided_by記録必須。**権限昇格の例外パスは作らない**(「とりあえずservice_roleで」をアプリコードに書いたらレビュー不合格)。

# 8. エラー設計(Silent Error UX)

原則: **現場(スタッフ)の30秒入力を絶対に止めない。失敗は飲み込み、裏で回収し、管理者にだけ見せる。**

| クラス | 対象 | 保存するもの | 捨てるもの | UI挙動 |
|---|---|---|---|---|
| BLOCKING | TX1(visit/skin/booking) | — (ロールバック) | なし(client_request_idで再送可能) | 唯一エラーを見せる: 「保存できませんでした。もう一度タップ」+ローカル下書き保持 |
| DEGRADED | BE1(progress/outcomes/churn/scenario起票) | TX1は確定済み+evaluation_queue(visit_id, reason)+ops_logs | その場の提案計算結果(夜間再評価で再生成) | **何も表示しない**。degraded[]はログ用途のみ |
| SILENT | バッチ(briefing生成/ETL/dashboard) | 前回成功分のキャッシュ温存+ops_logs(kind='batch_error') | 当回の生成物 | ブリーフィング: 前日キャッシュ+「最新情報を準備中」1行。dashboard: 前日スナップショット表示 |
| GUARD | Lv4違反revision/NGワード文面 | ops_logs(kind='guard_violation', diff全文) | 起票・文面そのもの(**保存しない=本番に痕跡を残さない**) | 表示なし。月次でguard件数をinsightsに集計 |
| EXPIRE | line_send_queue 72h超過 | status='expired'として履歴保持(cooldown入力に使う) | 送信 | 承認画面から自動消滅 |

回収経路: evaluation_queue → nightly-dashboard冒頭で全件再評価 → resolved。3回失敗した行は ops_logs に昇格し ai_insights に「要確認」として表示(人間へのエスカレーションは1日1回・夜間にまとめて)。

# 9. API優先順位

| 区分 | 定義 | 対象 |
|---|---|---|
| **P0** 絶対必要(これが無いと学習が始まらない) | #1 visits/save / #2 bookings/today / #4 customers作成 / #5 customer詳細 / #36 RPC / #37のnightly-dashboard・nightly-etl | 6系統 |
| **P1** Phase1(学習ループ1周に必要) | #3 briefing / #6-#7 / #8-#10 dashboard主要3画面 / #13-#17 / #21-#23 revisions / #24-#26 line-queue / #28 patterns / #37 monthly-learning | 約20本 |
| **P2** Phase2以降 | #11-#12 / #18-#20 insights・レポート / #27 webhook / #29-#31 / #32-#35 Brain / #38 | 約12本 |

# 10. Claude Code 実装順(依存関係)

```
Step1 DB(完了前提): Master Schema W1〜W7
   ↓
Step2 Pattern Engine(UI禁止・pure)
   成果物: engines/pattern一式 + RPC save_visit_record + nightly-dashboard(briefing生成まで)
   依存: W1-W3, W5。 検証: タスク分解書T2系+本書2章のTX1/BE1区画テスト
   ↓
Step3 Scenario Engine(UI禁止)
   成果物: ScenarioSelector + 60本シード + line_send_queue起票 + queue-expire + nightly-etl
   依存: Step2(評価器・CONTEXT_VARS共用), W4, W6。 検証: 冪等・抑制・統合テスト
   ↓
Step4 API(本書#1〜#26のP0/P1を実装)
   成果物: Route Handlers + 認証/role入口判定 + degraded[]規約 + approve系(revisions/line)
   依存: Step2-3(APIは薄いラッパに徹する — ロジックをRoute Handlerに書いたら不合格)
   ↓
Step5 UI接続(安定化フェーズ完了後・既存UIロック解除を待つ)
   成果物: 施術後入力1画面 / ブリーフィング表示 / ダッシュボード3画面 / 承認2画面
   依存: Step4。 検証: 入力完了率90%(3人×1週間)・top画面1リクエスト完結
```

並行可能性: Step3の60本シードとStep4の参照系GETはStep2完了を待たず先行可。approve系とsave系はStep2/3完了が前提。**Step5より前にUIへ触ることは禁止**(現行UIロック準拠)。

---
*Riora API Architecture v1.0 — API設計の唯一の正とする。Master Schema v1.0と矛盾した場合のみ、DB構造はMaster Schemaが優先。*
