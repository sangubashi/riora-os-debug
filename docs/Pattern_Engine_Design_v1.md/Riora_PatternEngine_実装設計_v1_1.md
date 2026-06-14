# Pattern Engine 実装設計書 v1(TypeScript / Claude Code直実装用)

**Riora OS — 成功パターンエンジン**
作成日: 2026-06-11
準拠: 実装仕様書v1 / タスク分解書v1(Step2のpattern/配下を本書で確定)
規約: engines/配下はSupabase import禁止(pure)。DB入出力はservices/層。DB=snake_case、TS=camelCase。

---

## 0. Pattern Engine 構成(ファイルマップ)

```
src/engines/pattern/
  index.ts                  ← 公開API(外部はここからのみimport)
  engine.types.ts           ← エンジン内部型(公開型はsrc/types/riora.types.ts)
  constants.ts              ← 全閾値・優先順位・重み
  JsonLogicEvaluator.ts     ← JSON Logic評価器(json-logic-jsラッパ+検証)
  ConditionEvaluator.ts     ← PatternContext→ルール評価(ドメイン層)
  PatternContextBuilder.ts  ← 生データ→PatternContext組み立て
  PatternAssigner.ts        ← 顧客→パターン割当(entry_condition評価)
  ProgressTracker.ts        ← step前進・停滞・完了判定
  CooldownController.ts     ← 提案クールダウン制御
  ProposalGenerator.ts      ← 発火判定→提案リスト生成(優先順位・上限)
  ScriptComposer.ts         ← base_script×style×変数→提案文
  Lv4Guard.ts               ← 原則抵触revisionのブロック
  RevisionDrafter.ts        ← Lv2起票の生成(タイミング/スクリプト)

src/services/
  patternEngineService.ts   ← 上記を束ねるDB接続オーケストレータ
tests/engines/pattern/      ← 各ファイル1:1のユニットテスト
```

依存方向(逆流禁止):
```
patternEngineService → index → ProposalGenerator → ConditionEvaluator → JsonLogicEvaluator
                              → ProgressTracker / CooldownController / ScriptComposer
RevisionDrafter → Lv4Guard(起票は必ずGuard通過)
```

---

## 1. constants.ts

```typescript
export const PROPOSAL_PRIORITY: Record<ProposalKind, number> = {
  // 数値が小さいほど優先。仕様: 離脱対応 > rebooking > subscription > homecare > upsell
  rebooking: 20, subscription: 30, homecare: 40, upsell: 50, pack: 35, none: 99,
};
export const CHURN_OVERRIDE_THRESHOLD = 0.7;   // これ以上は提案抑制+関係修復モード
export const MAX_PROPOSALS_PER_VISIT = 2;
export const DEFAULT_COOLDOWN_VISITS = 2;
export const STALL_CYCLE_MULTIPLIER = 2.0;     // 周期×2で停滞
export const CHURN_LABEL_MULTIPLIER = 2.5;     // 周期×2.5で離脱確定
export const SUBSC_CONDITIONS_REQUIRED = 4;
export const REVISION_MIN_SAMPLE = 10;         // n>=10
export const REVISION_MIN_LIFT_PT = 0.15;      // +15pt
export const LAPLACE_ALPHA = 1;
export const LAPLACE_BETA = 2;
```

## 2. engine.types.ts(内部型)

```typescript
import type { PatternContext, PatternStep, ProposalKind, StaffStyle,
  JsonLogicRule, FiredProposal } from '@/types/riora.types';

export interface EvaluationInput {
  ctx: PatternContext;
  steps: PatternStep[];               // 顧客の現行パターンの全step
  currentStep: number;
  recentOutcomes: OutcomeLite[];      // cooldown判定用(直近の同種提案履歴)
  staffStyle: StaffStyle;
  timingOffsets: Map<string, number>; // key = `${patternId}:${proposalKind}`
}
export interface OutcomeLite {
  proposalKind: ProposalKind;
  visitCountAt: number;
  wasExecuted: boolean;
  wasAccepted: boolean;
}
export interface StepFireResult {
  step: PatternStep;
  fired: boolean;
  blockedBy: 'condition' | 'cooldown' | 'churn_override' | 'subsc_gate' | null;
}
export interface RevisionDraft {
  changeType: 'timing' | 'script' | 'condition';
  patternId: string;
  stepNo: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: RevisionEvidence;
}
export interface RevisionEvidence {
  cells: Array<{ visitCountAt: number; executed: number; accepted: number; rate: number }>;
  liftPt: number;
  sampleSize: number;
  period: { from: string; to: string };
}
```

