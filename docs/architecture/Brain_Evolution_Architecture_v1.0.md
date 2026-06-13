# Riora Brain Evolution Architecture v1.0

**株式会社martylabo / Salon Riora — 学習・進化システム 確定版**
作成日: 2026-06-11
正典関係: Master Schema v1.0(+v1.1差分) / Event Flow v1.0 / Success Pattern Final Architecture v1.0 に準拠。本書は**学習(何を・どう学び・どう変え・どう守るか)の唯一の正**。

## 0. 進化の基本構造

```
観測(outcomes/visits/skin/LTV)
 → 統計化(pattern_step_stats・月次)
 → 判定(各Learning Engine)
 → 起票(Brain Revision Engine・全変更がここを通る)
 → 承認(人間)→ 適用(version+1)→ 翌朝から発火に反映
 → 再観測(ループ閉鎖)
```

不変原則: **「学習の出口は全てrevision」**。どのエンジンもDBの発火定義を直接書き換えない。変更は必ず brain_revisions を経由し、evidence(根拠)・Lv4 Guard・承認・ロールバック可能性が機械的に保証される。

---

# 1. Pattern Learning Engine(候補の学習)

## 1-1. 学習信号の4階層(速度と真実度のトレードオフ)

| 信号 | 定義 | 観測ラグ | 性質 |
|---|---|---|---|
| S1 受諾率 | accepted/executed(laplace α=1,β=2) | 即日 | 速いがバイアスあり(押せば上がる) |
| S2 成功率 | 受諾後のstep前進率(受諾が次の行動に繋がったか) | 〜30日 | 提案の「質」 |
| S3 リピート率 | 提案を受けた顧客の90日再来店率 | 90日 | 関係毀損の検知器 |
| S4 LTV | 提案後180日の累計売上+サブスクMRR×6(残存期待の簡易係数) | 180日 | 最も遅いが最終真実 |

**統合評価式(候補×タイプ×styleセル単位)**:

```
LearningScore = 0.35×S1' + 0.20×S2' + 0.25×S3' + 0.20×S4'
 (各S'は同タイプ同kindのactive候補群を基準にしたz値→0–1正規化。
  S3/S4が未成熟[観測期間不足]のセルは、成熟分のみで重み再正規化)

多地平ガード(最重要ルール):
 S1がベースライン+10pt以上でも、S3がベースライン−5pt以下なら昇格起票を禁止し
 watch行きを起票する。「受諾は取れるが客が減る」候補を構造的に弾く。
```

## 1-2. 更新メカニクス

- セル統計はEWMA(月次・λ=0.7)で更新: `stat_t = 0.7×当月実測 + 0.3×stat_{t-1}`。古い成功に永遠に引きずられない・単月の偶然にも振られない
- 季節補正: 同指標の前年同月が存在すればYoY差分で評価、なければ直近3ヶ月移動平均比(開業1年目は後者固定)
- soft_features再推定(Lv2): optimal_visit = 受諾visit_count_at分布の最頻値(n>=20で起票)。fire_score_weights再回帰(Lv3): fire_score予測値と実受諾の較正回帰を四半期実行

# 2. Pattern Promotion Engine(昇降格の確定運用)

Final Architecture v1.0 3章の状態機械を継承し、本書で**LearningScoreベースに条件を統一**:

| 遷移 | 条件(v1.0からの更新) | n | 期間 | 自動度 |
|---|---|---|---|---|
| testing→active 昇格 | LearningScore上位かつ S1>=BL+10pt **かつ S3非悪化 かつ 多地平ガード通過** | executed>=20 | 60日 | 起票→承認 |
| active→watch | S1<p25 or 単月−20pt急落 or **S3単独で−8pt悪化**(S1が良くても) | >=20 | 60日 | 自動 |
| watch→demoted 降格 | watch90日+改善なし | >=20 | 90日 | 起票→承認 |
| any→suspended 停止 | Lv4違反 / S1<10%(n>=15) / 却下率>50%(n>=10) / **S3<BL−15pt(n>=15)** / 手動フラグ | 左記 | 即時 | 即時自動+通知 |

