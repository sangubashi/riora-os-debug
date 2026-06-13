# Scenario Engine Code Architecture v1.0

**株式会社martylabo / Salon Riora — DM層 実装直結Code Architecture**
作成日: 2026-06-11
正典遵守: Event Flow v1.0(発火3系統・冪等・承認制)/ ScenarioSelector実装仕様v1(5段パイプライン・抑制)/ Scenario Library v1(60本)/ Proposal Generator v2.0 §6(Connector契約)/ Pattern Engine Code Architecture v1.0(評価基盤・DI・エラー規約を継承)。

---

## 1. ディレクトリ・ファイル構成

```
src/engines/scenario/
  core/
    ScenarioContext.ts           # DM用Context(PatternContext拡張)+TriggerEvent型
    scenario.constants.ts        # 抑制閾値・priority・静音時間・expire時間
  pipeline/
    ScenarioMatcher.ts           # 候補抽出+fire_condition+抑制フィルタ
    ScenarioPriorityResolver.ts  # 優先度解決・1顧客1通統合
    LineQueueBuilder.ts          # 文面確定+queueペイロード組立
  ScenarioSelector.ts            # pureオーケストレータ(公開API)
  index.ts
src/services/
  ScenarioExecutionService.ts    # DB接続・冪等・起票・retry/expire協調(唯一の副作用層)
src/repositories/
  interfaces.scenario.ts         # IScenarioRepo/ISendHistoryRepo/ITriggerLogRepo/IQueueRepo
tests/engines/scenario/          # 1:1+統合
```

依存規則: `engines/scenario/**` はsupabase import禁止(lint継承)。JsonLogicEvaluator・NGワード辞書・CooldownロジックはPattern Engine core/から**import共用**(再実装禁止)。

## 2. 共有型