## 3. JsonLogicEvaluator.ts(評価器の核)

責務: json-logic-jsの安全ラッパ。**ドメイン知識を持たない**(PatternContextを知らない)。

```typescript
import jsonLogic from 'json-logic-js';
import type { JsonLogicRule } from '@/types/riora.types';

/** 許可する演算子のホワイトリスト(評価前に検査。未知演算子は拒否) */
const ALLOWED_OPS = new Set([
  'and','or','!','!=','==','===','>','>=','<','<=','var','in','+','-','*','min','max','if',
]);

export class JsonLogicEvaluator {
  /** ルール構文検証: 未知演算子・未知変数を列挙(空配列=合格) */
  static validate(rule: JsonLogicRule, allowedVars: ReadonlySet<string>): string[] {
    const errors: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      for (const [op, args] of Object.entries(node as Record<string, unknown>)) {
        if (op === 'var') {
          const name = Array.isArray(args) ? args[0] : args;
          if (typeof name !== 'string' || !allowedVars.has(name))
            errors.push(`unknown variable: ${String(name)}`);
        } else if (!ALLOWED_OPS.has(op)) {
          errors.push(`forbidden operator: ${op}`);
        }
        walk(args);
      }
    };
    walk(rule);
    return errors;
  }

  /** 評価。dataはsnake_caseフラットオブジェクト。例外はfalseに倒しエラーを返す */
  static evaluate(rule: JsonLogicRule, data: Record<string, unknown>):
      { result: boolean; error?: string } {
    try {
      return { result: jsonLogic.apply(rule, data) === true };
    } catch (e) {
      return { result: false, error: e instanceof Error ? e.message : 'evaluation failed' };
    }
  }
}
```

設計判断: 評価失敗は**false(提案しない)に倒す**。誤発火(押し売りリスク)より誤沈黙(機会損失)を選ぶ。エラーはservices層でevaluation_queueへ。

## 4. ConditionEvaluator.ts(ドメイン評価層)

責務: PatternContext(camelCase)→snake_case変換、許可変数の単一定義、評価。

```typescript
import { JsonLogicEvaluator } from './JsonLogicEvaluator';
import type { PatternContext, JsonLogicRule } from '@/types/riora.types';

/** DB内ルールが参照できる変数の唯一の定義(実装仕様書⑤と一致させる) */
export const CONTEXT_VARS = new Set([
  'visit_count','days_since_last','avg_cycle','is_nomination_streak2',
  'homecare_purchased_ever','homecare_declined_recent','skin_improved',
  'skin_stagnant2','subsc_conditions_met','churn_score',
  'next_booking_made_last','wedding_days_left','retail_total',
]);

export function toSnakeData(ctx: PatternContext): Record<string, unknown> {
  return {
    visit_count: ctx.visitCount, days_since_last: ctx.daysSinceLast,
    avg_cycle: ctx.avgCycle, is_nomination_streak2: ctx.isNominationStreak2,
    homecare_purchased_ever: ctx.homecarePurchasedEver,
    homecare_declined_recent: ctx.homecareDeclinedRecent,
    skin_improved: ctx.skinImproved, skin_stagnant2: ctx.skinStagnant2,
    subsc_conditions_met: ctx.subscConditionsMet, churn_score: ctx.churnScore,
    next_booking_made_last: ctx.nextBookingMadeLast,
    wedding_days_left: ctx.weddingDaysLeft, retail_total: ctx.retailTotal,
  };
}

export function evaluateCondition(rule: JsonLogicRule, ctx: PatternContext):
    { fired: boolean; error?: string } {
  const validation = JsonLogicEvaluator.validate(rule, CONTEXT_VARS);
  if (validation.length > 0) return { fired: false, error: validation.join('; ') };
  const { result, error } = JsonLogicEvaluator.evaluate(rule, toSnakeData(ctx));
  return { fired: result, error };
}
```

## 5. PatternContextBuilder.ts

