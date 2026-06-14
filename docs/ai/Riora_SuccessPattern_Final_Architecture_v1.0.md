# Riora Success Pattern System Final Architecture v1.0

**株式会社martylabo / Salon Riora — 成功パターンシステム 最終強化設計(Rioraの頭脳・確定版)**
作成日: 2026-06-11
正典関係: Master Schema v1.0 / API Architecture v1.0 / Event Flow v1.0 に準拠。本書はPattern Engineの判定・採点・競合・昇降格・説明性の唯一の正。Pattern Engine実装設計v1を**上書き拡張**する(矛盾時は本書優先)。

## 0. 対象の整理(「54パターン」の正規化)

発火候補は2層あり、本書のエンジン群は**両層を同一の採点・競合・説明基盤で扱う**:

| 層 | 候補 | 出口 |
|---|---|---|
| 店内提案 | 8パターン(A1〜E1)× pattern_steps(計約30 step) | ブリーフィング |
| LINE/DM | brain_scenarios 60本 | line_send_queue |

以後「候補(Candidate)」= step または scenario。約90の候補空間に対する統一判定系を定義する。

---

# 1. Pattern Scoring Engine(採点エンジン)

## 1-1. 二層condition設計(多変量対応の核)

従来のfire_condition(boolean)だけでは「発火するか」しか分からず、同時発火時の優劣が決められない。**Hard条件(資格)とSoft特徴(適合度)に分離**する:

```
Hard condition(JSON Logic・boolean)= 発火資格。1つでも不成立なら候補から除外
Soft features(連続値0–1の特徴ベクトル)= 発火の「強さ」。FireScoreの入力
```

Soft特徴の標準セット(候補ごとにJSON定義・省略時はデフォルト):

| 特徴 | 算出 | 意味 |
|---|---|---|
| timing_proximity | exp(−((visit_count − optimal_visit)² / 2σ²))、σ=1 | 最適提案回からの近さ(ガウス近接) |
| cycle_position | 1 − |cycle_ratio − ideal_ratio| をクリップ | 周期上の今の位置(DM系) |
| condition_margin | Hard条件の余裕度(例: subsc_conditions_met/4, churnの閾値距離) | ギリギリ成立か余裕成立か |
| type_confidence | customers.type_confidence | タイプ分類の確信度 |
| csi_alignment | 候補が要求するCSI帯への適合 | 関係資産系の適合 |
| skin_momentum | 直近2回のprimary_delta改善勾配(正規化) | 改善の勢い(実感共有・提案期に効く) |

## 1-2. FireScore計算式(確定)

```
適格候補のみ採点(Hard通過後):

FireScore = 100 × clamp01(
    w1 × SuccessRate*            // 実績(その候補×タイプ×styleセルのlaplace成功率を
                                  //  ベースライン比で0–1正規化。n<10はprior=0.5)
  + w2 × ContextFit              // Soft特徴の加重平均(候補定義のfeature_weights)
  + w3 × TimingProximity         // 上表(単独項に昇格・最重要特徴のため)
  + w4 × StaffAffinity           // style_affinity(brain_params)×staff_adjustments反映後
  + w5 × Urgency                 // priorityクラス→{1:1.0, 2:0.7, 3:0.4, 4:0.2}
) × OverrideBoost                // 1-4のoverride乗数(既定1.0)

初期重み w = [0.30, 0.20, 0.20, 0.15, 0.15]
保管: brain_params(key='fire_score_weights', cluster別)。学習による更新はLv3(brand)起票対象。
```

設計判断: 重みはコード定数にしない(将来の自動学習でクラスタ別に進化させるため)。SuccessRate*のpriorを0.5に固定することで、新候補が「実績ゼロだから永遠に選ばれない」コールドスタート問題を回避する。

## 1-3. Hard gate(採点前の絶対関門・スコアで覆せない)

| Gate | 条件 | 根拠 |
|---|---|---|
| G-SUB subscription gate | proposal_kind='subscription' は subsc_conditions_met=4 必須 | 押し売りしない原則の中核 |
| G-CHURN churn override | churn_score>0.7 → 非販売(rebooking/関係修復/停滞ケア)のみ適格 | 離脱局面で売らない |
| G-COOL cooldown | 拒否後2来店 / 同一30日 / 同群14日 / 7日1通(DM) | Scenario仕様v1継承 |
| G-FREQ 提案上限 | 店内: 1来店最大2件(販売系は最大1件※本書で精密化) / DM: 1通 | |
| G-CONSENT/G-QUIET | DM: 同意・静音時間・expires | |