```typescript
// ===== core/ScenarioContext.ts =====
export type TriggerEvent =
  | 'first_visit_done' | 'no_rebooking' | 'considering' | 'proposal_declined'
  | 'peeling_done' | 'pre_visit_boost' | 'skin_improved'
  | 'cycle_over_1_5' | 'cycle_over_2_0' | 'cycle_over_2_5'
  | 'subsc_cond_3' | 'subsc_cond_4_unclosed' | 'subsc_started'
  | 'subsc_monthly_first' | 'subsc_pace_drop' | 'subsc_cancelled_30d'
  | 'homecare_14d' | 'crosssell_ready' | 'hc_intro_ready' | 'd_rebound_14d'
  | 'csi_75' | 'csi_80' | 'review_ready' | 'vip_quarterly' | 'anniversary'
  | 'birthday_month' | 'season_summer' | 'season_winter' | 'season_pollen'
  | 'memo_keyword_event' | 'memo_keyword_busy' | 'memo_keyword_life'
  | 'e1_milestone_90' | 'e1_milestone_30' | 'e1_milestone_7' | 'e1_reborn_30d';

export interface ScenarioTriggerInput {
  storeId: UUID; customerId: UUID;
  triggerEvent: TriggerEvent;
  occurredOn: DateStr;                       // 冪等キーの一部
  payload?: Record<string, unknown>;         // 例: { paceRatio: 1.6 }
  source: 'sync' | 'nightly' | 'monthly';    // 発火3系統(Event Flow)
}

export interface ScenarioContext extends PatternContext {
  // DM拡張変数(JSON Logic参照可・snake_case変換に追加登録)
  cycleRatio: number; subscPaceRatio: number | null;
  daysSinceHomecare: number | null; csi: number; isVip: boolean;
  lastScenarioSentDays: number | null;
}
export const SCENARIO_EXTRA_VARS = new Set(['cycle_ratio','subsc_pace_ratio',
  'days_since_homecare','csi','is_vip','last_scenario_sent_days']);

// ===== シナリオ候補(Candidate継承・DM固有) =====
export interface ScenarioCandidate extends Candidate {   // channel='dm'固定
  groupCode: 'L'|'SB'|'R'|'V'|'C';
  triggerEvent: TriggerEvent;
  suppression: SuppressionSpec;
  tone: 'standard'|'professional'|'friendly'|'sympathy';
  sendDelay: 'next_morning_10'|'same_day_20'|'plus_3d'|'immediate_quiet_safe';
  template: string; templateVars: string[];
  generationMode: 'template'|'ai_assist'|'ai_full';
  successScore: number;
}
export interface SuppressionSpec { globalDays: number; sameScenarioDays: number;
  sameGroupDays: number; salesCooldownVisits: number; allowStageProgression: boolean; }

// ===== 履歴・結果型 =====
export interface SendHistoryItem { scenarioCode: string; groupCode: string;
  isSales: boolean; sentAt: ISODateTime; wasApproved: boolean; rejectCount: number; }
export interface InStoreShadow {                          // Connector通知(同種抑止)
  proposalKinds: ProposalKind[];                          // 当日店内winner
  manualPinActive: boolean; }                             // O1 Pin中
export interface SelectionResult {
  selected: { candidate: ScenarioCandidate; mergedNote: string | null } | null;
  rejected: Array<{ code: string; blockedBy: ScenarioBlockReason; detail?: string }>;
  record: ScenarioDecisionRecord; }                       // Explainability(§8)
export type ScenarioBlockReason = 'idempotent'|'lifecycle'|'condition'
  |'freq_7d'|'same_scenario_30d'|'same_group_14d'|'sales_cooldown'
  |'churn_sales_block'|'reject_twice_permanent'|'superseded_by_instore'
  |'manual_pin_dm_stop'|'priority_superseded'|'quiet_hours';

// ===== Repository interfaces =====
export interface IScenarioRepo { loadActive(storeId: UUID): Promise<ScenarioCandidate[]>; } // 2層解決済
export interface ISendHistoryRepo { recent(customerId: UUID, days: number): Promise<SendHistoryItem[]>;
  permanentStops(customerId: UUID): Promise<Set<string>>; }   // 2回却下の恒久停止
export interface ITriggerLogRepo { exists(key: TriggerLogKey): Promise<boolean>;
  write(log: TriggerLogEntry): Promise<void>; }               // UNIQUE冪等キー
export interface IQueueRepo { insertPending(item: QueueItem): Promise<UUID | 'duplicate'>; }
```

## 3. ScenarioMatcher(候補抽出+条件+抑制)

```typescript
// pipeline/ScenarioMatcher.ts
export interface ScenarioMatchInput {
  trigger: ScenarioTriggerInput; ctx: ScenarioContext;
  candidates: ScenarioCandidate[];        // processCache(Pattern Engineと同戦略)
  history: SendHistoryItem[]; permanentStops: Set<string>;
  shadow: InStoreShadow; nowJst: ISODateTime; }

export class ScenarioMatcher {
  constructor(private evaluator: JsonLogicEvaluator) {}   // Pattern coreを共用

  match(input: ScenarioMatchInput): { eligible: ScenarioCandidate[];
                                      rejected: SelectionResult['rejected'] } {
    // 順序固定(blockedBy正確性):
    // 0. trigger一致 × (customer_type一致 or 'all') × lifecycle(active/testing決定論50%)
    // 1. 恒久停止: permanentStops.has(code) → 'reject_twice_permanent'
    // 2. 店内シャドウ:
    //    shadow.proposalKinds に同一proposalKind → 'superseded_by_instore'
    //    shadow.manualPinActive && c.isSales     → 'manual_pin_dm_stop'
    // 3. churn販売停止: ctx.churnScore>0.7 && c.isSales → 'churn_sales_block'
    // 4. fire_condition: evaluator.evaluateMany(CONTEXT_VARS ∪ SCENARIO_EXTRA_VARS)
    //    評価error → falseに倒す+'condition'(detail=error)
    // 5. 抑制(history走査・ユーティリティに分離: SuppressionFilter関数群):
    //    freq_7d: 直近送信<7日(後段でpriority1割込を再判定するため
    //             ここでは『暫定除外フラグ』として保持しResolverへ渡す)
    //    same_scenario_30d / same_group_14d
    //      (allowStageProgression=trueの群Lは ×1.5→×2.0→×2.5 の段階進行を例外通過)
    //    sales_cooldown: 直近homecare_declined 2来店 / サブスク提案拒否30日
    //    quiet_hours: sendDelay解決後の送信時刻が10:00-20:00外になる場合は
    //                 翌10:00へ繰延べ(除外ではなくscheduledAt補正・Builderに伝達)
  }
}
```

