# Riora Brain 実装タスク分解書 v1(Claude Code用)

**前提: Riora Brain 実装仕様書 v1 / UI変更は一切禁止・ロジック層のみ**
作成日: 2026-06-11
対象リポジトリ: 既存 Riora OS(Next.js / TypeScript / Supabase / Zustand)

> 仕様書のStep3(UI接続)はUIロックのため本書から除外し、ロジック層のみで
> Step1=データ基盤 / Step2=エンジン層 / Step3=バッチ・学習・ETL層 に再分解する。
> 既存UIコンポーネント・既存画面・既存ルーティングへの変更はゼロであること。
> 既存ファイルの変更は「変更許可ファイル」に明記したもののみ。

---

# 全体ディレクトリ構成(新規追加分)

```
src/
  engines/                      ← 全て新規・pure function(Supabase非依存)
    classifier/
      CustomerClassifier.ts
      classifier.rules.ts
    pattern/
      ConditionEngine.ts
      PatternContextBuilder.ts
      PatternProgressService.ts
      StaffAdjustmentResolver.ts
      Lv4Validator.ts
    scoring/
      VisitScoreCalculator.ts
      CustomerSuccessIndex.ts
      ProposalSuccessRate.ts
    churn/
      ChurnPredictorV1.ts
    briefing/
      BriefingGenerator.ts
      ScriptComposer.ts
  services/                     ← Supabaseアダプタ層(engines と DB の接続)
    visitService.ts             (saveVisitRecord トランザクション)
    patternRepository.ts
    customerRepository.ts
    revisionService.ts
    etlService.ts
  types/
    riora.types.ts              ← 全ドメイン型(単一ファイルで管理)
    brain.types.ts
supabase/
  migrations/
    20260612000001_core_tables.sql
    20260612000002_pattern_tables.sql
    20260612000003_learning_tables.sql
    20260612000004_brain_tables.sql
    20260612000005_rls_policies.sql
    20260612000006_seed_master.sql
    20260612000007_seed_patterns.sql
  functions/
    nightly-dashboard/index.ts
    nightly-etl/index.ts
    monthly-learning/index.ts
    after-visit-learning/index.ts
tests/
  engines/        (ユニット)
  scenarios/      (8パターン×顧客シナリオ統合テスト)
  fixtures/       (合成データ生成)
    syntheticData.ts
```

変更許可ファイル(既存):
- `src/engines/SuccessCloneEngine.ts` — 新DB構造の読取側に改修+`extractSuccessActions()` のexport欠落解消(Phase2本実装まではスタブで型だけ確定)
- `package.json` — `json-logic-js`, `@types/json-logic-js` 追加のみ
- それ以外の既存ファイルは**読み取り参照のみ可・編集禁止**

---

# Step 1: データ基盤

## 1-A. DBテーブル(migration分割)

### 20260612000001_core_tables.sql
| テーブル | 要点 |
|---|---|
| stores | anon_id UNIQUE / anon_salt(生成時に `encode(gen_random_bytes(16),'hex')`) / cluster / price_tier / brain_subscription / learning_mode |
| staff | id, store_id FK, name, style CHECK ('evidence','theory','empathy'), is_active |
| customers | 仕様書2-2の全カラム。CHECK: customer_type IN ('A_acne','B_pore','C_sensitive','D_aging','E_bridal') / churn_score 0–1 |
| menus | id, store_id FK, name, price, role CHECK ('entry','pore','sensitive','peeling','lifting'), target_types TEXT[] |
| bookings | id, store_id, customer_id FK, staff_id FK, booking_date, source CHECK ('in_salon','line','hotpepper','web'), status CHECK ('active','done','cancelled','noshow') |
| subscriptions | id, store_id, customer_id FK, plan_name, monthly_price, started_at, cancelled_at, cancel_reason CHECK ('no_effect','price','distance','other') |
| visits | 仕様書2-3全カラム+CHECK(no_booking_reason IN ('considering','unsure','cold'))。INDEX 2本 |
| skin_records | 仕様書2-4全カラム。visit_id UNIQUE。レベル列は CHECK 0–5 |
| business_settings | (store_id, month) 複合PK, sales_target, fixed_costs, variable_cost_rate |

