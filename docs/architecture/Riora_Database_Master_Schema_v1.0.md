# Riora Database Master Schema v1.0

**株式会社martylabo / Salon Riora — Riora OS 正式DB構造 確定版**
作成日: 2026-06-11
位置づけ: **本書はRiora OSのDB構造の唯一の正(Single Source of Truth)。今後のあらゆる設計書・実装と矛盾した場合、本書が優先する。Claude Code実装の基準文書。**

## 0. 旧設計との照合(本書での確定事項)

| 確定 | 内容 |
|---|---|
| 命名 | コア・パターン系テーブルは brain_ 接頭辞に統一(brain_stores, brain_customers 等)。ログ・運用・キュー系は接頭辞なし |
| 統合1 | 旧 pattern_revisions + 旧 brain_revisions(中央) → **brain_revisions** 1本に統合。scope列('store'=Lv2 / 'brand'=Lv3)で区別 |
| 統合2 | 旧 briefings → **dashboard_cache** に吸収(kind='briefing')。表示用キャッシュ系を1テーブルに集約 |
| 分離 | dashboard_daily.ai_insights JSONB → **ai_insights** 独立テーブル化(承認・指示出し・既読管理のため行単位が必要) |
| 新設 | **brain_learning_history**: Brain月次学習バッチの実行・採用・配信の監査履歴(旧brain_revisionsの履歴機能を継承) |
| 2層マスタ | brain_success_patterns / brain_scenarios はサロゲートPK(uid UUID)+UNIQUE NULLS NOT DISTINCT(code, store_id) 方式に確定(store_id NULL行を一意制約に含めるため・PG15+) |
| 追加列 | brain_staff_adjustments / evaluation_queue に store_id 追加(RLS一貫性のため) |

テーブル総数: **28**(Core 10 / Pattern 7 / Scenario 4 / Operations 4 / Brain 5)

---

# 1. ER図(全28テーブル)

## 1-1. 依存関係図

```
                          ┌──────────────┐
                          │ brain_stores │ (店舗マスタ・テナントルート)
                          └──┬───────────┘
        ┌───────────┬────────┼─────────┬──────────────┐
        ▼           ▼        ▼         ▼              ▼
  brain_staff  brain_menus  brain_customers  business_settings  dashboard_daily
        │           │        │ 1:N
        │           │        ├──────────┬──────────────┬───────────────┐
        │           │        ▼          ▼              ▼               ▼
        │           │  brain_bookings  brain_subscriptions  brain_pattern_progress  line_send_queue
        │           │        │                               │ N:1                  │ 1:0..1
        └─────┐     │        │                               ▼                      ▼
              ▼     ▼        ▼                    brain_success_patterns ◄── scenario_outcomes
            brain_visits ◄───┘ (customer/staff/menu)         │ 1:N        (scenario_uid N:1
              │ 1:1          │                               ▼             brain_scenarios)
              ▼              │                        brain_pattern_steps
        brain_skin_records   │
              │              ▼
              │   brain_proposal_outcomes ──→ brain_revisions(scope=store/brand)
              │              │
              ▼              ▼
       evaluation_queue   pattern_fire_log     scenario_trigger_log
                                                      │
   ─────────── 匿名化境界(ETLのみ通過可)───────────────┼──────────────
              ▼                                       ▼
        brain_events ──→ brain_benchmarks      brain_learning_history
              │      └──→ brain_params
              ▼
        brain_pattern_library ──(配信)──→ brain_success_patterns / brain_scenarios(NULL行)

   独立系: ops_logs(全層のログ) / dashboard_cache / ai_insights(store_id配下)
```

## 1-2. リレーション定義表(Cardinality / Cascade / Soft Delete)

カスケード原則: **全48本のFKは ON DELETE RESTRICT**(物理削除禁止原則の機械的強制)。ON UPDATE CASCADE不使用。削除は業務テーブルのdeleted_at(論理削除)のみ。