**G-FREQ精密化(新規確定)**: 従来「最大2件」のみだったが、**販売系(homecare/subscription/upsell/pack)は1来店1件まで**に強化。2枠目は非販売(rebooking/実感共有系)のみ充当可。

## 1-4. Override体系(3種・優先順)

| Override | 発動者 | 効果 | 制約 |
|---|---|---|---|
| O1 Manual Pin | Manager(顧客詳細から「次回この提案」指定) | 対象候補のOverrideBoost=1.5+isMandatory強制 | Hard gateは**突破不可**(G-SUBを人間も外せない)。有効期限=次回来店1回限り |
| O2 Store Override | 店舗オーバーライド行(2層マスタ) | その店ではNULL行より常に優先(スコア比較しない) | Lv4 Guard通過必須 |
| O3 Churn Override | システム(G-CHURN) | 全販売候補を強制除外+停滞ケア候補のUrgency=1.0 | 解除はchurn_score<0.5復帰時 |

優先順: O3(安全) > Hard gates > O2(店舗定義) > O1(boost) > 通常スコア。

---

# 2. Conflict Resolution Engine(競合解決)

## 2-1. 解決カスケード(決定論・5段)

```
Stage 0: チャネル分離 — 店内候補とDM候補は競合しない(別出口)。ただし同一proposal_kindの
         店内+DM同日重複は禁止(店内が優先・DMはtrigger_logに'superseded_by_instore')
Stage 1: Hard gates適用(1-3) — 失格理由をblockedByに記録
Stage 2: 排他行列(2-2) — カテゴリレベルの共存禁止を解決
Stage 3: FireScore降順 — 枠数まで採用(店内2件[販売1まで]/DM1通)
Stage 4: 同点タイブレーク(決定論固定):
         ①Urgencyクラス小さい方 ②SuccessRateのn大きい方(実績の確かさ)
         ③候補version新しい方 ④候補ID辞書順(完全再現性の最終保証)
```

## 2-2. 排他行列

| | 販売系 | rebooking | 停滞/離脱ケア | 実感共有 |
|---|---|---|---|---|
| 販売系 | **×**(1件まで) | ○ | **×**(O3で販売消滅) | ○ |
| rebooking | ○ | −(同種1) | ○(ケア文面にrebooking内包可) | ○ |
| 停滞/離脱ケア | × | ○ | − | △(改善があるなら停滞ではない→ケア側を落とす) |
| 実感共有 | ○ | ○ | △ | − |

## 2-3. 指定3ケースの判定フロー(確定)

**ケース1: A1とC1が同時発火(パターン割当の競合)**

前提: brain_pattern_progress は顧客1人=1パターン(UNIQUE)。よってA1/C1競合は「step同時発火」ではなく**割当・切替の競合**として扱う。

```
発生条件: 混合悩み顧客(ニキビ+敏感)で両entry_conditionが成立
判定:
 1. AssignScore = entry_conditionのcondition_margin × type_confidence × タイプ別重み
 2. 初回割当: AssignScore最大を採用(同点はタイプ優先順 A>C>B>D ※炎症系優先の臨床的判断)
 3. 切替(既にA1進行中にC1が優勢化):
    ヒステリシス必須 — 新パターンのAssignScoreが現行+0.15を「2回の評価連続」で
    上回る、または現行がstalled_flag=true の場合のみ切替
    切替時: progress行をabandoned_reason='pattern_switched'でクローズ→新規行
    (頻繁な切替=学習データの汚染。揺らぎでは切り替えない)
```

**ケース2: サブスク提案とHC提案が同時発火**

```
 1. 両者とも販売系 → G-FREQ精密化により1件のみ採用
 2. 論理チェック: subscription適格(4/4)はHC購入済み(条件②)を含意
    → 同時発火しうるのは「追加HC提案」の場合のみ
 3. 解決: FireScore比較だが、実質 subscription が常勝
    (Urgency 0.7 vs 0.4 + timing_proximity: 4/4達成直後が最適点)
 4. 例外: subscriptionがG-COOL中(前回拒否)→ HC追加提案も抑制(販売連打防止)
    → この来店は非販売2枠(実感共有+rebooking)に自動転換
```