共通: 全テーブル `created_at TIMESTAMPTZ DEFAULT now()`、店舗系は `deleted_at TIMESTAMPTZ`。

### 20260612000002_pattern_tables.sql
| テーブル | 要点 |
|---|---|
| success_patterns | id TEXT PK / store_id FK(NULL=ブランド標準) / customer_type / label / entry_condition JSONB / target_cycle_days / version / is_active / origin CHECK ('manual','ai_discovered','brain_install') / approved_by |
| pattern_steps | UUID PK / pattern_id FK / step_no / label / proposal_kind CHECK ('homecare','rebooking','subscription','upsell','pack','none') / menu_role / fire_condition JSONB / base_script TEXT / cooldown_visits INT DEFAULT 2 / UNIQUE(pattern_id, step_no) |
| pattern_progress | 仕様書2-5全カラム。UNIQUE(customer_id) |
| staff_adjustments | (staff_id, pattern_id, proposal_kind) 複合PK / timing_offset INT / script_style |

### 20260612000003_learning_tables.sql
| テーブル | 要点 |
|---|---|
| proposal_outcomes | 仕様書2-6全カラム。INDEX (store_id, customer_type, proposal_kind, visit_count_at) |
| pattern_revisions | id UUID / store_id / pattern_id / change_type CHECK ('timing','condition','script','new_pattern','churn_weights','staff_adjustment') / before JSONB NOT NULL / after JSONB NOT NULL / evidence JSONB NOT NULL / status CHECK ('proposed','approved','rejected','auto_applied') DEFAULT 'proposed' / decided_by / decided_at |
| dashboard_daily | 仕様書2-7全カラム。PK (store_id, snapshot_date) |
| line_send_queue | 既存テーブルが存在する前提。なければ: id, store_id, customer_id, message_draft, trigger_type, status('pending','approved','sent','rejected') |
| evaluation_queue | id, visit_id FK, reason TEXT, resolved BOOLEAN DEFAULT false — saveVisitRecordでエンジン失敗時の再評価キュー |

### 20260612000004_brain_tables.sql
| テーブル | 要点 |
|---|---|
| brain_events | 仕様書2-8全カラム。UNIQUE(store_anon_id, customer_hash, event_type, occurred_on, visit_count_at) ← 冪等キー |
| brain_pattern_library | 仕様書2-9全カラム |
| brain_benchmarks | (week, store_cluster, metric, customer_type) 複合PK / p25 p50 p75 NUMERIC / sample_stores INT / is_reference BOOLEAN(1店舗集中フラグ) |
| brain_params | (key, cluster, version) 複合PK / value JSONB |
| brain_revisions | brain_revisions仕様書通り+Lv4ブロックはDBではなくLv4Validatorで実施(コメント明記) |

### 20260612000005_rls_policies.sql
- 店舗系全テーブル: `USING (store_id = current_setting('app.store_id', true)::uuid)` のSELECT/INSERT/UPDATEポリシー
- brain_* テーブル: service_role のみ書込可。店舗ロールは brain_pattern_library(status='approved')・brain_benchmarks・brain_params のSELECTのみ
- 注意: Edge Functionは service_role で動作し RLS をバイパスする(関数内で store_id を明示フィルタすること)

### 20260612000006_seed_master.sql
- stores 1件: 新富店(cluster='office_area', price_tier='standard', learning_mode=false ※1号店は自店学習が正)
- staff 3件: 鈴木/evidence、亀山/theory、外舘/empathy
- menus 5件: ヒト幹15000/entry、毛穴洗浄+ヒト幹19000/pore、水素+ヒト幹18000/sensitive、ハーブピーリング9900/peeling、EMS+小顔19000/lifting(target_types込み)
- business_settings 2026-06: sales_target=2500000, fixed_costs=NULL, variable_cost_rate=0.14

