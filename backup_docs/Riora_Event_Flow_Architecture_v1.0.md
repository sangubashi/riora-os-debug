# Riora Event Flow Architecture v1.0

**株式会社martylabo / Salon Riora — Riora OS イベントフロー確定版**
作成日: 2026-06-11
正典関係: Database Master Schema v1.0 / API Architecture v1.0 / P0 API Schema v1.0 と並ぶ正典。**イベントの発生順序・トランザクション境界・障害時挙動に矛盾があれば本書を正とする。**

---

## 0. イベント体系の全体像

Riora OSのイベントは4つの時間軸で動く。

| 時間軸 | トリガ | 主要処理 |
|---|---|---|
| リアルタイム | スタッフの保存タップ | TX1(事実保存)+BE1(エンジン評価)+同期Scenario起票 |
| 夜間(23:30/23:50) | cron | 再評価回収→集計→ブリーフィング→DM発火→ETL |
| 日次・毎時 | cron | queue-expire(毎時)/outcome-confirm(日次) |
| 月次(1日02:00) | cron | 店舗学習(Lv2起票)→Brain学習(Lv3起票)→配信 |

不変原則(全フロー共通):
1. **店舗のリアルタイム動作はBrainに依存しない**(Brain全停止でも店は完全動作)
2. **書込の正面玄関は3つ**: SaveVisitRecord / ApproveRevision / ApproveLineSend
3. **発火基準の変更は翌朝から有効**(施術中にルールが変わらない)
4. **失敗は飲み込んで回収する**(Silent Error UX・6章)

---

# 1. リアルタイムフロー(来店入力→保存→評価)

```
お見送り直後・スタッフが1画面入力(30秒)
 → POST /api/visits/save(clientRequestId付き)
 → 冪等チェック: 同一IDなら初回レスポンス再現で即200
 → TX1実行(2章) → BE1実行(2章) → レスポンス返却(degraded[]付き)
 → 非同期: after-visit-learning(音声メモ構造化)
```

UI体感の確定値: TX1+BE1合計でp95 < 1.5秒を目標。BE1が重い場合はBE1全体を非同期化してよい(その場合レスポンスのpatternAdvanced/nextVisitProposalsはnull許容に落とす — 実装時の性能実測で判断し、判断結果は本書改版に記録)。

# 2. SaveVisitRecord 内部処理順(確定)

```mermaid
sequenceDiagram
    participant UI as Staff App
    participant API as /api/visits/save
    participant TX1 as TX1(絶対防衛)
    participant BE1 as BE1(ベストエフォート)
    participant Q as evaluation_queue

    UI->>API: SaveVisitRequest(clientRequestId)
    API->>API: 冪等チェック(store_id, client_request_id)
    alt 既存
        API-->>UI: 初回レスポンス再現(200)
    end
    API->>TX1: BEGIN
    TX1->>TX1: 1. brain_visits INSERT(visit_count_at採番/visit_score計算)
    TX1->>TX1: 2. brain_skin_records INSERT(primary_delta計算)
    TX1->>TX1: 3. brain_bookings INSERT(nextBookingMade時)
    alt TX1失敗
        TX1-->>UI: TX_FAILED(retriable)※唯一エラーを見せる
    end
    TX1->>BE1: COMMIT後に開始(以降ロールバック不可)
    BE1->>BE1: 4. PatternContext再構築(1クエリJOIN)
    BE1->>BE1: 5. brain_pattern_progress UPDATE(前進/停滞/完了)
    BE1->>BE1: 6. brain_proposal_outcomes 確定(トグル自動マッピング+briefing消込)
    BE1->>BE1: 7. churn再計算 → brain_customers UPDATE
    BE1->>BE1: 8. pattern_fire_log INSERT(次回向け発火trace)
    BE1->>BE1: 9. 同期Scenario起票(first_visit/no_rebooking/declined/peeling)
    alt BE1いずれか失敗
        BE1->>Q: evaluation_queue INSERT(visit_id, 区画名)
        BE1->>BE1: ops_logs記録・degraded[]に追記・処理続行
    end
    API-->>UI: 200 { visitId, visitScore, churn, degraded[] }
    API->>API: 非同期invoke: after-visit-learning
```