追加確定: **振動防止** — 同一候補のlifecycle変更は四半期1回まで(suspendedのみ例外)。active⇄watchを毎月往復する候補は「不安定」フラグでdemoted起票。

# 3. Staff Learning Engine(スタッフ別適性学習)

## 3-1. 学習の単位と出口

学習単位は(staff × customer_type × proposal_kind)セル。出口は3つ、**全てLv2 revision経由**:

| 出力 | 対象 | 起票条件 |
|---|---|---|
| affinity_score更新 | brain_staff_adjustments.affinity_score(FireScoreのw4入力) | EWMA月次・差分>=0.1で起票(それ未満はauto_applied記録のみ) |
| timing_offset提案 | 同.timing_offset | 当人の受諾分布最頻値が基準と2回以上ズレ・n>=10 |
| script_style検証 | 同.script_style | 当人styleと別styleの代行成績比較(Phase2・ブリーフィング文面A/B) |

## 3-2. 3名への初期最適化(現有データ+設計知見の事前分布)

| スタッフ | 事前分布(prior) | 学習で検証する仮説 | 守りの設定 |
|---|---|---|---|
| 鈴木(evidence) | A/E affinity高・タイミング=基準値(基準の出所が鈴木実績) | 「鈴木基準が他者に最適か」— 鈴木セルと全体セルの乖離を常時計測 | 代表業務での実行率低下を検知したらisMandatory絞り込み(1件)を提案 |
| 亀山(theory) | D affinity最高・A/CのHC提案+1回遅延 | 「ムラ」の定量化: 実行率の週次分散を計測→分散大の週のkindを特定し必須提案を1件化 | 実行率<60%の月はtiming学習を保留(未実行データはタイミングの教師にならない) |
| 外舘(empathy) | C affinity最高・全販売+1回遅延・資料お渡し型 | 「リピート92%を売上化」: 外舘×非販売の信頼蓄積が何回目で販売受諾に転換するか個別推定 | S1が低くてもS3/S4が高いセルを降格させない(多地平ガードの恩恵を最も受ける) |

規律: **スタッフ学習の結果を順位表として出力しない**(ダッシュボードのスタッフ画面規約と同じ「強み発見と移転」目的)。Brain層へはstyle単位でのみ送出(個人名は店舗内に留まる・既定通り)。新人加入時はstyle事前分布から開始し、自店セルn>=10で個人実測へ自動切替(learning_modeと同思想)。

# 4. Store Learning Engine(店舗全体学習)

## 4-1. 3つの機能

**(a) 店舗パラメータ学習**: churn重み再フィット(確定ラベル100件で回帰・Lv2)/ タイプ既定周期の自店補正(実測周期の中央値・Lv2)/ 店舗ベースライン(BL)の自動更新。

**(b) 店舗独自パターン発見(extractSuccessActions本実装)**:

```
1. 成功コホート定義: サブスク化 or LTV上位20% or 来店5回+
2. 行動シーケンス化: [初回menu_role, 2回目..., HC時点, 指名時点, 提案応答列]
3. 頻出部分列マイニング(n>=10)→ 既存8パターンとの編集距離で「新規性」判定
4. 新規性高の系列 → Claude APIで仮説言語化(なぜ効くかの仮説をevidenceに添付)
5. lifecycle='candidate'として起票(origin='ai_discovered')
   → 承認 → testing(50%適用) → 60日 → 昇格判定(2章に合流)
```

**(c) ブランド標準との差分管理**:

```
drift指標(月次計測・ダッシュボード成功パターン画面に表示):
 override_ratio = 店舗オーバーライド行数 / 全候補数
 perf_delta = 店舗BL − ブランドベンチマークp50(指標別)
運用ルール:
 ・override_ratio > 30% → 「標準乖離」警告(独自進化は権利だが、Brain恩恵の減少を可視化)
 ・店舗オーバーライドがブランド標準をS1+10pt以上上回る(n>=30)
   → Brain側へ「ブランド標準候補」として自動推薦(scope='brand'起票・出世コース)
 ・逆に標準を下回り続けるオーバーライド → 店舗にNULL行復帰を提案(Lv2)
```

