# Brain Learning Code Architecture v1.0

**株式会社martylabo / Salon Riora — 学習層 実装直結Code Architecture**
作成日: 2026-06-11
正典遵守: Brain Evolution v1.0(学習信号・状態機械・Safety)/ Success Pattern Final v1.0(lifecycle)/ Master Schema v1.0–v1.3 / Event Flow v1.0(月次バッチ)。Engine 3部(Pattern/Scenario/Repository)の規約を継承(DI・pure・lint・テスト先行)。

---

## 1. ディレクトリ・クラス構成

```
src/engines/learning/
  core/
    LearningSignals.ts        # S1-S4算出・Wilson・EWMA・winsorize(統計基盤・全クラス共有)
    SafetyGuards.ts           # freeze・予算制・充足判定・振動検知・異常期間除外
    learning.constants.ts     # 全閾値(brain_params 'lifecycle_thresholds'で上書き可能な初期値)
  LearningScheduler.ts        # 月次オーケストレータ(monthly-learningの本体)
  EvidenceBuilder.ts          # evidence標準スキーマ+日本語テンプレ
  PromotionEngine.ts          # candidate→testing→active(昇格系)
  DemotionEngine.ts           # active→watch→demoted / any→suspended(降格・停止系)
  RevisionGenerator.ts        # 起票の唯一の出口(Lv4・予算・冪等)
  StaffAffinityLearner.ts     # スタッフセル学習(affinity/timing/style)
src/repositories/
  interfaces.learning.ts      # ILearningStatsRepo / IRevisionRepo / ILearningRunRepo
tests/engines/learning/
```

依存方向: Scheduler → (Promotion/Demotion/StaffAffinity) → EvidenceBuilder → RevisionGenerator → IRevisionRepo。**起票はRevisionGenerator以外から不可**(lint: IRevisionRepo importはRevisionGeneratorのみ)。

## 2. 学習データ変換(提案4種 × 結果6種 → 信号)

学習の入力は全て既存テーブル(新規取得なし)。変換表が本書の心臓部:

| 提案種別 | 成功 | 失敗 | 拒否 | 離脱 | リピート | LTV |
|---|---|---|---|---|---|---|
| **店内提案**(proposal_outcomes) | was_accepted=true → S1分子 | was_executed & !accepted → S1分母のみ | homecare_declined / subscription却下 → S1負例+cooldown教師 | 提案後の顧客churn確定 → 当該セルのS3ペナルティ帰属 | 提案受諾者の90日再来店 → S3 | 提案後180日売上+MRR×6 → S4(winsorize) |
| **LINE提案**(scenario_outcomes) | booking_within_14d=true → S1 | sent & !booking_14d → S1分母 | 承認者reject(was_approved=false) → 別系列「却下率」(停止条件③専用・S1に混ぜない) | 送信後30日内churn確定 → S3帰属 | 送信後90日再来店 → S3 | revenue_within_30d band → S4補助 |
| **HomeCare提案**(retail系) | homecare_purchased+retail_category → カテゴリ別S1 | 提案実行・未購入 | homecare_declined(カテゴリ記録) | — (店内に帰属) | HC購入者の90日リピート → S3(「売って客が減る」検知) | retail継続購入額 → S4 |
| **NextAction(candidateDate)**(bookings突合) | 提示候補日±3日内のin_salon予約成立 → 採用率(S1相当) | rebooking実行・予約なし | no_booking_reason='cold' → S1負例 | 予約なし退店→離脱確定 → S3 | candidateDate採用者の周期遵守率 → S2(周期誘導の質) | — |

**S2(成功率=受諾後のstep前進)**は店内・LINE共通: 受諾後30日内のpattern_progress前進有無をoutcomes×progress突合で算出。
**離脱の帰属ルール**: churn確定顧客の「直近90日に受けた提案セル全て」へ均等按分でS3ペナルティ(単一犯人探しをしない・按分は決定論)。

## 3. core/LearningSignals.ts(統計基盤)