**dashboard_dailyへの書込はこのフローに存在しない**(夜間バッチ専管)。当日売上はGET /api/dashboard/topの軽量COUNTが補完する。

# 3. 夜間バッチフロー(23:30 nightly-dashboard → 23:50 nightly-etl)

```mermaid
flowchart TD
    A[23:30 nightly-dashboard 起動] --> B[0. evaluation_queue 回収<br/>未resolved全件を再評価<br/>3回失敗→ops_logs昇格+ai_insights要確認]
    B --> C[1. 状態再計算<br/>全顧客: churn / cycle_ratio / subsc_conditions / stalled]
    C --> D[2. dashboard_daily 生成<br/>月売上/着地予測/損益分岐/funnel/segment/staff_matrix<br/>→ (store_id, snapshot_date) UPSERT]
    D --> E[3. ai_insights 生成<br/>Phase1: ルールベース3行 / Phase2: Claude API]
    E --> F[4. ブリーフィング生成<br/>翌日bookings×ProposalGenerator×ScriptComposer<br/>→ dashboard_cache kind='briefing']
    F --> G[5. 夜間Scenario発火<br/>cycle_over_* / skin_improved / subsc_cond_* /<br/>pace_drop / CSI / e1_milestone]
    G --> H[ScenarioSelector 5段<br/>→ scenario_trigger_log + line_send_queue pending]
    H --> I[23:50 nightly-etl 起動]
    I --> J[匿名化変換: hash/band/style/日付化<br/>consent=false除外]
    J --> K[brain_events 冪等UPSERT<br/>+ ops_logs kind='etl' 件数記録]
    K --> L[完了。失敗区画は前回キャッシュ温存<br/>+ ops_logs kind='batch_error']
```

順序の理由: ①回収を最初に行う(その日のBE1失敗分を当日中に正す)→ ②状態再計算が ③④⑤の入力になる → ETLは全確定後(23:50)に分離起動(dashboard失敗がETLを道連れにしない)。

# 4. Scenario発火フロー(発火→承認→送信→学習)

```mermaid
flowchart LR
    subgraph 発火3系統
    A1[同期: SaveVisitRecord BE1<br/>初回/予約なし/拒否/peeling]
    A2[夜間: nightly-dashboard<br/>周期/改善/条件遷移/CSI]
    A3[月暦: monthly+calendar<br/>季節/誕生月/解約後30日/転生]
    end
    A1 --> S[ScenarioSelector]
    A2 --> S
    A3 --> S
    S --> S1[1.候補抽出 2層解決]
    S1 --> S2[2.trigger_log冪等チェック<br/>既存→即終了]
    S2 --> S3[3.fire_condition評価<br/>失敗はfalseに倒す]
    S3 --> S4[4.抑制: 7日1通/同一30日/同群14日/<br/>販売クールダウン/churn販売停止/2回却下停止/静音]
    S4 --> S5[5.priority解決→1顧客1通<br/>販売系同士の統合禁止]
    S5 --> Q[line_send_queue INSERT<br/>pending / evidence / expires=+72h]
    Q --> AP{人間承認<br/>ApproveLineSend}
    AP -- approve --> W[送信ワーカー → LINE API<br/>status=sent]
    AP -- reject --> R[scenario_outcomes<br/>was_approved=false<br/>2回却下→恒久停止]
    Q -. 72h超過 .-> EX[queue-expire 毎時<br/>status=expired]
    W --> O[scenario_outcomes INSERT]
    O --> C1[webhook: 既読/返信]
    O --> C2[outcome-confirm 日次:<br/>booking_within_14d / revenue_30d確定]
    C2 --> ETL[nightly-etl → brain_events 'dm']
    ETL --> ML[月次学習: successScore上書き<br/>+ Lv2起票]
```

