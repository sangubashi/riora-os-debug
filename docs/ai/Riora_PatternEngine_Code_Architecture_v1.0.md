# Pattern Engine Code Architecture v1.0

**株式会社martylabo / Salon Riora — 実装直結Code Architecture**
作成日: 2026-06-11
正典遵守: Success Pattern Final v1.0(採点・競合・Gate)/ Proposal Generator v2.0(オーケストレーション・出力契約)/ Brain Evolution v1.0(学習接続点)。矛盾時は正典優先・本書はそのコード化。

---

## 1. ディレクトリ・ファイル構成

```
src/engines/pattern/
  core/
    JsonLogicEvaluator.ts        # 条件評価基盤(キャッシュ込み)
    PatternContext.ts            # Context型+Soft特徴生値の定義
    constants.ts                 # 全閾値(brain_paramsで上書き可能な初期値)
  pipeline/
    PatternMatcher.ts            # Hard層: 資格判定+Gate
    PatternScorer.ts             # Soft層: FireScore
    ConflictResolver.ts          # 競合解決+割当ヒステリシス
    StaffAdjustmentEngine.ts     # スタッフ補正(3作用点)
    ExplainabilityEngine.ts      # DecisionRecord+日本語生成
  ProposalGenerator.ts           # オーケストレータ(v2.0)+NextAction/HomeCare/LINE接続
  index.ts                       # 公開API(ProposalGenerator経由のみexport)
src/repositories/                # Supabase依存はここのみ(interface+実装)
  interfaces.ts                  # ICandidateRepo / IStatsRepo / IParamsRepo / IOutcomeRepo
  supabase/*.ts                  # 実装(engines/からはinterfacesのみimport)
tests/engines/pattern/           # ファイル1:1+scenario統合
```

依存規則(lint強制): `engines/**` は `repositories/interfaces` と `types/` のみimport可。`repositories/supabase` のimportは services/ と DIコンテナのみ。

## 2. 共有型(TypeScript interface)

```typescript
// ===== core/PatternContext.ts =====
export interface PatternContext {
  // Hard変数(JSON Logic参照可・snake_case変換対象)
  visitCount: number; daysSinceLast: number; avgCycle: number;
  isNominationStreak2: boolean; homecarePurchasedEver: boolean;
  homecareDeclinedRecent: boolean; skinImproved: boolean; skinStagnant2: boolean;
  subscConditionsMet: 0|1|2|3|4; churnScore: number;
  nextBookingMadeLast: boolean; weddingDaysLeft: number | null; retailTotal: number;
  // Soft特徴の生値(Scorerが0-1化)
  raw: { typeConfidence: number; csi: number; skinDeltaTrend: number;
         cycleRatio: number; lastVisitDate: string };
  customerType: CustomerType; customerId: UUID; storeId: UUID;
}

// ===== 候補(店内step/DMシナリオの統一表現) =====
export interface Candidate {
  uid: UUID; code: string;                 // 'B1-step4' | 'S-SB-07'
  channel: 'in_store' | 'dm';
  patternCode: string | null;              // 店内のみ
  stepNo: number | null;
  proposalKind: ProposalKind;
  isSales: boolean;
  priorityClass: 1|2|3|4;
  hardCondition: JsonLogicRule;
  softFeatures: SoftFeatureSpec;           // { weights: Record<FeatureName, number>, optimalVisit?: number }
  baseScript: string;
  cooldownVisits: number;
  lifecycleStatus: 'candidate'|'testing'|'active'|'watch'|'demoted'|'suspended';
  version: number;
}
export type FeatureName = 'timing_proximity'|'cycle_position'|'condition_margin'
  |'type_confidence'|'csi_alignment'|'skin_momentum';

// ===== パイプライン中間型 =====
export interface RejectedCandidate { candidate: Candidate;
  stageReached: 0|1|2|3|4;
  blockedBy: 'lifecycle'|'condition'|'G-SUB'|'G-CHURN'|'G-COOL'|'G-FREQ'|'G-CONSENT'
            |'exclusion'|'score'|'slot'; detail?: string; }
export interface ScoredCandidate { candidate: Candidate;
  features: Record<FeatureName, number>;            // 0-1
  breakdown: { successRate: number; contextFit: number; timing: number;
               affinity: number; urgency: number; overrideBoost: number;
               churnPenalty: number };               // 各項は重み適用後の寄与値
  fireScore: number; }                               // 0-100
export interface Resolution {
  inStore: { mandatory: ScoredCandidate | null; secondary: ScoredCandidate | null };
  dm: ScoredCandidate | null;
  rejected: RejectedCandidate[]; tiebreakUsed: boolean; }

// ===== 統計・パラメータ(Repository経由) =====
export interface CellStats { executedN: number; acceptedN: number; laplaceRate: number;
  repeatRate90d: number | null; }                    // pattern_step_statsの1セル
export interface ScoringWeights { w1: number; w2: number; w3: number; w4: number; w5: number; }
export interface Overrides { manualPin: { candidateCode: string } | null;   // O1
  storeOverrideCodes: Set<string>; }                                        // O2

// ===== Repository interfaces(Supabase隔離) =====
export interface ICandidateRepo { loadActive(storeId: UUID): Promise<Candidate[]>; }    // 2層解決済
export interface IStatsRepo { loadCells(keys: CellKey[]): Promise<Map<string, CellStats>>; }
export interface IParamsRepo { weights(cluster: string): Promise<ScoringWeights>;
  styleAffinity(): Promise<Record<StaffStyle, Record<string, number>>>; }
export interface IOutcomeRepo { recent(customerId: UUID, n: number): Promise<OutcomeLite[]>; }
```