# 5. Brain Revision Engine(起票・承認・ロールバック)

## 5-1. revision統一型(全エンジンの出口)

```
brain_revisions(既存+v1.1拡張):
 change_type: 'timing'|'condition'|'script'|'new_pattern'|'lifecycle'|
              'churn_weights'|'staff_adjustment'|'params'|'rollback'
 origin_engine: 'pattern_learning'|'promotion'|'staff_learning'|
                'store_learning'|'human'|'rollback'
 evidence: 7章の標準スキーマ(NOT NULL)
 status: proposed → approved/rejected/auto_applied → (applied後) superseded/rolled_back
```

## 5-2. 承認運用

- 承認画面(ダッシュボード成功パターン画面)は **evidence要約3行+影響範囲+[採用][却下][30日後に再提案]** の3択。月次承認会議(15分)で一括処理する前提の件数設計(6章の予算制で月5件以下)
- 承認SLA: proposedから60日放置 → 自動expired(古い根拠で適用しない)。再起票は翌月の再計算で自動
- auto_applied(安全方向・微小更新)は承認不要だが、全件が月次レポートに列挙される(事後監査)

## 5-3. ロールバック(確定メカニクス)

```
全revisionは before/after を完全保持 → ロールバック = 逆方向revisionの自動生成
 1. Manager: 適用済みrevision詳細 → [ロールバック]
 2. システム: change_type='rollback'のrevisionを自動起票
    (before=現在値, after=元revision.before, evidence=元revisionへの参照+理由入力必須)
 3. Lv4 Guard再検査(ロールバックでも通す — 古い値が現Guardに違反する可能性)
 4. 即時承認可(Manager権限のみで完結・version+1)
 5. 元revisionは status='rolled_back'。同一内容の自動再起票を90日禁止
連鎖ルール: ロールバック対象の後に同一候補へ別revisionが適用済み(before照合不一致)の場合は
 単純ロールバック不可 → 「現在値からの新規修正」として人間起案に切替(stale防止と同機構)
```

# 6. Brain Safety System(学習暴走の構造的防止)

| 機構 | 仕様 |
|---|---|
| **変更予算制** | 自動起票は 店舗あたり月5件まで・同一候補は四半期1件まで(suspended除く)。予算超過分は翌月繰越(LearningScore順)。学習の「焦り」を構造的に不可能にする |
| **データ不足判定** | セルごとに状態を持つ: insufficient(n<10・学習対象外/デフォルト値使用) → emerging(10–19・観測のみ) → sufficient(>=20・起票可)。Wilson 95%信頼区間の下限がベースラインを上回る場合のみ「改善」と判定(点推定の偶然を排除) |
| **ノイズ除去** | ①LTVはwinsorize(上下5%カット) ②異常期間フラグ: キャンペーン実施・スタッフ休職・臨時休業の期間はbusiness_settingsに登録→該当期間のセルを学習から除外 ③E型は周期学習の母集団から恒久除外(逆算固定のため) ④同一顧客の同一候補への反復提案は2回目以降を学習weight 0.5に減衰(1人の頑固さがセルを支配しない) |
| **振動減衰** | 2章の四半期1回制限+ヒステリシス(昇格閾値+10pt/復帰閾値はp25と非対称)。lifecycle履歴に同一候補の往復が2回 → 不安定フラグ |
| **方向性ガード** | Lv4(継承): 提案頻度増・cooldown短縮・ゲート緩和方向の起票は機械的に不可能。**学習がどれだけ「売れる」と主張しても原則層は動かない** |
| **全体停止スイッチ** | brain_params(key='learning_freeze')=trueで全自動起票を停止(発火は現行版で継続)。障害・係争・移行時の安全弁 |

# 7. Explainable Learning(学習の説明責任)

## 7-1. evidence標準スキーマ(全revision必須)