```typescript
export interface SignalSet { s1: Metric; s2: Metric; s3: Metric | null; s4: Metric | null; }
export interface Metric { value: number; baseline: number; deltaPt: number;
  n: number; ci95Low: number; ci95High: number; mature: boolean; }

export class LearningSignals {
  /** Wilson score interval(95%・z=1.96)— 改善判定の唯一の方法 */
  static wilson(successes: number, n: number, z = 1.96):
      { low: number; high: number; point: number } {
    // p̂=s/n; denom=1+z²/n; center=(p̂+z²/2n)/denom;
    // margin=z*sqrt(p̂(1-p̂)/n + z²/4n²)/denom; → {low:center-margin, high:center+margin}
    // n=0 → {low:0, high:1, point:0.5}(prior一致)
  }
  static laplace(accepted: number, executed: number): number;        // (a+1)/(e+3)
  static ewma(current: number, prev: number | null, lambda = 0.7): number;
  static winsorize(values: number[], pct = 0.05): number[];
  static seasonAdjust(metric: Metric, yoySame: Metric | null, rolling3m: Metric): Metric;
  /** セル→SignalSet合成(成熟度判定: S3はsent+90日経過、S4は+180日経過分のみ) */
  static buildSignalSet(cell: RawCellData, baseline: BaselineData): SignalSet;
  static learningScore(s: SignalSet): number;
  // 0.35×s1'+0.20×s2'+0.25×s3'+0.20×s4'(未成熟は成熟分で重み再正規化・z値→0-1)
  /** Multi-Horizon Guard(正典の最重要ルール) */
  static multiHorizonGuard(s: SignalSet): { passed: boolean; reason: string } {
    // s1.deltaPt>=+10 でも s3が成熟かつ s3.deltaPt<=-5 → {passed:false,
    //   reason:'受諾率は高いが90日リピートが悪化(押し売り検知)'}
    // s3未成熟 → {passed:true, reason:'S3未成熟のため保留判定なし(testing継続)'}
  }
}
```

## 4. core/SafetyGuards.ts

```typescript
export class SafetyGuards {
  constructor(private params: IParamsRepo) {}
  async isFrozen(storeId: UUID): Promise<boolean>;            // brain_params 'learning_freeze'
  /** 予算制: 月5件/店・同一候補は四半期1件(suspended除外) */
  checkBudget(drafts: RevisionDraft[], history: RevisionHistory): {
    within: RevisionDraft[]; deferred: RevisionDraft[] };     // 超過はLearningScore順で繰越
  /** データ充足: insufficient(<10)/emerging(10-19)/sufficient(>=20) */
  sufficiency(n: number): 'insufficient' | 'emerging' | 'sufficient';
  /** 振動検知: lifecycle履歴でactive⇄watch往復2回 → unstable */
  detectOscillation(history: LifecycleHistory): boolean;
  /** 異常期間除外: business_settings.anomaly_periods と重なるoutcomesを除外 */
  filterAnomalyPeriods(rows: OutcomeRow[], periods: AnomalyPeriod[]): {
    kept: OutcomeRow[]; excludedPeriods: AnomalyPeriod[] };
}
```

## 5. PromotionEngine / DemotionEngine

```typescript
// PromotionEngine.ts(昇格系: candidate→testing→active, watch→active復帰)
export class PromotionEngine {
  evaluate(cells: Map<CellId, SignalSet>, candidates: CandidateMeta[],
           guards: GuardState): PromotionDecision[] {
    // testing→active: LearningScore上位 && s1.ci95Low > baseline(Wilson下限判定)
    //   && s1.deltaPt>=+10 && multiHorizonGuard.passed && n>=20 && 60日経過
    //   → decision{type:'promote', evidenceInput}
    // watch→active復帰: 2評価期連続 s1>=p25(各n>=15)
    // candidate→testing は人間承認のみ(本エンジンは起票しない)
  }
}
// DemotionEngine.ts(降格・停止系)
export class DemotionEngine {
  evaluate(...): DemotionDecision[] {
    // active→watch(自動・auto_applied): s1<p25 or 単月-20pt急落 or s3単独-8pt(n>=20)
    // watch→demoted(承認制): watch90日継続+改善なし
    // any→suspended(即時自動): Lv4違反検出 / s1<10%(n>=15) /
    //   却下率>50%(n>=10・LINE系列) / s3<BL-15pt(n>=15) / unstable(振動2回)
    // suspendedは予算制の対象外(安全方向は無制限)
  }
}
```

## 6. EvidenceBuilder.ts

```typescript
export class EvidenceBuilder {
  build(decision: LifecycleDecision | TuningDecision, signals: SignalSet,
        meta: BuildMeta): Evidence {
    // 正典スキーマ(Evolution §7-1): metrics/period(excluded_periods明示)/
    // comparison/multi_horizon_check/decision_path/source_records(stats_snapshot_id)
    // 必須フィールド欠損 → throw EvidenceIncompleteError
    //   (RevisionGeneratorがcatch→当該起票を中止+ops_logs。「説明できない変更は存在できない」)
  }
  toJapanese(e: Evidence, kind: DecisionKind): string;
  // 昇格/降格/停止/スタッフ調整の4テンプレ(Evolution §7-2の文面を定数辞書化)
  buildMonthlyReport(run: LearningRunSummary): LearningReport;
  // 起票/承認/auto_applied/停止/予算消化/guard遮断/blockedBy分布 → ai_insights(kind='learning_report')
}
```