**ケース3: churnと販売提案が競合**

```
 1. churn_score>0.7 → O3発動。販売候補は採点前に全滅(blockedBy='churn_override')
 2. 採用候補 = 停滞/離脱ケア(Urgency=1.0強制)+rebooking内包文面
 3. 0.5<churn<=0.7のグレーゾーン: 販売候補は適格だが
    FireScoreにペナルティ乗数 ×(1.4 − churn)を適用(0.7時≒0.7倍)
    → ケア系が自然に勝ちやすいが、強い適合(例: 4/4達成)なら販売も通る連続的設計
 4. churn<0.5復帰後、初回来店は販売1件まで(通常ルール)に自動復帰
```

---

# 3. Promotion / Demotion Engine(昇格・降格)

## 3-1. 候補ライフサイクル(状態機械)

```
candidate → testing → active ⇄ watch → demoted → suspended
   (新規)    (限定適用)  (通常)   (監視)   (無効化)   (緊急停止)
```

brain_success_patterns / brain_scenarios に lifecycle_status 列を追加(5-1)。

## 3-2. 遷移条件(確定値)

| 遷移 | 条件 | 評価期間 | 必要n | 自動度 |
|---|---|---|---|---|
| candidate→testing | Lv4 Guard通過+承認(Lv2/Lv3) | — | — | 承認制 |
| testing→active(**昇格**) | 受諾率がベースライン(同タイプ同kindのactive平均)+10pt以上 かつ 90日リピート率が非悪化 | 60日 | executed>=20 | 自動起票→承認 |
| active→watch | 受諾率がベンチマークp25未満 または 受諾率20pt以上の急落 | 直近60日 | executed>=20 | **自動**(watchは無害) |
| watch→active(復帰) | 2評価期連続でp25以上 | 60日×2 | 各>=15 | 自動 |
| watch→demoted(**降格**) | watch 90日継続+改善なし | 90日 | executed>=20 | 自動起票→承認 |
| any→suspended(**停止**) | ①Lv4違反検出 ②受諾率<10%(n>=15) ③却下率(承認者)>50%(n>=10) ④クレーム/口コミ毀損の手動フラグ | 即時 | 左記 | **即時自動**(安全方向は無承認)+ai_insights通知 |
| demoted/suspended→candidate | 改訂版(version+1)として再起票 | — | — | 承認制 |

設計判断: **悪化方向(watch/suspended)は自動、改善方向(昇格)と恒久判断(降格)は人間承認**。「止めるのは速く、変えるのは慎重に」。リピート率の非悪化条件を昇格に含めるのは、受諾率だけ高い「押しの強い」候補が顧客生涯価値を毀損するのを防ぐため。

## 3-3. 月次評価ジョブ(monthly-learningに統合)

```
1. 候補×タイプ×styleセルの統計を pattern_step_stats(月次マテビュー・5-2)へ更新
2. 全候補に状態機械を適用 → 遷移を brain_revisions(change_type='lifecycle')起票
   (自動遷移分はstatus='auto_applied'で記録のみ・承認制分は'proposed')
3. testing中の候補は適用率50%制限(対象顧客の半数のみ・残りは現行active)
   → 60日後に対照比較で昇格判定(A/Bの店舗内ミニ版)
```

---

# 4. Explainability Engine(説明生成)

## 4-1. DecisionRecord(全評価の構造化記録)

ConflictResolver通過時に必ず生成し pattern_fire_log に保存(5-1で列拡張):

```
DecisionRecord = {
  candidates: [                      // 全候補(採用・不採用とも)
    { candidateId, kind, stage_reached,   // どのStageまで生き残ったか
      hard_gates: { passed: [...], failed: 'G-CHURN' | null },
      score_breakdown: { success_rate: 0.71×0.30, context_fit: 0.84×0.20,
                         timing: 0.95×0.20, affinity: 0.60×0.15, urgency: 0.70×0.15,
                         override_boost: 1.0, final: 76.3 },
      decisive_factor: 'timing_proximity', // 最大寄与項 or 失格Gate
      margin_to_winner: -8.2 }            // 採用候補とのスコア差(不採用側)
  ],
  resolution: { winner: [...], stage4_tiebreak_used: false },
  context_snapshot: PatternContext      // 判定時点の入力(再現性)
}
```