| 親 | 子 | Cardinality | FK列 | Soft Delete |
|---|---|---|---|---|
| brain_stores | brain_staff | 1:N | store_id | 子: deleted_at有 |
| brain_stores | brain_customers | 1:N | store_id | 子: deleted_at有 |
| brain_stores | brain_menus | 1:N | store_id | 子: deleted_at有 |
| brain_stores | brain_bookings / brain_subscriptions / brain_visits / brain_skin_records | 1:N | store_id | visits/bookings: deleted_at有。skin/subscriptions: 状態列で管理(削除なし) |
| brain_stores | business_settings / dashboard_daily / dashboard_cache / ai_insights | 1:N | store_id | 削除なし(上書き/世代管理) |
| brain_stores | brain_success_patterns / brain_scenarios | 1:N(NULL行=ブランド標準) | store_id NULL可 | is_active=falseで無効化(削除なし) |
| brain_stores | brain_pattern_progress / brain_proposal_outcomes / brain_revisions / pattern_fire_log / scenario_trigger_log / scenario_outcomes / line_send_queue / evaluation_queue / ops_logs(NULL可) / brain_staff_adjustments | 1:N | store_id | ログ・台帳系: 削除なし |
| brain_staff | brain_customers(担当) | 1:N | assigned_staff_id | — |
| brain_staff | brain_bookings / brain_visits / brain_proposal_outcomes / brain_staff_adjustments | 1:N | staff_id | — |
| brain_customers | brain_bookings | 1:N | customer_id | — |
| brain_customers | brain_subscriptions | 1:N(実運用は0..1アクティブ) | customer_id | — |
| brain_customers | brain_visits | 1:N | customer_id | — |
| brain_customers | brain_skin_records | 1:N | customer_id | — |
| brain_customers | brain_pattern_progress | **1:1**(UNIQUE customer_id) | customer_id | — |
| brain_customers | brain_proposal_outcomes / pattern_fire_log / scenario_trigger_log / scenario_outcomes / line_send_queue | 1:N | customer_id | — |
| brain_menus | brain_visits | 1:N | menu_id | — |
| brain_visits | brain_skin_records | **1:1**(UNIQUE visit_id) | visit_id | — |
| brain_visits | brain_proposal_outcomes | 1:N | visit_id | — |
| brain_visits | pattern_fire_log | 1:N(visit_id NULL可: 夜間評価分) | visit_id | — |
| brain_visits | evaluation_queue | 1:N | visit_id | — |
| brain_success_patterns(uid) | brain_pattern_steps | 1:N | pattern_uid | — |
| brain_success_patterns(uid) | brain_pattern_progress / brain_staff_adjustments / brain_proposal_outcomes | 1:N | pattern_uid | — |
| brain_scenarios(uid) | line_send_queue | 1:N | scenario_uid | — |
| brain_scenarios(uid) | scenario_outcomes | 1:N | scenario_uid | — |
| line_send_queue | scenario_outcomes | 1:0..1 | queue_id | — |
| (Brain層) brain_events / brain_pattern_library / brain_benchmarks / brain_params / brain_learning_history | — | FKなし(store_anon_idは論理参照) | — | 削除なし(恒久蓄積) |

Soft Delete確定リスト(deleted_at列を持つ): brain_staff / brain_customers / brain_menus / brain_bookings / brain_visits の5テーブルのみ。他は「状態列・is_active・恒久保存」で管理し、deleted_atを持たない。

---

# 2. Store Multi Tenant設計(正式定義)

| 区分 | テーブル | ルール |
|---|---|---|
| store_id **必須**(23) | brain_staff, brain_customers, brain_menus, brain_bookings, brain_subscriptions, brain_visits, brain_skin_records, business_settings, dashboard_daily, brain_pattern_progress, brain_staff_adjustments, brain_proposal_outcomes, brain_revisions(※scope='brand'行はNULL可の例外), pattern_fire_log, brain_scenarios(※NULL可の例外), brain_success_patterns(※NULL可の例外), scenario_trigger_log, scenario_outcomes, line_send_queue, evaluation_queue, ops_logs(NULL可=システム全体ログ), dashboard_cache, ai_insights | NOT NULL + FK + RLS |
| store_id **不要**(5) | brain_events, brain_pattern_library, brain_benchmarks, brain_params, brain_learning_history | 実IDを持たない。店舗参照は store_anon_id(論理参照)のみ |
| テナントルート(1)| brain_stores | 自身がstore_id |

**NULL=ブランド標準ルール**(brain_success_patterns / brain_scenarios / brain_revisions(scope='brand')の3テーブルのみ適用):