## 3. JsonLogicEvaluator(条件評価基盤)

```typescript
// core/JsonLogicEvaluator.ts
export class JsonLogicEvaluator {
  // ---- cache戦略 ----
  // L1 validationCache: Map<ruleHash, string[]>   検証は候補マスタ読込時に1回だけ
  // L2 dataCache: 1顧客評価中のsnake_case変換済dataを使い回し(evaluateMany)
  // ルール自体のコンパイルキャッシュはjson-logic-jsが軽量なため不要(実測で判断・YAGNI)
  private validationCache = new Map<string, string[]>();

  validate(rule: JsonLogicRule, allowedVars: ReadonlySet<string>): string[] {
    // hash = stableStringify(rule) → cache hit なら即返却
    // walk: 未知演算子(ALLOWED_OPS外)・未知変数を列挙(実装はPattern Engine実装設計v1 §3)
  }

  /** 1顧客×N候補の一括評価(推奨エントリ) */
  evaluateMany(rules: Array<{key: string; rule: JsonLogicRule}>, ctx: PatternContext):
      Map<string, { fired: boolean; error?: string }> {
    const data = toSnakeData(ctx);                  // 変換は1回
    // for each: try jsonLogic.apply(rule, data)===true
    // catch → { fired:false, error } ※falseに倒す(誤発火より誤沈黙・正典確定)
  }
}
// エラーハンドリング: validateエラー候補は読込時にops_logs(kind='rule_invalid')+候補除外。
// evaluate例外は当該候補のみfalse+error返却。Evaluator自身はthrowしない(全関数total)。
```

## 4. PatternMatcher(Hard層)

```typescript
// pipeline/PatternMatcher.ts
export interface MatchInput { candidates: Candidate[]; ctx: PatternContext;
  recentOutcomes: OutcomeLite[]; consentDm: boolean; nowJst: string; }
export interface MatchResult { eligible: Candidate[]; rejected: RejectedCandidate[]; }

export class PatternMatcher {
  constructor(private evaluator: JsonLogicEvaluator) {}

  match(input: MatchInput): MatchResult {
    // 順序固定(rejected.blockedByの正確性のため):
    // 0. lifecycleフィルタ: active/testing以外を除外(testingは適用50%判定:
    //    hash(customerId+code) % 2 — 乱数禁止・決定論)
    // 1. Hard gates(条件より先・blockedBy=Gate名):
    //    G-SUB:  kind==='subscription' && subscConditionsMet<4
    //    G-CHURN(O3): churnScore>0.7 && isSales → 除外(非販売は通す)
    //    G-COOL: CooldownController.isCoolingDown(同実装設計v1 §6・拒否後cooldownVisits)
    //            + DM: 同一30日/同群14日/7日1通(recentOutcomes+queue履歴)
    //    G-CONSENT/G-QUIET: channel==='dm' のみ
    // 2. Hard condition: evaluator.evaluateMany(残候補)
    // 3. Soft特徴の生値はここで「計算しない」(Scorerの責務・層の分離)
    // return { eligible, rejected }   ※G-FREQはResolverの枠割当で処理(候補段階では落とさない)
  }
}
```