# 5. 月次Brain学習フロー(毎月1日 02:00)

```mermaid
flowchart TD
    M[monthly-learning 起動] --> L1[店舗学習 scope='store' Lv2]
    L1 --> L1a[proposal_outcomes/scenario_outcomesセル集計<br/>laplace平滑化]
    L1a --> L1b{lift>=+15pt かつ n>=10}
    L1b -- yes --> L1c[Lv4 Guard検査] 
    L1c -- 通過 --> L1d[brain_revisions 起票 scope='store' proposed]
    L1c -- 違反 --> L1x[起票破棄+ops_logs guard_violation<br/>本番に痕跡を残さない]
    L1 --> L2[churn確定ラベル付け 周期×2.5<br/>+ 予測精度レポート→ai_insights]
    M --> B1[Brain学習 scope='brand' Lv3]
    B1 --> B1a[brain_events 6ヶ月をクラスタ別集計]
    B1a --> B1b[brain_benchmarks 更新<br/>sample_stores<5 → is_reference]
    B1a --> B1c[brain_params 更新候補<br/>churn重み/style_affinity/timing行列]
    B1a --> B1d{成功率+5pt かつ n>=50 かつ 2店以上}
    B1d -- yes --> B1e[brain_revisions 起票 scope='brand'<br/>test_design付き A/B必須]
    L1d --> AP1{Owner/Manager承認<br/>ApproveRevision}
    AP1 -- approve --> APL[Lv4再検査→before照合→<br/>pattern_steps書換+version+1<br/>翌朝ブリーフィングから有効]
    B1e --> AP2{本部承認}
    AP2 -- approve --> LIB[brain_pattern_library 新version<br/>superseded_byチェーン<br/>+ brain_learning_history 記録]
    LIB --> DIST[brain-distribute 月次<br/>各店 store_id=NULL行へUPSERT<br/>店舗オーバーライド行は不可侵]
    DIST --> ADOPT[店舗: 通知確認→採用/見送り選択]
    ADOPT --> LOOP[採用店の発火結果が再び<br/>outcomes→brain_eventsへ ループ閉鎖]
```

# 6. Silent Error UX(エラークラスと挙動の確定)

| クラス | 発生箇所 | 保存するもの | 捨てるもの | 誰に・いつ見せるか |
|---|---|---|---|---|
| BLOCKING | TX1のみ | なし(全ロールバック・clientRequestIdで再送可) | なし | **スタッフに即時**(唯一の例外)「保存できませんでした。もう一度タップ」+下書き保持 |
| DEGRADED | BE1各区画 | TX1確定分+evaluation_queue+ops_logs | その場の評価結果(夜間再生成) | 誰にも見せない(degraded[]はログ) |
| SILENT | 夜間/日次バッチ | 前回成功キャッシュ温存+ops_logs | 当回生成物 | UIはisStale:trueで前回分表示。管理者には翌朝ai_insightsで集約 |
| GUARD | Lv4違反/NG文面 | ops_logs(diff全文) | 起票・文面そのもの | 月次集計のみ(insightsにguard件数) |
| EXPIRE | line_send_queue 72h | expired履歴(cooldown入力) | 送信 | 承認画面から自動消滅 |

鉄則: **エラーを見るのは管理者、それも翌朝まとめて。スタッフが見るエラーはTX1失敗の1種類だけ。**

# 7. 障害時フォールバック(コンポーネント別)