```
解決順序(実行時):
 1. store_id = 自店 の行が存在 → それを使用(店舗オーバーライド)
 2. 存在しない → store_id IS NULL の行(ブランド標準)を使用
 3. どちらも無い → 機能無効(エラーではなく非発火)

Brain配信時の動作:
 ・brain_pattern_library(approved)のdefinitionを store_id=NULL 行として
   brain_success_patterns / brain_scenarios へUPSERT(code+version一致でべき等)
 ・既存の店舗オーバーライド行there は配信で上書きしない(店舗自治の保証)
 ・店舗が[採用]を選択した場合のみ、店舗行を削除(=NULL行に復帰)or 店舗行を新定義で置換

オーバーライド優先順位(衝突時): 店舗行 > ブランドNULL行 > なし。
店舗行のversionがNULL行より古い場合、ダッシュボードに「標準より古い」警告を表示(強制更新はしない)。
```

# 3. Customer Hash設計(正式定義)

| 項目 | 定義 |
|---|---|
| 生成方式 | customer_hash = sha256( customer_id(UUID小文字文字列) ‖ brain_stores.anon_salt ) の16進64文字 |
| 生成箇所 | **nightly-etl Edge Function内のみ**。アプリケーションコード・他バッチ・UIでの生成を禁止(lint/レビューで強制) |
| 保管箇所 | brain_events.customer_hash のみ。店舗層テーブルにはhash列を持たない(持つと逆引き表が育つため) |
| salt保管 | brain_stores.anon_salt(店舗作成時に自動発行・以後UPDATE禁止をトリガで強制)。Brain層・ログ・エクスポートにsaltを出力しない |
| ETL変換箇所 | nightly-etl(23:50)の1箇所。変換と同時に: 実金額→band化 / 時刻→日付化 / staff_id→style化 / 挙式日→残日数band化 / consent=false顧客の除外 |
| アプリからの参照可否 | **店舗アプリ: 参照不可**(brain_eventsへのRLSなし=deny)。Brain Batchロールのみ読み書き可。本部分析UI(将来)はhashを表示せず集計結果のみ表示 |
| 復元可能性 | salt非公開のため実名復元不可。同一店舗内の系列追跡は可。店舗横断の名寄せは不可(salt店舗別・意図的設計) |

# 4. RLS設計(ロール×権限マトリクス)

ロール定義: Owner=店舗オーナー(岸/鈴木相当・承認権) / Manager=運営管理者(久保田さん・全操作+設定) / Staff=施術スタッフ(入力と閲覧) / Service Role=店舗側バッチ(Edge Functions) / Brain Batch=中央学習バッチ。

| テーブル群 | Owner | Manager | Staff | Service Role | Brain Batch |
|---|---|---|---|---|---|
| brain_stores(自店行) | R | R/U(設定列のみ) | R(name等のみ) | R | R(anon_id/cluster のみ) |
| コア業務(customers/visits/skin/bookings/subscriptions/menus/staff) | R/U/論理D | R/C/U/論理D | R/C/U(自分の担当来店の入力) | R/C/U | — |
| business_settings | R/C/U | R/C/U | — | R | — |
| dashboard_daily / dashboard_cache / ai_insights | R | R / ai_insightsはU(既読・指示) | R(briefingのみ: 自分の当日分) | C/U(バッチが生成) | — |
| brain_success_patterns / brain_pattern_steps / brain_scenarios | R | R/U(店舗オーバーライド行のみC/U) | R(base_script閲覧) | R | C/U(**NULL行のみ**・配信) |
| brain_pattern_progress / proposal_outcomes / pattern_fire_log / scenario_trigger_log / scenario_outcomes | R | R | R(自担当分) | C/U | — |
| brain_staff_adjustments | R | R/C/U | R(自分の行のみR) | R/U(自動更新候補) | — |
| brain_revisions | R/U(**approve/reject権限はOwner+Managerのみ**) | R/U(承認) | — | C(起票のみ・Lv4 Guard通過必須) | C(scope='brand'起票) |
| line_send_queue | R/U(承認・却下) | R/U(承認・却下) | R(自担当顧客分) | C/U(起票・送信結果) | — |
| evaluation_queue / ops_logs | R | R/U(resolved) | — | C/U | C(ops_logsのみ) |
| brain_events | — | — | — | C(ETL書込のみ・R不可) | R/C |
| brain_pattern_library / brain_benchmarks / brain_params | R(approved/自クラスタのみ) | R(同) | — | R | R/C/U |
| brain_learning_history | R | R | — | — | C |

削除権限: **全ロールで物理DELETE禁止**(FK RESTRICT+DELETEポリシー不付与で強制)。論理削除(deleted_at更新)はManager/Ownerのみ。