## 4. ScenarioPriorityResolver(統合・1顧客1通)

```typescript
// pipeline/ScenarioPriorityResolver.ts
export class ScenarioPriorityResolver {
  resolve(eligible: ScenarioCandidate[], freq7dBlocked: boolean):
      { winner: ScenarioCandidate | null; merged: ScenarioCandidate | null;
        rejected: SelectionResult['rejected'] } {
    // 1. priorityClass昇順 → 同率はsuccessScore降順 → code辞書順(決定論)
    // 2. freq_7d判定の最終解決:
    //    freq7dBlocked && winner.priorityClass!==1 → 全候補 'freq_7d'(今回は送らない)
    //    freq7dBlocked && winner.priorityClass===1 → 割込許可(正典の唯一の例外)
    // 3. 統合(merged): 次点が非販売 かつ priority差<=1 → mergedNote化(最大1件)
    //    販売系同士は統合禁止(残りは 'priority_superseded')
    // 4. 群C(季節)は他候補が1つでもあれば常に譲る(priority4の明文化)
  }
}
```

## 5. LineQueueBuilder(文面+ペイロード)

```typescript
// pipeline/LineQueueBuilder.ts
export interface QueueItem {
  storeId: UUID; customerId: UUID;
  scenarioUid: UUID; scenarioCode: string; scenarioVersion: number;
  triggerEvent: TriggerEvent;
  messageDraft: string;
  evidence: { triggerDetail: Record<string, unknown>;     // 例: { cycleRatio: 2.1 }
              conditionSnapshot: Record<string, unknown>; // 主要ctx値の抜粋
              mergedFrom: string | null };
  scheduledAt: ISODateTime; expiresAt: ISODateTime;       // scheduledAt+72h
  scheduledDate: DateStr; }                               // 冪等UNIQUE用

export class LineQueueBuilder {
  constructor(private ng: NgWordChecker) {}               // Pattern共用辞書

  build(winner: ScenarioCandidate, mergedNote: string | null,
        ctx: ScenarioContext, vars: TemplateVars, nowJst: ISODateTime):
        { item: QueueItem } | { blocked: 'ng_word' | 'vars_unresolved' } {
    // 1. テンプレ差込: {customer_name}{staff_name}{skin_metric}{delta}
    //    {wedding_days_left}{candidate_date}{missing_condition_hint}
    //    未解決変数 → 当該文ごと除去(全文消失なら 'vars_unresolved')
    // 2. mergedNote末尾追記(1行・「PS: 」形式)
    // 3. NG検査(generationMode='template'でも必須): 検出→テンプレ素文に差戻し
    //    →再検出なら 'blocked: ng_word'(起票中止・ops_logsへ)
    // 4. scheduledAt = sendDelay解決(+quiet_hours補正値)・expiresAt = +72h
    // ai_assist/ai_full(Phase2): generationModeで分岐するフックのみ用意
    //   (composeWithAi(): 未実装スタブ・失敗時template自動フォールバック契約)
  }
}
```

## 6. ScenarioSelector(pureオーケストレータ)