| 障害 | 影響 | フォールバック | 復旧時 |
|---|---|---|---|
| BE1恒常失敗(エンジンバグ等) | 提案・churnが更新されない | TX1は通り続ける(入力は無傷)。evaluation_queue滞留→3回失敗でai_insights「要確認」 | 修正デプロイ後、夜間回収が自動消化 |
| nightly-dashboard失敗 | 翌朝ブリーフィング・KPI欠落 | dashboard_cache/dashboard_dailyは前日分温存+isStale。Scenario夜間発火はその回スキップ(翌晩に周期系は再評価されるため取りこぼし最小) | 手動再実行可(冪等UPSERT) |
| nightly-etl失敗 | brain_events欠落 | 店舗運用に影響ゼロ。差分は翌晩まとめ再送(冪等キー) | 自動 |
| monthly-learning失敗 | 起票されない | 学習が1ヶ月遅れるだけ。発火基準は現行版継続 | 翌月 or 手動再実行 |
| Brain全停止 | 配信・ベンチマーク停止 | 店舗は現行version で完全動作(不変原則1) | 再開後の月次syncで追従 |
| LINE API障害 | 送信failed | status='failed'保持→送信ワーカーが指数バックオフ3回→expires_atで自然expired | 自動 |
| 承認者不在(承認滞留) | pending滞留 | 72hでexpired(古いフォローは送らない方が正しい)。periodically ai_insightsに滞留件数表示 | — |
| Supabase障害(保存不能) | TX1失敗 | UIローカル下書き保持+clientRequestIdで復旧後再送 | 再送で冪等成立 |

# 8. 統合Mermaid図(1日の全体像)

```mermaid
flowchart TB
    subgraph DAY[日中 リアルタイム]
        V[来店・施術] --> IN[30秒入力] --> SVR[SaveVisitRecord]
        SVR --> TX1[TX1: visits/skin/bookings<br/>絶対防衛]
        TX1 --> BE1[BE1: progress/outcomes/churn/<br/>fire_log/scenario起票]
        BE1 -. 失敗 .-> EQ[(evaluation_queue)]
        BE1 --> LQ[(line_send_queue pending)]
        LQ --> HUMAN[承認: ApproveLineSend] --> SEND[LINE送信] --> SO[(scenario_outcomes)]
    end
    subgraph NIGHT[夜間]
        N1[23:30 nightly-dashboard] --> N1a[EQ回収] --> N1b[(dashboard_daily)]
        N1 --> N1c[(dashboard_cache briefing)] --> MORNING[翌朝: 今日の顧客]
        N1 --> N1d[夜間Scenario発火] --> LQ
        N2[23:50 nightly-etl] --> BEv[(brain_events 匿名化)]
    end
    subgraph MONTH[月次]
        M1[monthly-learning] --> RV[(brain_revisions proposed)]
        RV --> HUMAN2[承認: ApproveRevision<br/>Lv4再検査] --> PS[(pattern_steps 書換 version+1)]
        BEv --> M1
        M1 --> LIB[(brain_pattern_library)] --> DIST[配信: NULL行UPSERT] --> PS2[(brain_success_patterns /<br/>brain_scenarios)]
    end
    EQ --> N1a
    PS --> MORNING
    PS2 --> MORNING
    SO --> N2
    TX1 --> N2
```

---

## 9. チェックリスト(本書が定義を確定した7点)

| 項目 | 確定内容 |
|---|---|
| TX1(絶対防衛) | visits→skin_records→bookings の3書込のみ。失敗=全ロールバック・唯一ユーザーに見せるエラー |
| BE1(ベストエフォート) | progress→outcomes→churn→fire_log→scenario起票 の5区画。各区画独立try・TX1を巻き戻さない |
| evaluation_queue回収 | 夜間バッチ冒頭で全件再評価。3回失敗でops_logs昇格+ai_insights「要確認」 |
| line_send_queue生成 | 同期(BE1区画9)・夜間(発火系統B)・月暦(系統C)の3経路のみ。全てScenarioSelector経由・pending起票・人間承認 |
| dashboard_daily生成 | 23:30バッチ専管・(store_id, snapshot_date) UPSERT。リアルタイム書込禁止 |
| brain_events生成 | 23:50 nightly-etlの1箇所のみ。hash/band/style/日付化・同意false除外・冪等UPSERT |
| revision起票 | 月次バッチのみ(scope='store'/'brand')。起票前Lv4 Guard・承認時Lv4再検査の二重。反映は翌朝から |

---
*Riora Event Flow Architecture v1.0 — イベントフロー定義の唯一の正とする。*