実装ポリシー本数(チェックサム対象): 店舗分離ALLポリシー23本 + brain_stores自店行1本 + brain_pattern_steps親JOIN1本 + 2層マスタNULL行読取2本 + Brain層店舗読取3本 = **RLSポリシー30本**(Brain Batch/Service Roleはservice_roleキーでRLSバイパス・関数内store_id明示フィルタを規約とする)。

# 5. API接続前提(CRUDマトリクス)

凡例: C=Create R=Read U=Update D=論理Delete。次工程のAPI設計(エンドポイント命名)の基準。

| テーブル | 主要操作(API動詞) |
|---|---|
| brain_customers | C(初回カウンセリング登録) / R(GET Customer, GET Customer Context Bundle※visits+skin+progress一括) / U(タイプ確定・goal_note・birth_month・同意) / D |
| brain_visits | **C(SaveVisitRecord — 中核RPC: visits+skin+bookings+エンジン同期実行)** / R(GET Visit History) / U(音声メモ構造化結果の追記のみ) / D |
| brain_skin_records | C(SaveVisitRecord内包) / R(GET Skin Trend) |
| brain_bookings | C / R(GET Today, GET Upcoming) / U(status遷移) / D |
| brain_subscriptions | C(Subscribe) / R / U(Cancel: cancelled_at+reason) |
| brain_menus / brain_staff | R中心 / C・UはManagerのみ |
| business_settings | C/U(月次設定) / R |
| brain_success_patterns・steps | R(GET Active Patterns) / U(revision apply経由のみ — 直接UPDATE API禁止) |
| brain_pattern_progress | R(GET Progress) / **U(UPDATE Progress — SaveVisitRecord内部のみ。外部API公開しない)** |
| brain_proposal_outcomes | C(SaveVisitRecord内包+briefing消込) / R(GET Outcome Stats: セル集計) |
| brain_staff_adjustments | R / U(Manager+revision経由) |
| brain_revisions | C(システム起票) / R(GET Pending Revisions) / U(**Approve Revision / Reject Revision** — applyを含む) |
| pattern_fire_log / scenario_trigger_log | C(システム) / R(GET Fire Trace: デバッグ・監査) |
| brain_scenarios | R(GET Scenarios) / U(店舗オーバーライドC/U: Manager) |
| line_send_queue | C(Selector起票) / R(GET Pending Queue) / U(**Approve Send / Reject Send** / sent・expired遷移) |
| scenario_outcomes | C(送信時) / U(14日後転換確定バッチ) / R(GET Scenario Stats) |
| dashboard_daily / dashboard_cache | R(GET Dashboard, GET Briefing) / C・Uはバッチのみ |
| ai_insights | R(GET Insights) / U(既読・[指示を出す]→ツンくま下書き生成) |
| evaluation_queue / ops_logs | C(システム) / R / U(resolved) |
| brain_events | C(ETLのみ) / R(Brain Batchのみ) |
| brain_pattern_library / brain_params / brain_benchmarks | R(GET Brand Standard, GET Benchmarks) / C・UはBrain Batchのみ |
| brain_learning_history | C(Brain Batch) / R(GET Learning History) |

API設計原則(次工程への申し送り): ①書込の正面玄関は SaveVisitRecord・Approve Revision・Approve Send の3つに集約 ②progress/outcomes/logへの直接書込APIは作らない(整合性はエンジン経由のみ) ③GETは dashboard_cache/dashboard_daily 優先(実テーブル直接集計APIは作らない)。

# 6. データフロー図(来店→店舗配信・1本化)

```
[来店] 顧客来店・施術
   ↓ お見送り直後30秒入力
[SaveVisitRecord] brain_visits + brain_skin_records + brain_bookings 書込
   ↓ 同一トランザクション内(失敗時はevaluation_queueへ退避)
[Pattern Engine] PatternContext再構築 → brain_pattern_progress 前進/停滞判定
   ↓
[Proposal] ProposalGenerator: ハードゲート(subsc4条件/churn)→cooldown→fire_condition評価
   │         → 翌朝分は dashboard_cache(kind='briefing') へ / 全判定を pattern_fire_log へ
   │         → DM側は ScenarioSelector → scenario_trigger_log → line_send_queue(承認制)
   ↓ 施術実行・翌来店の入力トグルで確定
[Outcome] brain_proposal_outcomes / scenario_outcomes(was_executed・was_accepted・14日転換)
   ↓ 月次集計(monthly-learning): セル成功率・lift検定
[Revision] brain_revisions 起票(scope='store'=Lv2) → Lv4 Guard → Owner/Manager承認
   │         → brain_pattern_steps 書換+version+1(店舗内学習の完結)
   ↓ nightly-etl(匿名化境界通過: hash化・band化・style化)
[Brain] brain_events 蓄積 → 月次Brain学習: クラスタ別集計・A/B設計
   │         → brain_revisions(scope='brand'=Lv3)起票 → 本部承認 → brain_learning_history 記録
   ↓
[Pattern Library] brain_pattern_library 新version発行(superseded_byチェーン)
   ↓ 月次sync
[店舗配信] brain_success_patterns / brain_scenarios の store_id=NULL 行へUPSERT
            → 各店は[採用/見送り]選択 → 採用店舗の翌朝ブリーフィングから新基準で発火
            → その結果が再び [Outcome] へ(ループ閉鎖)
```