```typescript
// ScenarioSelector.ts — 公開API
export class ScenarioSelector {
  constructor(private matcher: ScenarioMatcher,
              private resolver: ScenarioPriorityResolver,
              private builder: LineQueueBuilder) {}

  select(input: ScenarioMatchInput, vars: TemplateVars): SelectionResult & {
      queueItem: QueueItem | null } {
    // match → resolve → build の直列。各段のrejectedを集約しrecord組立(§8)
    // 全候補消滅でも正常終了(selected:null・blocked集合が成果物 — 抑制も学習データ)
    // 本クラスはDBを知らない(決定論・同入力同出力・テストは全モック不要のpure)
  }
}
```

## 7. ScenarioExecutionService(副作用層・唯一のDB接点)

```typescript
// services/ScenarioExecutionService.ts
export class ScenarioExecutionService {
  constructor(private repos: {...4 repos}, private selector: ScenarioSelector,
              private cache: ProcessCache) {}

  /** 発火3系統の共通入口(BE1区画9 / nightly / monthly から呼ばれる) */
  async handleTrigger(t: ScenarioTriggerInput): Promise<void> {
    // 1. 冪等: triggerLogRepo.exists({store,customer,event,occurredOn}) → 即return
    //    遷移系(cycle_over_*/csi_*/subsc_cond_*)は閾値単位の恒久キー
    //    (再発火は来店発生=周期リセット後のみ・キーにvisit_count_atを含めて実現)
    // 2. データ収集(2クエリ): ContextBundle + history/permanentStops/shadow
    //    shadow組立: 当日のFinalProposalSet(dashboard_cache briefing)から
    //    proposalKinds抽出+O1 Pin状態(LineScenarioConnector.plan()の出力を参照)
    // 3. result = selector.select(...)
    // 4. 永続化(順序固定):
    //    a. queueItem非null → queueRepo.insertPending
    //       'duplicate'(UNIQUE衝突) → blockedBy='idempotent'に差替え
    //    b. triggerLogRepo.write({ selectedScenarioCode | null, blockedBy, record })
    // 5. エラー: 全体try/catch → ops_logs(kind='scenario_error')+evaluation相当の
    //    リトライはしない(夜間の周期系は翌晩再評価される設計のため・Event Flow準拠)
  }

  /** バルク版(夜間: 顧客ループ・候補/historyはプリフェッチ) */
  async handleTriggersBulk(ts: ScenarioTriggerInput[]): Promise<BulkReport>;
}
```

### 7-1. retry戦略・expiration戦略(関連ワーカーとの契約)

| 関心 | 担当 | 仕様 |
|---|---|---|
| 起票retry | しない | 冪等キーがあるため「翌晩の再評価」が事実上のretry(周期系)。同期系(初回サンクス等)の取りこぼしはevaluation_queue回収で翌晩発火 |
| 送信retry | 送信ワーカー(本書外・契約のみ) | approved→送信失敗: 指数バックオフ 1m/5m/25m の3回 → status='failed'。failedはexpiresAtまで毎時ワーカーが1回/時で再試行 |
| expiration | queue-expire(毎時) | now>expiresAt の pending/failed → 'expired'。**expiredも履歴保持**(cooldown入力・削除しない) |
| 承認後の鮮度 | approve時 | expiresAt超過行のapproveはCONFLICT(P0 Schema準拠・Service側でも二重チェック) |

## 8. Explainability(ScenarioDecisionRecord)

```typescript
export interface ScenarioDecisionRecord {
  trigger: ScenarioTriggerInput;
  candidatesEvaluated: number;
  rejected: Array<{ code: string; blockedBy: ScenarioBlockReason; detail?: string }>;
  selected: { code: string; priorityClass: number; successScore: number;
              decisiveReason: string } | null;   // 例: 'priority1(初回翌日)・候補内最高実績'
  suppressionState: { lastSentDaysAgo: number | null; salesCooldownActive: boolean;
                      churnBlock: boolean };
}
// 保存先: scenario_trigger_log.record(JSONB)。
// 日本語テンプレ(決定論・承認画面evidence用):
//  「{trigger日本語}により{code}を起票。{decisiveReason}。
//    送信予定{scheduledAt}・根拠: {triggerDetail要約}」
//  全滅時:「{trigger}が発生しましたが{最上位blockedBy日本語}のため送信しません」
//  → 抑制理由の日本語辞書は scenario.constants.BLOCK_DICT(13種全定義必須)
```