```
evidence = {
  metrics: { s1: {value, baseline, delta, n, ci95}, s2: {...}, s3: {...}, s4: {...} },
  period: { from, to, excluded_periods: [...] },        // ノイズ除外の明示
  comparison: { cohort: '同タイプ同kind active群', method: 'EWMA λ=0.7 / Wilson CI' },
  multi_horizon_check: { passed: true, detail: 'S3 +2pt(非悪化)' },
  decision_path: ['sufficient(n=24)', 'S1 +12pt', 'S3 check passed', '予算内 3/5'],
  source_records: { stats_snapshot_id, sample_outcome_ids: [...] }   // 監査の遡及性
}
```

## 7-2. 説明文テンプレート(決定論・日本語)

```
昇格: 「{候補}を正式採用候補にしました。{期間}のテスト適用で受諾率{S1}%
      (店舗平均+{delta}pt・n={n})、90日リピートも{S3判定}。
      信頼区間でも改善が確認できます(下限{ci_low}%>平均{BL}%)」
降格: 「{候補}を無効化候補にしました。90日間の監視で受諾率が回復せず
      (p25未満が3期連続)。文面改訂版(v{n+1})での再挑戦を推奨します」
停止: 「{候補}を緊急停止しました。理由: {却下率58%(n=12)/リピート率−16pt}。
      この候補経由の顧客は通常導線に自動復帰済みです」
スタッフ調整: 「{style}スタイルでは{kind}提案を{n}回目に行うと受諾率が
      {a}%→{b}%に上がる実績が確認されたため、タイミングを調整しました」
```

出力先: ①承認画面(起票時) ②月次学習レポート(`learning_report` = ai_insightsのkind追加: 当月の起票/承認/auto_applied/停止/予算消化/ガード遮断件数の全列挙) ③brain_learning_history(brand層の恒久監査)。

**「説明できない変更は存在できない」** — evidenceスキーマのNOT NULL制約+テンプレ生成失敗時は起票自体を中止(GUARD扱い)が最終防衛線。

---

# 8. 実装成果物(Claude Code向け)

配置: src/engines/learning/(新設・pure規約継承)。月次起動はmonthly-learningから。

| ファイル | 責務 |
|---|---|
| LearningSignals.ts | S1〜S4算出・EWMA・季節補正・Wilson CI・winsorize(全エンジン共有の統計基盤) |
| PatternLearningEngine.ts | LearningScore・多地平ガード・soft_features/weights再推定起票 |
| PromotionEngine.ts | (Final Architecture v1.0から移管・LearningScore条件に更新)状態機械+振動検知 |
| StaffLearningEngine.ts | セル学習・affinity EWMA・timing_offset/style起票・実行率分散計測 |
| StoreLearningEngine.ts | churn再フィット・周期補正・シーケンスマイニング・drift計測・標準推薦 |
| RevisionEngine.ts | 統一起票(Lv4連携)・予算制・承認SLA・**ロールバック生成**・連鎖判定 |
| SafetyGuards.ts | データ充足状態機械・異常期間除外・振動減衰・learning_freeze |
| LearningExplainer.ts | evidence組立・テンプレ生成・月次learning_report |

テスト必須: 多地平ガード(S1良/S3悪で昇格阻止) / Wilson CI境界 / 予算超過繰越 / 振動2往復で不安定化 / ロールバック連鎖(before不一致でblock) / 異常期間除外の集計一致 / learning_freeze全停止 / evidence欠損で起票中止。

DB差分(Master Schema v1.2=W9): brain_revisions列追加(origin_engine, expired/superseded/rolled_back状態) / business_settings列追加(anomaly_periods JSONB) / ai_insights kind追加('learning_report') / brain_params新キー('learning_freeze','lifecycle_thresholds','learning_budget')。新テーブルなし(28本維持)。

---
*Riora Brain Evolution Architecture v1.0 — 学習・進化の唯一の正とする。「止めるのは速く、変えるのは慎重に、説明できないものは動かさない」。*