```typescript
// シグネチャのみ確定(集計実装はタスク分解書2-Aの定義に従う)
export function buildContext(input: {
  customer: Customer;
  visits: Visit[];            // visit_date昇順・論理削除除外済(services層が保証)
  skins: SkinRecord[];
  progress: PatternProgress | null;
  subscription: Subscription | null;
  today: string;              // テスト容易性のため現在日付は注入
}): PatternContext;

// 算出仕様(確定):
// avgCycle: 直近最大5区間の来店間隔平均。visits<2 → タイプ別target_cycle_daysを使用
// isNominationStreak2: 直近2 visitsともis_nomination
// homecareDeclinedRecent: 直近2 visits内にhomecare_declined=true
// skinImproved: 最新skin.primary_delta <= -1
// skinStagnant2: 直近2レコード連続でprimary_delta変化なし(visits>=3が前提、未満はfalse)
// subscConditionsMet: ①初回primary_delta<=-1 または 初回visit_score>=50
//   ②homecarePurchasedEver ③isNominationStreak2
//   ④customer.goalNote非NULL かつ progress.currentStep>=3 — の充足数(0-4)
// weddingDaysLeft: E型のみ wedding_date − today(日)。それ以外null
```

## 6. CooldownController.ts

```typescript
import { DEFAULT_COOLDOWN_VISITS } from './constants';
import type { OutcomeLite } from './engine.types';
import type { ProposalKind } from '@/types/riora.types';

/**
 * 同種提案のクールダウン判定。
 * ルール: 直近で「実行されたが受諾されなかった」同kindの提案から
 *         cooldownVisits回の来店が経過するまで再提案禁止。
 * 受諾済み・未実行(ブリーフィングに載ったが言わなかった)はクールダウン対象外。
 */
export function isCoolingDown(
  kind: ProposalKind,
  currentVisitCount: number,
  outcomes: OutcomeLite[],
  cooldownVisits: number = DEFAULT_COOLDOWN_VISITS,
): boolean {
  const lastDeclined = outcomes
    .filter(o => o.proposalKind === kind && o.wasExecuted && !o.wasAccepted)
    .sort((a, b) => b.visitCountAt - a.visitCountAt)[0];
  if (!lastDeclined) return false;
  return currentVisitCount - lastDeclined.visitCountAt <= cooldownVisits;
}
```

境界仕様(テスト固定): 2回目で拒否・cooldown=2 → 3,4回目は禁止、**5回目で再提案可**(`<=`判定)。

## 7. ProgressTracker.ts

```typescript
export function advanceProgress(input: {
  progress: PatternProgress;
  steps: PatternStep[];
  ctx: PatternContext;
  acceptedKinds: ProposalKind[];   // 今回来店で受諾された提案種別
  today: string;
}): { next: PatternProgress; completedNow: boolean } {
  // 前進条件: 現stepのproposal_kindがacceptedKindsに含まれる
  //           または proposal_kind='none'のstepはcondition成立のみで前進
  // 完了: 最終step前進 or subscription受諾 → completed=true
  // 停滞: ctx.daysSinceLast > ctx.avgCycle * STALL_CYCLE_MULTIPLIER
  //        || ctx.skinStagnant2 → stalledFlag=true(stepは戻さない)
  // E1特例: weddingDaysLeft < 0(挙式後)で自動完了+abandonedReason=null
}
```

## 8. ProposalGenerator.ts(発火の最終決定者)

```typescript
import { PROPOSAL_PRIORITY, MAX_PROPOSALS_PER_VISIT,
  CHURN_OVERRIDE_THRESHOLD, SUBSC_CONDITIONS_REQUIRED } from './constants';

export function generateProposals(input: EvaluationInput): {
  proposals: FiredProposal[];
  trace: StepFireResult[];          // 全stepの発火/ブロック理由(デバッグ・監査用)
} {
  const trace: StepFireResult[] = [];
  for (const step of input.steps) {
    // 1. timing_offset適用: offsetがある場合、ctxのvisit_countをoffset分減算した
    //    仮contextで評価する(= 発火が遅れる)。fire_condition自体は書き換えない
    const offset = input.timingOffsets.get(`${step.patternId}:${step.proposalKind}`) ?? 0;
    const ctx = offset === 0 ? input.ctx
      : { ...input.ctx, visitCount: input.ctx.visitCount - offset };

    // 2. ハードゲート(条件より先に評価・絶対防衛線)
    if (step.proposalKind === 'subscription'
        && input.ctx.subscConditionsMet < SUBSC_CONDITIONS_REQUIRED) {
      trace.push({ step, fired: false, blockedBy: 'subsc_gate' }); continue;
    }
    if (input.ctx.churnScore > CHURN_OVERRIDE_THRESHOLD
        && step.proposalKind !== 'rebooking') {
      trace.push({ step, fired: false, blockedBy: 'churn_override' }); continue;
    }
    // 3. cooldown
    if (isCoolingDown(step.proposalKind, input.ctx.visitCount,
        input.recentOutcomes, step.cooldownVisits)) {
      trace.push({ step, fired: false, blockedBy: 'cooldown' }); continue;
    }
    // 4. 条件評価
    const { fired } = evaluateCondition(step.fireCondition, ctx);
    trace.push({ step, fired, blockedBy: fired ? null : 'condition' });
  }

  // 5. 優先順位ソート→上限2件→スクリプト合成
  const proposals = trace.filter(t => t.fired)
    .sort((a, b) => PROPOSAL_PRIORITY[a.step.proposalKind] - PROPOSAL_PRIORITY[b.step.proposalKind])
    .slice(0, MAX_PROPOSALS_PER_VISIT)
    .map((t, i) => toFiredProposal(t.step, input, { isMandatory: i === 0 }));
  return { proposals, trace };
}
```