## 9. エラー処理・ログ戦略

| 層 | 方針(Pattern Engine規約継承) |
|---|---|
| Matcher/Resolver/Builder | throwしない。候補単位の異常はrejected隔離・全滅は正常終了 |
| Builder ng_word/vars_unresolved | 起票中止+ops_logs(kind='guard_violation'/'template_error')。**文面は保存しない**(GUARD規約) |
| ExecutionService | 全体catch→ops_logs(kind='scenario_error', trigger全文)。throwを呼出側(BE1/バッチ)に漏らさない |
| ログ粒度 | trigger_log=全発火(成功も全滅も)/ops_logs=異常のみ/月次learning_reportにblockedBy分布を集計(抑制の健全性監視: churn_sales_block急増=離脱増の先行指標) |

## 10. データフロー・実行順序

```
trigger(sync/nightly/monthly)
 → ExecutionService.handleTrigger
   ├ 冪等チェック(1クエリ) → hit即終了
   ├ 収集(2クエリ: bundle+history系) + processCache(候補60本)
   ├ ScenarioSelector(pure): Matcher → PriorityResolver → LineQueueBuilder
   ├ queueRepo.insertPending(UNIQUE: customer×code×scheduledDate)
   └ triggerLogRepo.write(record)
 → [人間] approve/reject → 送信ワーカー(backoff3回) → scenario_outcomes
 → queue-expire(毎時)/outcome-confirm(日次) → nightly-etl → 学習
DBアクセス: 発火1件あたり最大4クエリ(冪等1+収集2+書込1〜2)。バルクは候補・history
プリフェッチで顧客あたり2に圧縮。
```

## 11. Unit Test観点

| 対象 | 必須ケース |
|---|---|
| ScenarioMatcher | blockedBy 13種を各1ケース以上/段階進行例外(×1.5→×2.0が14日以内でも通過)/quiet_hours繰延べ(20:30発火→翌10:00)/shadow同種抑止/Pin販売停止 |
| PriorityResolver | freq7d×priority1割込/×priority2全滅/販売×販売統合禁止/merged 1件上限/群C譲歩/決定論(同入力100回) |
| LineQueueBuilder | 変数全解決/一部未解決→文除去/全文消失block/NG検出→素文差戻し→再検出block/expiresAt=+72h/mergedNote追記 |
| ScenarioSelector | pure検証(モック不要・同入力同出力)/全滅時record完全性 |
| ExecutionService | 冪等hit即終了/UNIQUE duplicate→idempotent差替/遷移系の閾値キー(同閾値再発火なし・来店後再許可)/catch→ops_logs・非throw |
| 統合 | Library v1の代表シナリオ10本(各群2本)のE2E: trigger→pending起票→evidence内容一致。タスク分解書T3-3/T3-4も継承 |

## 12. Brain Evolution接続点

| 接続点 | 本実装での準備 |
|---|---|
| successScore実測上書き(月次) | scoringはsuccessScoreをDB値参照(コード定数なし・済) |
| lifecycle(昇降格・停止) | MatcherのlifecycleフィルタとtestingのA/B 50%(Pattern同機構・済) |
| 抑制閾値の将来調整 | suppressionは候補行JSONB(コード側はSpec解釈のみ・済)。ただし**緩和方向はLv4でDB到達前に死ぬ**(変更経路はrevisionのみ) |
| ai_assist文面 | generationMode分岐フック+templateフォールバック契約(済・実装はPhase2) |

---
*Scenario Engine Code Architecture v1.0 — DM層実装の唯一の正。Pattern Engine Code Architecture v1.0と同一規約(DI・pure・lint・テスト先行)で、tests/スケルトンから着手すること。*