## 5. PatternScorer(Soft層・FireScore)

```typescript
// pipeline/PatternScorer.ts
export class PatternScorer {
  score(eligible: Candidate[], ctx: PatternContext, stats: Map<string, CellStats>,
        weights: ScoringWeights, affinity: AffinityResolved, overrides: Overrides):
        ScoredCandidate[] {
    // 各候補:
    // S1 successRate*: cell=stats.get(cellKey(c, ctx.customerType, affinity.style))
    //    n>=10 → laplaceRate をベースライン比0-1正規化 / n<10 → prior 0.5(コールドスタート)
    // F  features:
    //    timing_proximity = exp(-((visitCount-optimalVisit)^2)/2)      // σ=1
    //    cycle_position   = clamp01(1-|cycleRatio-idealRatio(c)|)
    //    condition_margin = 例 subsc系: subscConditionsMet/4, churn系: 1-churn/0.7
    //    type_confidence / csi_alignment / skin_momentum = ctx.raw から0-1
    //    contextFit = Σ feature×c.softFeatures.weights(正規化)
    // U  urgency = {1:1.0, 2:0.7, 3:0.4, 4:0.2}[c.priorityClass]
    // boost: O2(storeOverrideCodes.has) → スコア比較免除フラグ / O1(manualPin) → ×1.5
    // churnPenalty: 0.5<churn<=0.7 && isSales → ×(1.4-churn)
    // fireScore = 100×clamp01(w1×S1 + w2×contextFit + w3×timing + w4×affinity + w5×U)
    //             × overrideBoost × churnPenalty
    // breakdown に各寄与値を必ず保存(Explainabilityの入力)
  }
}
// 重み・affinityはIParamsRepoから注入(コード定数化禁止・Brain学習の更新点①)
```

## 6. ConflictResolver(競合解決)

```typescript
// pipeline/ConflictResolver.ts
export class ConflictResolver {
  resolve(scored: ScoredCandidate[], slots = {inStore: 2, salesMax: 1, dm: 1}): Resolution {
    // Stage0 チャネル分割。dm側: 店内winnerと同種kindが存在→dm候補をblockedBy='exclusion'
    //         (superseded_by_instore はConnectorがtrigger_logへ記録)
    // Stage2 排他行列(Final v1.0 §2-2): 販売×販売/ケア×販売/ケア×実感共有(△は改善有無で判定)
    // Stage3 fireScore降順で枠詰め: 店内は販売1件まで・2枠目は非販売のみ
    //         O2フラグ候補は同code帯で常勝(スコア比較スキップ)
    // Stage4 タイブレーク(決定論固定): urgencyClass→cellのn→version→code辞書順
    // 不変条件assert(v2.0 §2)を出口で検証。違反=即throw(EngineInvariantError・バグ検知)
  }

  /** パターン割当の競合(A1×C1)— 別エントリ */
  resolveAssignment(patterns: Candidate[], ctx: PatternContext,
      progress: PatternProgress | null): AssignmentDecision {
    // assignScore = condition_margin × typeConfidence × タイプ優先重み(A>C>B>D)
    // 初回: 最大採用 / 進行中: hysteresis —
    //   newScore > currentScore+0.15 を switch_streak>=2 で確認 or stalled時のみ切替
    //   switch_streakの増減はprogress行(switch_candidate/switch_streak)に永続化(Repo経由)
  }
}
```

## 7. StaffAdjustmentEngine(3作用点)