### 20260612000007_seed_patterns.sql
- success_patterns 8件(A1,A2,B1,B2,C1,D1,D2,E1)+pattern_steps 全段階
- fire_condition は成功パターンv2.0 ⑤のJSON Logicをそのまま使用。代表3例の正:
  - サブスク提案(B1 step4): `{"and":[{">=":[{"var":"visit_count"},4]},{">=":[{"var":"subsc_conditions_met"},4]},{"==":[{"var":"homecare_declined_recent"},false]},{"<":[{"var":"churn_score"},0.5]}]}`
  - HC提案(C1 step3): `{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"skin_improved"},true]},{"==":[{"var":"homecare_declined_recent"},false]}]}`
  - E1逆算: `{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},90]}]}`
- base_script は成功パターンv2.0 ⑥の文面を投入
- staff_adjustments 初期値: 亀山×(A1,A2,C1)×homecare timing_offset=+1 / 外舘×全パターン×homecare timing_offset=+1 / 外舘×C1×subscription script_style='empathy'

## 1-B. TypeScript型定義(src/types/riora.types.ts)

```typescript
// === 基本enum(DB CHECKと完全一致させる。Claude Codeはこの定義を唯一の正とする) ===
export type CustomerType = 'A_acne' | 'B_pore' | 'C_sensitive' | 'D_aging' | 'E_bridal';
export type StaffStyle = 'evidence' | 'theory' | 'empathy';
export type ProposalKind = 'homecare' | 'rebooking' | 'subscription' | 'upsell' | 'pack' | 'none';
export type MenuRole = 'entry' | 'pore' | 'sensitive' | 'peeling' | 'lifting';
export type NoBookingReason = 'considering' | 'unsure' | 'cold';
export type RevisionStatus = 'proposed' | 'approved' | 'rejected' | 'auto_applied';
export type PatternOrigin = 'manual' | 'ai_discovered' | 'brain_install';

// === Row型(テーブルと1:1。Supabase生成型があればextendsで整合) ===
export interface Store { id: string; name: string; anonId: string; anonSalt: string;
  cluster: string; priceTier: string; brainSubscription: boolean; learningMode: boolean; }
export interface Customer { id: string; storeId: string; name: string; ageGroup: string | null;
  customerType: CustomerType | null; typeConfidence: number; goalNote: string | null;
  weddingDate: string | null; acquisitionChannel: string | null; firstVisitDate: string | null;
  assignedStaffId: string | null; isSubscriber: boolean; subscribedAt: string | null;
  churnScore: number; churnReason: string | null; consentAnonymizedLearning: boolean; }
export interface Visit { id: string; storeId: string; customerId: string; staffId: string;
  menuId: string; visitDate: string; visitCountAt: number; isNomination: boolean;
  treatmentAmount: number; retailAmount: number; retailCategory: string | null;
  homecarePurchased: boolean; homecareDeclined: boolean; nextBookingMade: boolean;
  noBookingReason: NoBookingReason | null; voiceMemoUrl: string | null; visitScore: number; }
export interface SkinRecord { id: string; customerId: string; visitId: string;
  acneLevel: number | null; poreLevel: number | null; drynessLevel: number | null;
  rednessLevel: number | null; saggingLevel: number | null; dullnessLevel: number | null;
  firmnessLevel: number | null; primaryDelta: number | null; }
export interface SuccessPattern { id: string; storeId: string | null; customerType: CustomerType;
  label: string; entryCondition: JsonLogicRule; targetCycleDays: number; version: number;
  isActive: boolean; origin: PatternOrigin; }
export interface PatternStep { id: string; patternId: string; stepNo: number; label: string;
  proposalKind: ProposalKind; menuRole: MenuRole | null; fireCondition: JsonLogicRule;
  baseScript: string; cooldownVisits: number; }
export interface PatternProgress { customerId: string; patternId: string; patternVersion: number;
  currentStep: number; enteredAt: string; stepAdvancedAt: string | null;
  stalledFlag: boolean; completed: boolean; abandonedReason: string | null; }
export interface ProposalOutcome { id: string; storeId: string; customerId: string; visitId: string;
  staffId: string; patternId: string; stepNo: number; proposalKind: ProposalKind;
  visitCountAt: number; wasBriefed: boolean; wasExecuted: boolean; wasAccepted: boolean;
  amount: number; customerType: CustomerType; staffStyle: StaffStyle; }

// === エンジン入出力型 ===
export type JsonLogicRule = Record<string, unknown>;
export interface PatternContext { visitCount: number; daysSinceLast: number; avgCycle: number;
  isNominationStreak2: boolean; homecarePurchasedEver: boolean; homecareDeclinedRecent: boolean;
  skinImproved: boolean; skinStagnant2: boolean; subscConditionsMet: 0|1|2|3|4;
  churnScore: number; nextBookingMadeLast: boolean; weddingDaysLeft: number | null;
  retailTotal: number; }
export interface IntakeForm { concerns: string[]; weddingPlanned: boolean; weddingDate?: string;
  currentHomecare: string; channel: string; goalNote?: string; consent: boolean; }
export interface ClassificationResult { type: CustomerType; confidence: number; }
export interface ChurnResult { score: number; level: 'safe'|'warning'|'danger';
  reason: string | null; recommendedAction: string | null; }
export interface FiredProposal { customerId: string; patternId: string; stepNo: number;
  proposalKind: ProposalKind; baseScript: string; adjustedScript: string;
  priority: number; isMandatory: boolean; }
export interface Briefing { customerId: string; customerName: string; type: CustomerType;
  patternLabel: string; patternStep: string; todayGoal: string; talkHint: string;
  avoidNote: string | null; successReference: string | null; proposals: FiredProposal[]; }
export interface VisitInput { /* saveVisitRecordの引数。入力設計v1.0 ⑩と一致 */
  customerId: string; staffId: string; menuId: string; isNomination: boolean;
  retailAmount?: number; retailCategory?: string; homecarePurchased: boolean;
  homecareDeclined?: boolean; nextBookingMade: boolean; noBookingReason?: NoBookingReason;
  nextDate?: string; nextStaffId?: string; voiceMemoUrl?: string;
  skinLevels: Partial<Record<'acne'|'pore'|'dryness'|'redness'|'sagging'|'dullness'|'firmness', number>>; }
```