## 7. RevisionGenerator.ts(起票の唯一の出口)

```typescript
export class RevisionGenerator {
  constructor(private lv4: Lv4Guard, private guards: SafetyGuards,
              private evidence: EvidenceBuilder, private repo: IRevisionRepo) {}

  async generate(decisions: Decision[], ctx: RunContext): Promise<GenerateReport> {
    // 0. freeze: guards.isFrozen → 全decision記録のみ(report.frozen=true)・起票ゼロ
    // 1. 各decision → draft化(before=現在値スナップショット, after, change_type, scope)
    // 2. Lv4 Guard(全draft・違反は破棄+ops_logs 'guard_violation'・本番痕跡なし)
    // 3. evidence組立(EvidenceIncompleteError → 当該中止)
    // 4. 冪等: revision_idem_key = hash(target_uid, change_type, period.from, period.to)
    //    既存(proposed/approved/rejected問わず同key) → skip(再実行安全)
    //    ※brain_revisionsにidem_key列(Master Schema v1.4=W11差分・UNIQUE)
    // 5. 予算制: checkBudget → within起票 / deferred記録(翌月繰越リスト)
    // 6. 自動度分岐: watch遷移・affinity微小更新 → status='auto_applied'+即apply(RPC)
    //    suspended → 即apply+ai_insights通知 / それ以外 → status='proposed'
    // 7. rollback生成(approve済の取消要求時): change_type='rollback'のdraft自動生成
    //    (before=現在値, after=元revision.before)→ Lv4再通過→before照合はRPC側
  }
}
```

## 8. StaffAffinityLearner.ts

```typescript
export class StaffAffinityLearner {
  learn(cells: Map<StaffCellId, SignalSet>, current: StaffAdjustment[],
        execStats: ExecutionStats[]): StaffDecision[] {
    // affinity更新: 新affinity=ewma(セルs1正規化, 現affinity_score)
    //   |差分|<0.1 → auto_applied(微小) / >=0.1 → proposed(Lv2)
    // timing_offset提案: 当人の受諾visit_count_at最頻値が基準と2期連続ズレ && n>=10
    // 実行率保留(亀山対策): 当月実行率<60%のスタッフはtiming学習をskip
    //   (未実行はタイミングの教師にならない・decision_pathに'exec_rate_hold'記録)
    // 多地平保護(外舘対策): s1低くてもs3/s4がBL+5pt以上のセルはdemotion対象から除外
    // 出力は順位情報を一切含まない(差分と根拠のみ・正典規律)
    // Brain送出はstyle単位(個人名は店舗内・ETL側で変換済みのため本クラスは関知しない)
  }
}
```

## 9. LearningScheduler.ts(月次オーケストレータ)

```typescript
export class LearningScheduler {
  async run(storeId: UUID, runDate: DateStr): Promise<LearningRunSummary> {
    // 0. run登録: learning_runs(冪等: UNIQUE(store_id, run_month)・再実行は前回runを
    //    superseded化して新run — statsスナップショット再現性のためrun_idを全成果物に刻印)
    // 1. matview REFRESH(pattern_step_stats CONCURRENTLY)→ snapshot_id確定
    // 2. 異常期間除外 → セル生データ収集(店内/LINE/HC/NextActionの変換§2)
    // 3. signals = 全セルbuildSignalSet(EWMA前回値はlearning_runsから)
    // 4. 並列評価(各エンジン独立try・1エンジン失敗で他を止めない):
    //    PromotionEngine / DemotionEngine / StaffAffinityLearner /
    //    (Phase2: StoreLearning系・本書ではフックのみ)
    // 5. RevisionGenerator.generate(全decisions)
    // 6. churn確定ラベル+予測精度 → ai_insights
    // 7. EvidenceBuilder.buildMonthlyReport → ai_insights(kind='learning_report')
    // 8. run完了記録(成功/失敗エンジン・所要・起票数)
  }
}
// 店舗学習とブランド学習の境界(実行面の確定):
//  store scope: 本Scheduler(storeId必須・proposal/scenario_outcomesを直接読む)
//  brand scope: BrainScheduler(別エントリ・Phase3): brain_eventsのみを読み、
//    decisionのscope='brand'・A/B test_design必須。**同一クラス群を再利用し
//    入力Repoだけ差し替える**(ILearningStatsRepoのbrain実装)— コード二重化禁止
```