確定仕様:
- subscゲートとchurnオーバーライドは **fire_conditionに書かれていなくてもコードで強制**(DB側のルール改変では外せない二重防衛。Lv4ガードと対)
- churn>0.7時はrebooking(関係維持)のみ許可
- traceは必ずproposal_outcomesと別にログ保存(services層)— 「なぜ発火しなかったか」が学習とデバッグの資料になる
- isMandatory: 優先1位のみtrue(亀山さん運用: ブリーフィングで赤表示1件)

## 9. ScriptComposer.ts

```typescript
const STYLE_OPENERS: Record<StaffStyle, (vars: ScriptVars) => string> = {
  evidence: v => `今日の${v.metricLabel}は前回より${v.deltaLabel}です。`,
  theory:   v => `${v.mechanismLabel}の仕組み上、`,
  empathy:  v => `私も同じ悩みがあったので分かるんですが、`,
};

export function composeScript(input: {
  baseScript: string;              // pattern_steps.base_script
  style: StaffStyle;
  vars: ScriptVars;                // {candidate_date, wedding_date, total_sessions, metricLabel...}
}): { text: string; ngWords: string[] } {
  // 1. {var}プレースホルダ差込(未解決変数が残ったらエラーではなく変数ごと除去)
  // 2. style openerを文頭に付与(baseScriptが既にstyle固有文の場合はskip — メタ情報で判定)
  // 3. NGワード検査(既存NG辞書をimport): 検出時はtextを返さずngWordsのみ返す
  //    → 呼び出し側はbase_scriptの素のまま(opener無し)にフォールバック
}
```

## 10. Lv4Guard.ts

```typescript
/** 原則抵触チェック。1つでも違反があればrevisionはDB到達前に死ぬ */
export function lv4Check(draft: RevisionDraft): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  const b = draft.before, a = draft.after;

  // G1: cooldown短縮禁止
  if (num(a.cooldown_visits) < num(b.cooldown_visits))
    v.push('G1: cooldown_visits decrease');
  // G2: 提案上限増加禁止(constants変更を伴うrevisionは存在自体禁止)
  if ('max_proposals_per_visit' in a) v.push('G2: proposal cap modification');
  // G3: サブスクゲート緩和禁止 — afterのfire_conditionから
  //     subsc_conditions_met >= 4 が消える/閾値が下がる変更
  if (draft.changeType === 'condition' && relaxesSubscGate(b, a))
    v.push('G3: subscription gate relaxation');
  // G4: 個人情報フィールド追加禁止(brain送出系の変更)
  if (containsPiiField(a)) v.push('G4: PII field introduction');
  // G5: NGワード辞書からの削除禁止
  if (draft.changeType === 'script' && removesNgWords(b, a))
    v.push('G5: NG dictionary removal');
  // G6: timing変更は「遅らせる/早める」どちらも可。ただし
  //     homecare/subscriptionをvisit_count 1(初回)へ早める変更は禁止(C型保護)
  if (draft.changeType === 'timing' && firstVisitSellPush(draft))
    v.push('G6: first-visit sales push');

  return { ok: v.length === 0, violations: v };
}
```

relaxesSubscGateの実装指針: before/after両方のfire_conditionをASTとして走査し、`{">=" : [{"var":"subsc_conditions_met"}, N]}` ノードを抽出。afterで欠落またはN減少なら違反。