## 4-2. 説明文生成(決定論テンプレート・LLM不使用)

監査可能性のため、説明はテンプレートからの決定論生成に固定(LLMは使わない。Manager向けの物語化のみPhase2でai_insights側が担当)。3問に答える定型:

```
Q1 なぜ発火したか:
 「{candidate}を提案します。{decisive_factor文}」
 例: 「B1-step4(サブスク提案)。4条件がすべて揃い(条件達成 4/4)、
      提案最適回(4回目)に一致したためです(スコア76)」
Q2 なぜ他候補を落としたか:
 例: 「HC追加提案(スコア61)は販売枠1件の制限でサブスク提案を優先。
      停滞ケアは肌改善が継続中のため対象外」
Q3 何が決定打か:
 decisive_factor → 日本語辞書: timing_proximity='提案最適回との一致' /
 success_rate='同型顧客での実績(72%, n=18)' / G-CHURN='離脱リスクが高く販売を停止' ...
```

出力先: ①ブリーフィングのsuccessReference/avoidNote(スタッフ向け1行) ②GET /api/patterns/fire-log(Manager向け全文・デバッグ) ③revision evidenceの根拠引用(学習の説明責任)。

---

# 5. DB構造(Master Schema v1.0 → v1.1差分)

新テーブルは増やさない方針(Master Schemaの28本維持)。**既存5テーブルへの列追加+マテビュー1本**で実現:

## 5-1. 列追加(Master Schema v1.1としてW8マイグレーション)

| テーブル | 追加列 | 用途 |
|---|---|---|
| brain_success_patterns | lifecycle_status TEXT CHECK(6状態) DEFAULT 'active' / lifecycle_changed_at | 3章 |
| brain_scenarios | lifecycle_status / lifecycle_changed_at(同上) | 3章 |
| brain_pattern_steps | soft_features JSONB(特徴定義+feature_weights) / optimal_visit INT(timing_proximity中心) | 1-1 |
| brain_pattern_progress | assign_score NUMERIC / switch_candidate TEXT / switch_streak INT | 2-3ケース1のヒステリシス状態 |
| brain_proposal_outcomes | fire_score NUMERIC / decisive_factor TEXT | 学習とExplainの接続 |
| brain_staff_adjustments | affinity_score NUMERIC(実測更新値・1-2のw4入力) | 1-2 |
| pattern_fire_log | decision_record JSONB / explanation TEXT | 4章 |

brain_params追加キー: 'fire_score_weights' / 'lifecycle_thresholds' / 'style_affinity'(既存)。

## 5-2. pattern_step_stats(マテリアライズドビュー・月次REFRESH)

```
定義: brain_proposal_outcomes + scenario_outcomes を
 (candidate_id, candidate_version, customer_type, staff_style) で集計
 → executed_n / accepted_n / laplace_rate / repeat_rate_90d / avg_fire_score / period
REFRESH: monthly-learning冒頭(CONCURRENTLY)。
読取: PatternScorer(SuccessRate*)・PromotionEngine・ダッシュボードfunnel。
理由: 実テーブルへの集計クエリをリアルタイム経路から完全排除(Supabase負荷・iPhone速度)
```

## 5-3. クエリ設計(性能確定)

| 経路 | クエリ | 目標 |
|---|---|---|
| SaveVisitRecord BE1 | loadContextBundle 1本(JOIN5表)+stats読取1本(候補セルのみIN句) | 2クエリ・<150ms |
| 夜間ブリーフィング | 翌日予約者をバルク取得→顧客ループはメモリ内評価(候補・stats・paramsは冒頭1回ロード) | 顧客あたり追加クエリ0 |
| 部分INDEX追加 | brain_proposal_outcomes(candidate系集計用)は既存INDEX流用 / line_send_queue WHERE status='pending' 部分INDEX | W8に含める |

---

# 6. 実装成果物(Claude Code向け・責務定義)