brain.types.ts: BrainEvent / BrainEventPayload(event_type別union)/ BrainPatternLibraryEntry / Benchmark / BrainParams / RevisionProposal を仕様書2-8, 2-9, 5章から定義。

## 1-C. Step1テスト項目

| # | テスト | 合格条件 |
|---|---|---|
| T1-1 | migration全適用→ロールバック→再適用 | エラーなし・冪等 |
| T1-2 | 既存アプリ起動 | 無変更で起動・既存テスト全パス(新テーブル未参照) |
| T1-3 | RLS検証 | app.store_id未設定セッションで店舗系テーブルが0件/別store_idで他店データ不可視 |
| T1-4 | CHECK制約 | customer_type不正値・skin_level=6・churn_score=1.5 の挿入が全て失敗 |
| T1-5 | シード検証 | 8パターン全stepのfire_conditionがjson-logic-jsでパース可能(構文テスト) |
| T1-6 | brain_events冪等キー | 同一キー2回INSERTで2件目がconflict |

---

# Step 2: エンジン層(pure function + サービス)

設計規約: engines/ 配下はSupabase import禁止(引数でデータを受け取るpure function)。DB入出力は services/ のみ。これによりテストがDBなしで回る。

## 2-A. 作成ファイルと責務・シグネチャ