## 11. RevisionDrafter.ts(Lv2起票)

```typescript
export function draftTimingRevisions(input: {
  cells: OutcomeCell[];   // monthly-learningの集計: {patternId, stepNo, kind, visitCountAt, executed, accepted}
  currentSteps: PatternStep[];
  period: { from: string; to: string };
}): RevisionDraft[] {
  // 1. セルごとに laplaceRate = (accepted + LAPLACE_ALPHA) / (executed + LAPLACE_ALPHA + LAPLACE_BETA)
  // 2. (patternId, stepNo)単位で「現行タイミングのrate」vs「最良代替タイミングのrate」を比較
  // 3. 起票条件: 代替rate − 現行rate >= REVISION_MIN_LIFT_PT
  //              かつ 代替セルexecuted >= REVISION_MIN_SAMPLE
  // 4. RevisionDraft生成: before/after = fire_condition内のvisit_count閾値diff、
  //    evidence = 両セルの生数値+liftPt+period
  // 5. 全draftをlv4Check通過後に返す(違反draftは破棄+ログ)
}
```

revisionService(services層)の責務: draft受領→再度lv4Check(二重化)→pattern_revisions INSERT(status='proposed')→承認時 `apply()`: pattern_stepsのfire_condition書換+success_patterns.version+1+pattern_revisions.status='approved'。

## 12. index.ts(公開API)

```typescript
export { buildContext } from './PatternContextBuilder';
export { generateProposals } from './ProposalGenerator';
export { advanceProgress } from './ProgressTracker';
export { assignPattern } from './PatternAssigner';
export { composeScript } from './ScriptComposer';
export { draftTimingRevisions } from './RevisionDrafter';
export { lv4Check } from './Lv4Guard';
export { evaluateCondition, CONTEXT_VARS } from './ConditionEvaluator';
// JsonLogicEvaluator / CooldownController は内部実装(外部export禁止)
```

## 13. patternEngineService.ts(DB接続オーケストレータ)

```typescript
// 来店保存後フック(visitServiceから呼ばれる)
export async function onVisitSaved(visitId: string): Promise<void> {
  // 1. customerRepository.loadContextBundle(customerId) — 1クエリJOIN
  // 2. buildContext → advanceProgress → pattern_progress UPDATE
  // 3. 今回受諾分のproposal_outcomes確定(was_accepted更新・briefing消込)
  // 4. generateProposals(次回来店向け) → fire_trace_logテーブルへtrace保存
  // 例外は全てcatch → evaluation_queue INSERT(visits保存は既に完了済・巻き戻さない)
}

// 前夜バッチ用(nightly-dashboardから呼ばれる)
export async function buildBriefingFor(customerId: string, date: string): Promise<Briefing>;
```

---

## 14. テストファイル対応表(tests/engines/pattern/)

| テストファイル | 対象 | 必須ケース |
|---|---|---|
| JsonLogicEvaluator.test.ts | 検証・評価 | 未知演算子拒否 / 未知変数拒否 / 評価例外→false / 正常true・false |
| ConditionEvaluator.test.ts | 変換+評価 | seed全fire_condition×代表ctx5種(タスク分解T2-2) |
| CooldownController.test.ts | 境界 | 拒否後+2禁止・+3再開 / 受諾はクールダウンなし / 未実行はクールダウンなし |
| ProposalGenerator.test.ts | ゲート・優先 | subscゲート(3/4で非発火) / churn>0.7でrebookingのみ / 3件発火→上位2件 / offset+1で発火が1来店遅延 / trace.blockedBy正値 |
| ProgressTracker.test.ts | 前進・停滞 | 受諾で前進 / none-step自動前進 / 周期×2でstalled / E1挙式後完了 |
| ScriptComposer.test.ts | 合成 | 変数差込 / 未解決変数除去 / NGワード検出→フォールバック / style別opener |
| Lv4Guard.test.ts | G1〜G6 | 各ガード違反1件ずつ+正常draft通過 |
| RevisionDrafter.test.ts | 起票 | lift+15pt&n10で起票 / n9で非起票 / lift14ptで非起票 / G6違反draft破棄 |
| scenario.B1.test.ts ほか8本 | 統合 | タスク分解T2-7(8パターン完走シナリオ) |

完了定義: 上記全テストグリーン+`engines/pattern/` 配下にsupabase importゼロ(lintルール `no-restricted-imports` で機械的に強制すること)。