# 7. Migration Wave確定(W1〜W7)

| Wave | 作成テーブル | 依存 | Rollback順 |
|---|---|---|---|
| W1 | brain_stores, brain_staff, brain_customers, brain_menus, brain_bookings, brain_subscriptions, brain_visits, brain_skin_records, business_settings | — | 7番目(最後) |
| W2 | brain_success_patterns, brain_pattern_steps, brain_pattern_progress, brain_staff_adjustments | W1 | 6番目 |
| W3 | brain_proposal_outcomes, brain_revisions, pattern_fire_log, evaluation_queue | W1, W2 | 5番目 |
| W4 | brain_scenarios, line_send_queue, scenario_trigger_log, scenario_outcomes | W1(W3と並行可・ただし番号順に適用) | 4番目 |
| W5 | dashboard_daily, dashboard_cache, ai_insights, ops_logs | W1–W4 | 3番目 |
| W6 | brain_events, brain_pattern_library, brain_benchmarks, brain_params, brain_learning_history | W1(論理独立・物理同居、Phase3で別プロジェクト分離) | 2番目 |
| W7 | RLS全30ポリシー+INDEX 10本+シード(新富町店・スタッフ3・メニュー5・8パターン全steps・60シナリオ・business_settings 6月) | W1–W6 | 1番目(最初に剥がす) |

規律: ①各WaveはUP/DOWN両方向のスクリプトを持ち、Rollbackは W7→W6→W5→W4→W3→W2→W1 の逆順厳守 ②Wave跨ぎのALTERは新Wave番号で発行(過去ファイル改変禁止) ③本書未記載のテーブル追加はMaster Schema改版(v1.1)を先に行うこと。

# 8. 検証チェックサム(構成ドリフト検知用)

| 項目 | 値 | 内訳 |
|---|---|---|
| テーブル数 | **28** | Core10 / Pattern7 / Scenario4 / Operations4 / Brain5 |
| FK数 | **48** | 全て ON DELETE RESTRICT。Brain層5テーブルはFKゼロ(論理参照のみ) |
| UNIQUE制約数(PK除く) | **11** | stores.anon_id / skin.visit_id / patterns(code,store_id) / steps(pattern_uid,step_no) / progress(customer_id) / scenarios(code,store_id) / trigger_log4列冪等 / queue(customer,scenario_code,scheduled_date) / brain_events5列冪等 / dashboard_cache(store,date,kind,ref) / ai_insights(store,date,slot) |
| INDEX数(UNIQUE除く・明示定義) | **10** | visits×2 / proposal_outcomes / scenario_outcomes×2 / brain_events / bookings / fire_log / send_queue / ops_logs |
| RLSポリシー数 | **30** | 店舗分離23 + stores自店行1 + steps親JOIN1 + 2層マスタNULL行読取2 + Brain層店舗読取3 |
| soft delete対象 | **5** | staff / customers / menus / bookings / visits |
| 2層マスタ(NULL=標準) | **2** | brain_success_patterns / brain_scenarios(+brain_revisionsのscope='brand'行) |
| version固定列 | **2** | pattern_progress.pattern_version / scenario_outcomes.scenario_version |
| 冪等UNIQUE | **3** | brain_events / scenario_trigger_log / line_send_queue |

運用: Claude Code実装完了時に information_schema からこの9項目を機械集計し、本表と突合するCIチェック(schema-checksum)をW7に含めること。差分検出時はマージ禁止・Master Schema改版を先行する。

---
*Riora Database Master Schema v1.0 — 以上を唯一の正とする。*