```typescript
// pipeline/StaffAdjustmentEngine.ts
export interface AffinityResolved { style: StaffStyle;
  perKind: Map<ProposalKind, number>;        // 0-1(実測EWMA優先・なければstyle prior)
  timingOffsets: Map<string, number>;        // `${patternCode}:${kind}` → offset
  constraints: { mandatoryMax: number;       // 亀山=1(他=1。将来可変)
                 subscriptionStyle?: 'document_handover' } }  // 外舘C型固定

export class StaffAdjustmentEngine {
  /** 作用点1: 採点前 — offsetの仮context生成(fire_condition不変・正典確定) */
  applyTimingOffset(ctx: PatternContext, c: Candidate, off: AffinityResolved): PatternContext;
  /** 作用点2: 採点中 — w4入力の解決(affinity_score実測 > style_affinity prior) */
  resolveAffinity(staff: Staff, adjustments: StaffAdjustment[],
                  priors: StyleAffinityTable): AffinityResolved;
  /** 作用点3: 出力時 — 文体・制約(ScriptComposer連携) */
  applyOutputStyle(proposal: ScoredCandidate, off: AffinityResolved):
    { scriptStyle: StaffStyle; constraintsApplied: string[] };
  // 3名の初期値はシード(brain_staff_adjustments)が正。本クラスは「読むだけ」—
  // 値の更新はStaff Learning Engine(Brain接続点②)がrevision経由で行う。
}
```

## 8. ProposalGenerator(オーケストレータ・v2.0)

```typescript
// ProposalGenerator.ts
export interface GeneratorDeps { candidateRepo: ICandidateRepo; statsRepo: IStatsRepo;
  paramsRepo: IParamsRepo; outcomeRepo: IOutcomeRepo;
  matcher: PatternMatcher; scorer: PatternScorer; resolver: ConflictResolver;
  staffAdjust: StaffAdjustmentEngine; explain: ExplainabilityEngine; clock: () => string; }

export class ProposalGenerator {
  constructor(private d: GeneratorDeps) {}

  /** 公開API(唯一のエントリ)。バッチ/オンデマンド両用 */
  async generateFinalProposalSet(bundle: ContextBundle, staff: Staff):
      Promise<FinalProposalSet> {
    // 1. ctx = PatternContextBuilder.build(bundle, this.d.clock())
    // 2. candidates = candidateRepo.loadActive(storeId)   ← processキャッシュ(§10)
    // 3. assignment = resolver.resolveAssignment(...)     ← パターン切替判定
    // 4. off = staffAdjust.resolveAffinity(...)
    //    ctxPerCandidate = offset適用(対象候補のみ仮context)
    // 5. matchResult = matcher.match(...)
    // 6. stats = statsRepo.loadCells(eligibleのセルのみ)   ← IN句1クエリ
    // 7. scored = scorer.score(...)
    // 8. res = resolver.resolve(scored)
    // 9. 出力合成:
    //    nextAction = NextActionGenerator.build(res.inStore, ctx, staff, bundle.bookings)
    //                  // candidateDate式: v2.0 §4-2(E型逆算/0.3引戻し/営業日丸め)
    //    homecare  = res.inStore販売がhomecare系なら HomeCareGenerator.select(ctx, bundle)
    //                  // C型保湿固定/拒否カテゴリ除外/dryness>=4強制/価格帯
    //    dmHandoff = LineScenarioConnector.plan(res, ctx)
    //                  // 同種抑止通知/未成立引継予約/Pin顧客DM停止(起票はSelector側)
    // 10. ex = explain.explain(matchResult, scored, res, ctx)
    // 11. return FinalProposalSet(v2.0 §2の出力契約+不変条件assert)
  }
}
// NextActionGenerator / HomeCareGenerator / LineScenarioConnector は同ファイル群の
// 兄弟クラス(engines/proposal/)。本書ではGenerator内の呼出契約のみ確定し、
// 内部はProposal Generator v2.0 §4/§5/§6の疑似仕様を実装する。
```

## 9. ExplainabilityEngine

```typescript
// pipeline/ExplainabilityEngine.ts
export class ExplainabilityEngine {
  explain(m: MatchResult, scored: ScoredCandidate[], r: Resolution,
          ctx: PatternContext): { record: DecisionRecord; texts: ExplainTexts } {
    // record: 全候補×{stageReached, gates, breakdown, decisiveFactor, marginToWinner}
    //   decisiveFactor = 採用候補: breakdown最大寄与項 / 不採用: blockedBy
    // texts(決定論テンプレ・LLM不使用):
    //   staffLine1(なぜ今日か) / staffAvoid(避けること) /
    //   managerQ1Q2Q3(発火理由/落選理由/決定打) — 日本語辞書はconstants.EXPLAIN_DICT
    // 生成失敗(辞書欠損等)はthrowせずフォールバック定型文+ops_logs(GUARD扱いにしない—
    //   説明欠損で提案を止めない。学習起票のevidence欠損とは扱いが異なる点に注意)
  }
}
```