| ファイル | 主要export | 仕様参照 |
|---|---|---|
| classifier/CustomerClassifier.ts | `classifyCustomer(intake: IntakeForm): ClassificationResult` | 設計v1.0 1-2。E優先→重みスコア。confidence = top/total |
| classifier/classifier.rules.ts | 悩みワード→タイプ重み表(定数)。brain_params('classifier_rules')で将来上書き可能な形 | |
| pattern/PatternContextBuilder.ts | `buildContext(customer, visits, skins, subs): PatternContext` | 仕様書⑤。subscConditionsMet算出: ①初回primary_delta<=-1 or 初回visit_score>=50 ②homecarePurchasedEver ③isNominationStreak2 ④goalNote非NULL かつ currentStep>=3 |
| pattern/ConditionEngine.ts | `evaluate(rule: JsonLogicRule, ctx: PatternContext): boolean` / `validateRule(rule): string[]`(未知変数検出) | json-logic-js。ctxキーをsnake_case変換して評価(DB内ルールはsnake_case) |
| pattern/PatternProgressService.ts | `assignPattern(customer, ctx): patternId`(entry_condition評価+タイプ別デフォルト) / `advance(progress, ctx, steps): {progress, firedSteps}` / `detectStall(progress, ctx): boolean` | 停滞: daysSinceLast > avgCycle*2 or skinStagnant2 |
| pattern/StaffAdjustmentResolver.ts | `resolve(step, staff, adjustments): {effectiveVisitCount, scriptStyle}` | timing_offset適用。offset適用後のfire_condition中のvisit_count閾値を加算変換 |
| pattern/Lv4Validator.ts | `validateRevision(rev: RevisionProposal): {ok: boolean; violations: string[]}` | 仕様書6章のブロック5条件。before/after JSONB diffを検査 |
| scoring/VisitScoreCalculator.ts | `calc(visit, skin, customerType, isFirstVisit): number` | 仕様書3-2。タイプC重み入替・初回正規化・declined非減点 |
| scoring/CustomerSuccessIndex.ts | `calc(ctx, isSubscriber): number` | 仕様書3-3 |
| scoring/ProposalSuccessRate.ts | `rate(accepted: number, executed: number): {value, sufficient}` | (a+1)/(e+3)、sufficient = e>=10 |
| churn/ChurnPredictorV1.ts | `predict(visits): ChurnResult` | 設計v1.0 1-5。初回客14日ルール込み |
| briefing/ScriptComposer.ts | `compose(baseScript, style, vars): string` | style別の語り出しテンプレ(evidence=数値先行/theory=機序先行/empathy=共感先行)+変数差込({candidate_date}等)。NGワード検査(既存NG辞書をimport) |
| briefing/BriefingGenerator.ts | `generate(customer, ctx, firedProposals, staff): Briefing` | 優先順位: 離脱対応>rebooking>subscription>homecare>upsell。最大2提案。亀山はisMandatory1件のみtrue |
| services/visitService.ts | `saveVisitRecord(input: VisitInput): Promise<SaveResult>` | 下記2-B |
| services/patternRepository.ts | success_patterns/pattern_steps/pattern_progress/proposal_outcomes のCRUD | |
| services/customerRepository.ts | 顧客+来店+肌記録のcontext用一括取得(1クエリJOIN) | |
| services/revisionService.ts | `propose(rev)`: Lv4Validator通過後にINSERT / `approve(id, by)` / `apply(rev)`: pattern_steps書換+version+1 | |

## 2-B. saveVisitRecord 処理仕様(visitService.ts)

```
入力: VisitInput
処理(1 RPC = Postgres function化を推奨。不可ならクライアント側トランザクション):
 1. visit_count_at 計算(過去visits数+1)
 2. visits INSERT(visit_score は VisitScoreCalculator で計算済みの値)
 3. skin_records INSERT(primary_delta = タイプ主要指標の初回値との差)
 4. nextBookingMade && nextDate → bookings INSERT
 5. 以降は失敗しても 1–4 をロールバックしない(エンジンブロック):
    try {
      ctx再構築 → PatternProgressService.advance
      → pattern_progress UPDATE
      → 発火stepのproposal_outcomes INSERT
        (was_executed/was_acceptedマッピング: homecare→declinedならexecuted=true/accepted=false、
         purchasedならtrue/true。rebooking→nextBookingMadeで判定。
         前夜ブリーフィングに載っていた提案は was_briefed=true で消込)
      → ChurnPredictorV1 → customers.churn_score UPDATE
    } catch (e) { evaluation_queue INSERT(visit_id, reason) }
出力: { visitId, firedProposals(次回向け), churnLevel }
```

## 2-C. Step2テスト項目(tests/engines/ + tests/scenarios/)