配置: src/engines/pattern/(既存規約継承: pure・Supabase import禁止・lint強制)。**既存ProposalGeneratorは本5ファイルを束ねるオーケストレータに改修**(破壊的変更だが公開APIのgenerateProposalsシグネチャは維持)。

| ファイル | 責務 | 主要export(シグネチャ) |
|---|---|---|
| **PatternMatcher.ts** | Hard層: 候補空間→適格集合。Hard condition評価(JSON Logic共用)+Hard gates(G-SUB/G-CHURN/G-COOL/G-FREQ/G-CONSENT)+O3発動+blockedBy記録 | `match(candidates, ctx, outcomes, gates): { eligible: Candidate[]; rejected: RejectedCandidate[] }` |
| **PatternScorer.ts** | Soft層: 適格集合→FireScore。特徴ベクトル算出(1-1)+重み適用(brain_params注入)+O1/O2 boost+グレーゾーンchurnペナルティ | `score(eligible, ctx, stats, weights, overrides): ScoredCandidate[]` |
| **ConflictResolver.ts** | 5段カスケード(2-1)+排他行列(2-2)+割当競合・ヒステリシス(2-3ケース1)+決定論タイブレーク。**乱数・時刻依存の禁止**(同入力=同出力を保証) | `resolve(scored, slots): Resolution` / `resolveAssignment(patterns, ctx, progress): AssignmentDecision` |
| **PromotionEngine.ts** | 状態機械(3-1/3-2)。stats→遷移判定→revision draft生成(Lv4 Guard連携)。suspendedの即時自動適用判定 | `evaluate(stats, current: LifecycleStatus, thresholds): LifecycleTransition[]` |
| **ExplainabilityEngine.ts** | DecisionRecord組立(4-1)+日本語テンプレ生成(4-2)+decisive_factor判定(最大寄与項抽出) | `explain(matchResult, scored, resolution, ctx): { record: DecisionRecord; texts: ExplainTexts }` |

呼び出しフロー(ProposalGeneratorオーケストレーション):
```
candidates(2層解決済) → PatternMatcher.match → PatternScorer.score
 → ConflictResolver.resolve → ExplainabilityEngine.explain
 → 出力: FiredProposal[](店内/DM別) + DecisionRecord(fire_logへ) + blockedBy群
```

## 6-1. テスト必須項目(受入条件)

| # | テスト |
|---|---|
| T-1 | G-SUB: 3/4顧客のsubscription候補がスコア100相当でも失格 |
| T-2 | G-FREQ精密化: 販売系2候補同時→1件のみ。2枠目に非販売が繰上がる |
| T-3 | ケース1: A1進行中にC1優勢1回→切替なし、2回連続→切替+abandoned記録 |
| T-4 | ケース2: 4/4でsubscription>HC。subscriptionクールダウン中→非販売2枠転換 |
| T-5 | ケース3: churn=0.75で販売全滅 / 0.6でペナルティ0.8倍適用の数値一致 |
| T-6 | 決定論: 同一入力100回でresolution完全一致(タイブレーク④まで) |
| T-7 | Promotion: n=19で昇格非起票、n=20+10ptで起票 / 受諾9%(n=15)で即suspended |
| T-8 | Explain: 全採用候補にdecisive_factor非null・不採用全件にmargin_to_winner |
| T-9 | コールドスタート: 実績ゼロ候補のSuccessRate*=0.5でスコア成立 |
| T-10 | 性能: 合成90候補×顧客1名の全パイプライン < 50ms(Node環境) |

---

## 7. 学習進化の接続(将来の自動化ポイント)

| 進化対象 | 現在 | 学習経路 |
|---|---|---|
| fire_score_weights | 固定[0.30,0.20,0.20,0.15,0.15] | fire_score vs 実受諾の回帰でクラスタ別最適化(Lv3) |
| optimal_visit / soft_features | 設計値 | pattern_step_statsのvisit_count_at分布から再推定(Lv2) |
| lifecycle_thresholds | 3-2の固定値 | 誤昇格・誤降格の事後検証で調整(Lv3) |
| 排他行列 | 固定 | **学習対象外**(原則層。変更はLv4=人間起案のみ) |

---
*Riora Success Pattern System Final Architecture v1.0 — Pattern Engine判定系の唯一の正とする。Master Schema v1.1差分(W8)の発行を本書採用と同時に行うこと。*