## 10. データフロー・実行順序・キャッシュ戦略

```
[起動時/version変化時]                    [評価時(1顧客)]
candidateRepo.loadActive ──┐              ContextBundle(RPC 1クエリ)
paramsRepo.weights/affinity┤→ processCache  → build ctx → assignment → match
  (TTL: version列比較・     │              → statsRepo.loadCells(IN句 1クエリ)
   brain_params更新で失効)  ┘              → score → resolve → 出力合成 → explain
                                          DBアクセス合計: 2クエリ(性能予算: <50ms/顧客)
夜間バッチ: 翌日予約者をバルクループ(候補・params・affinityは冒頭1回)
オンデマンド: 同パイプライン(processCache hit前提で<700ms)
```

| キャッシュ | 内容 | 失効 |
|---|---|---|
| processCache(メモリ) | 候補マスタ・weights・style_affinity・EXPLAIN_DICT | version/updated_at比較(評価ごとに軽量HEAD)・最大TTL 10分 |
| validationCache | ルール検証結果 | 候補マスタ失効と連動 |
| ContextBundle | キャッシュしない(肌・churnは来店ごとに変わる) | — |

## 11. エラー処理戦略(クラス別)

| 層 | 方針 |
|---|---|
| JsonLogicEvaluator | throwしない(total function)。error付きfalse返却 |
| Matcher/Scorer/Resolver | 候補単位の異常は当該候補をrejected(blockedBy='condition', detail)に隔離し続行。**パイプライン全体は1候補の異常で死なない** |
| Resolver出口 | 不変条件違反のみthrow(EngineInvariantError)— バグは隠さない |
| ProposalGenerator | catch → EngineDegradedResult(空提案+explanation定型文)を返しdegraded扱い。呼出側(BE1/バッチ)がevaluation_queue起票(Event Flow準拠)。**throwを外に漏らさない** |
| Repository | 接続エラーはRepoがthrow → Generatorのcatchで吸収(上記) |

## 12. Unit Test観点(ファイル1:1+統合)

| ファイル | 必須観点 |
|---|---|
| JsonLogicEvaluator | 未知演算子/未知変数/例外→false/evaluateManyのdata1回変換/validationCache hit |
| PatternMatcher | Gate順序(G-SUB→G-CHURN→G-COOL)とblockedBy正確性/testing 50%の決定論(hash)/lifecycle除外 |
| PatternScorer | 5項の数値一致(手計算フィクスチャ)/prior 0.5/churnペナルティ境界(0.5, 0.7)/O1×1.5/重み注入 |
| ConflictResolver | 排他行列全セル/販売1件繰上げ/タイブレーク④まで/不変条件throw/ヒステリシス(streak=1不切替・2切替・stalled即) |
| StaffAdjustmentEngine | offset仮context(原ctx不変)/実測>prior優先/外舘C型document_handover/亀山mandatory=1 |
| ProposalGenerator | DI全モックでの順序検証/Repo throw→DegradedResult/2クエリ予算(モック呼出回数)/決定論(同入力100回一致) |
| 統合(scenario.*.test) | 8パターン完走+T-1〜T-10+T-A〜E(正典テストの全継承) |

## 13. Brain Evolution接続点(将来結線・本実装ではinterfaceのみ)

| # | 接続点 | 本実装での準備 |
|---|---|---|
| ① | fire_score_weights学習(Lv3) | weightsをIParamsRepo注入に(済)。breakdownをoutcomesへ書く(fire_score/decisive_factor列) |
| ② | affinity/timing_offset学習(Lv2) | StaffAdjustmentEngineは読取専用(済)。実測EWMA列(affinity_score)を優先参照 |
| ③ | lifecycle遷移(Promotion) | MatcherのlifecycleフィルタとtestingのA/B 50%が受け皿(済) |
| ④ | optimal_visit再推定 | softFeatures.optimalVisitをデータ駆動(候補JSONB)に(済・コード定数なし) |
| ⑤ | counterfactual学習(将来) | rejected全件のmarginToWinner保存が資産(DecisionRecord) |

---
*Pattern Engine Code Architecture v1.0 — 上記6+2クラスの実装はこのシグネチャと疑似コードを正とし、Claude Codeはtests/のスケルトン作成から着手すること(テスト先行・Roadmap横断ルール5)。*