| # | テスト | 合格条件 |
|---|---|---|
| T2-1 | CustomerClassifier 12ケース(各タイプ2+境界: ブライダル優先/同点/悩みゼロ) | 期待タイプ・confidence範囲一致 |
| T2-2 | ConditionEngine: seed全fire_conditionを代表ctx5種で評価 | 真偽が成功パターンv2.0 ③マトリクスと一致 |
| T2-3 | VisitScore境界: 通常満点100/初回正規化/タイプC重み入替/declined非減点 | 数値完全一致 |
| T2-4 | ChurnV1: 初回14日/周期1.0未満/1.5/2.5の4ケース | level遷移が設計通り |
| T2-5 | Lv4Validator: cooldown減少・上限増加・条件削除・PIIフィールド追加・NG辞書削除の5起票 | 全てreject+violation文字列 |
| T2-6 | StaffAdjustmentResolver: 外舘×C1×homecare | 発火が3回目→4回目にずれる |
| T2-7 | **シナリオ統合テスト(最重要)**: 8パターン×代表顧客の来店シーケンスを初回→完了まで流す(例: B1顧客の4来店でstep1→4前進、2回目にHC発火、4回目にサブスク発火、C1は3回目までHC非発火) | 各来店の発火提案リストが期待値と完全一致 |
| T2-8 | サブスクブロック: 条件3/4の顧客にsubscription非発火 | 発火ゼロ |
| T2-9 | cooldown: HC拒否→次2来店で同提案非発火→3来店目で再発火 | 〃 |
| T2-10 | saveVisitRecordエンジン例外: PatternProgressServiceをモックで例外化 | visits保存成功+evaluation_queue 1件 |

---

# Step 3: バッチ・学習・ETL層(Edge Functions + Cron)

## 3-A. Edge Functions

### supabase/functions/after-visit-learning/index.ts
- トリガ: visitService から invoke(非同期)。役割: 音声メモがあれば既存InsightGeneratorで構造化しvisitsへ反映、evaluation_queue再評価
- 入力: { visitId } / 冪等

### supabase/functions/nightly-dashboard/index.ts(23:30)
```
全storesループ(store_id明示フィルタ・service_role):
 1. dashboard_daily upsert:
    月売上集計 / 着地予測 = 実績+確定予約見込+直近4週同曜日平均×残日数 /
    breakeven = business_settings.fixed_costs ÷ (1−variable_cost_rate)(fixed_costsがNULLなら両gap項NULL) /
    repeat_rate_90d(初回客コホート) / rebooking・homecare率 / segment_matrix / funnel / staff_matrix
 2. churn一括再計算 → churn_score>0.7 かつ line_send_queue未起票 → pending起票(message_draftは
    churn_reason別テンプレ。送信はしない=承認フロー維持)
 3. 翌日bookingsの顧客ごとに BriefingGenerator 実行 → briefings テーブル(新設:
    store_id, briefing_date, customer_id, payload JSONB, PK(store_id,briefing_date,customer_id))へupsert
    ※UI接続は安定化後。本StepではJSONが正しく生成されることまで
 4. ai_insights: Phase1はルールベース3行(前月比変化率TOP3を定型文生成)。Claude API接続はPhase2
失敗時: 前日dashboard_daily温存・エラーをログテーブルへ
```

### supabase/functions/nightly-etl/index.ts(23:50)
```
当日変更分(visits/proposal_outcomes/subscriptions/customers.churn確定)を抽出:
 1. consent_anonymized_learning=false の顧客を除外
 2. customer_hash = sha256(customer_id + store.anon_salt)
 3. 金額→band変換 / 時刻除去 / staff_id→style変換 / wedding_date→残日数band
 4. brain_events へ冪等upsert(ON CONFLICT DO NOTHING)
 5. 送信件数・除外件数をetl_logへ記録
```