## 10. DTO / Event定義(抜粋)

```typescript
export interface CellId { candidateUid: UUID; customerType: CustomerType;
  staffStyle: StaffStyle; channel: 'in_store'|'dm'; }
export interface RevisionDraft { idemKey: string; scope: 'store'|'brand';
  changeType: ChangeType; targetUid: UUID; before: Json; after: Json;
  evidence: Evidence; autoApply: boolean; originEngine: string; }
export interface LearningRunSummary { runId: UUID; snapshotId: UUID;
  cellsEvaluated: number; decisions: number; proposed: number; autoApplied: number;
  suspended: number; deferred: number; guardBlocked: number; frozen: boolean;
  engineFailures: Array<{engine: string; error: string}>; }
// Event(ops_logs kind統一): 'learning_run_start'/'learning_run_done'/
// 'guard_violation'/'evidence_incomplete'/'engine_failure'/'budget_deferred'
```

## 11. 冪等性・エラー・ログ・キャッシュ

| 関心 | 設計 |
|---|---|
| 冪等 | ①run単位: UNIQUE(store_id, run_month)+再実行はsuperseded ②起票単位: idem_key UNIQUE ③auto_applied: apply RPCのbefore照合が二重適用を拒否 |
| エラー | エンジン単位隔離(1エンジン失敗→他続行・engineFailuresに記録)。EvidenceIncomplete=当該起票中止。Scheduler全体失敗=run失敗記録+翌月 or 手動再実行(店舗運用に影響ゼロ・Event Flow準拠) |
| ログ | ops_logsの6 kind(§10)。成功セルは記録しない(learning_reportに集計のみ)。guard_blocked件数の急増はlearning_reportで可視化 |
| キャッシュ | run内メモリのみ(signals/baseline/params)。**run跨ぎキャッシュ禁止**(snapshotの再現性が正)。EWMA前回値はlearning_runs永続値から(キャッシュではなくデータ) |

## 12. テスト戦略

| 対象 | 必須ケース |
|---|---|
| LearningSignals | Wilson境界(n=0→prior/n=20既知値の数値一致)/EWMA λ=0.7/winsorize 5%/未成熟の重み再正規化/multiHorizonGuard 3分岐(S1良S3悪=block・S3未成熟=pass・両良=pass) |
| Promotion/Demotion | 昇格5条件のAND(各1欠けで非起票)/Wilson下限>BL判定(点推定超えでも下限未満なら非昇格)/watch自動・demoted承認制の分岐/suspended 5条件各1/振動unstable |
| RevisionGenerator | freeze全停止/idem_key再実行skip/予算5件目まで起票・6件目deferred・suspended予算外/Lv4破棄+痕跡なし/evidence欠損中止/rollback draft生成 |
| StaffAffinityLearner | 微小auto_applied・0.1以上proposed/実行率60%保留/外舘保護(s1低s3高で非降格)/順位情報非含有(出力スナップショット検査) |
| Scheduler | エンジン1つ例外→他3完走+failures記録/run再実行superseded/snapshot_id全成果物刻印 |
| 統合E2E | 合成6ヶ月outcomes→run→起票3件→approve(RPC)→翌朝候補のlifecycle/affinityが変化→Pattern Engineの発火が変わる(学習ループ閉鎖の自動検証) |

## 13. Engine連携の確定(接続点の実装対応)

| 連携先 | 本書の実装 |
|---|---|
| Pattern Engine | lifecycle_status/affinity_score/timing_offsetの更新元(revision経由)。fire_score/decisive_factor(outcomes列)を較正回帰の将来入力として収集のみ開始 |
| Proposal Generator | candidateDate採用率(§2 NextAction行)とHomeCareカテゴリ実績の学習が新規。decision_record(rejected margin)はPhase2のcounterfactual用に保全のみ |
| Scenario Engine | successScore月次上書き(auto_applied)・blockedBy分布監視・suppression調整はLv4制約下のproposedのみ |

---
*Brain Learning Code Architecture v1.0 — 学習層実装の唯一の正。Master Schema v1.4(W11: learning_runs+idem_key)を本書採用と同時に発行。これでRiora OS全コード層(判定・DM・データアクセス・学習)のCode Architectureが完結する。*