### supabase/functions/monthly-learning/index.ts(毎月1日 02:00)
```
店舗学習(Lv2起票):
 1. proposal_outcomesをセル(type×kind×visit_count_at×staff_style)集計
 2. 現行タイミング vs 代替タイミングで success_rate差 >= +15pt かつ executed >= 10
    → pattern_revisions 起票(change_type='timing', evidence={cells, n, rates})
    → 起票前に必ずLv4Validator通過
 3. churn確定ラベル付け(周期×2.5超過+予約なし → customers.churn_reason確定)
 4. churn予測精度レポート(前月score>0.7群の実離脱率)をdashboard_daily.ai_insightsへ追記
Brain学習(Phase1は集計のみ・revisions起票はPhase3):
 5. brain_benchmarks 週次分の月次再計算(sample_stores<5 → is_reference=true)
```

## 3-B. Cron設定(supabase/migrations内 or ダッシュボード設定をREADME化)

| Job | スケジュール(JST) | 関数 |
|---|---|---|
| nightly-dashboard | 30 23 * * * | nightly-dashboard |
| nightly-etl | 50 23 * * * | nightly-etl |
| monthly-learning | 0 2 1 * * | monthly-learning |

pg_cronはUTC設定のため、JST指定をUTC変換してmigrationに記載すること(23:30 JST = 14:30 UTC)。

## 3-C. 追加migration(Step3で発生)

- 20260612000008_briefings_and_logs.sql: briefings / etl_log / batch_error_log / evaluation_queue(Step1で未作成なら)

## 3-D. Step3テスト項目

| # | テスト | 合格条件 |
|---|---|---|
| T3-1 | 合成データ生成(fixtures/syntheticData.ts): 顧客30名(タイプ分布 A6/B8/C6/D6/E4)・来店120件・サブスク3件・離脱5件を決定論的シードで生成 | 再現可能 |
| T3-2 | nightly-dashboard実行 | dashboard_daily 1行生成・全数値が手計算期待値と一致(売上・率・funnel) |
| T3-3 | ブリーフィング生成 | 翌日予約5件分のBriefing JSONが生成され、C型顧客にHC提案が3回目未満で含まれない |
| T3-4 | churn起票 | score>0.7の合成顧客のみline_send_queueにpending起票・二重起票なし |
| T3-5 | nightly-etl | brain_events件数=対象イベント数−同意false顧客分。実名・実金額・時刻・スタッフ名が1件も含まれない(全行スキャン検証) |
| T3-6 | ETL二重実行 | 2回目実行で増分ゼロ |
| T3-7 | monthly-learning | 合成データ(B型HC: 2回目成約8/10、4回目成約2/10を仕込む)でtiming revisionが1件proposed起票・evidence数値正 |
| T3-8 | Lv4経由確認 | cooldown短縮を返すよう集計を改変したモックでrevision起票がブロックされる |
| T3-9 | バッチ障害 | nightly-dashboard途中例外で前日データ温存+batch_error_log記録 |
| T3-10 | **E2E学習ループ**: 合成データ→夜間→月次→revision承認(revisionService.approve+apply)→pattern_steps書換→version+1→再度ブリーフィング生成で新タイミング反映 | ループ1周が自動テストで完走 |

---

# 実装上の遵守事項(Claude Codeへの指示)

1. **UI禁止**: src/app, src/components, 既存スタイルへの変更は一切不可。briefings/dashboard_dailyは「テーブルに正しいJSONがある」状態までが本タスクの完了定義
2. **既存コード尊重**: 既存のuseKpiStore等のストアには触れない。SuccessCloneEngine改修は読取インターフェース追加のみ(既存exportの破壊禁止)
3. **engines/はpure**: Supabase clientのimportが engines/ 配下に1つでもあればレビュー不合格
4. **snake_case/camelCase境界**: DB=snake_case、TS=camelCase。変換はservices/層のマッパーで一元化
5. **マジックナンバー禁止**: スコア重み・閾値(0.7, 14日, ×2.5, +15pt, n>=10等)は src/engines/constants.ts に集約(将来brain_paramsで上書きするため)
6. 実装順: Step1完了→T1全パス→Step2→T2全パス→Step3。Step跨ぎの先行実装禁止

完了定義(Definition of Done): T1-1〜T3-10 全39項目グリーン+T3-10のE2E学習ループ完走。
