# Audit Report Architecture v1.0

**株式会社martylabo / Salon Riora — AI監査レポート 確定版**
作成日: 2026-06-12
正典関係: Management Dashboard v1.0/v1.1 / Brain Evolution v1.0 / Brain Learning Code v1.0 / LINE Content Library v1.2 に準拠。⑥AI Management Insightと同じコスト思想(「LLMは押した時だけ」)の監査特化版。

## 0. 設計の骨格

```
監査 = 決定論データパック(コストゼロ・常に正確)
     + 小型LLMナラティブ(任意・選択した項目のみ・Haiku級)
```

- 数値・表・グラフは**全て決定論集計**(既存テーブルの読取のみ・LLM不使用)。LLMが書くのは各画面冒頭の「3行サマリー(所見)」だけ
- 5項目すべてONで実行しても LLM呼出は最大5回(各1回・入力は集計値のみ・個人名/顧客名なし)
- キャッシュ7日間。期限内の再表示はコストゼロ
- ランキング・他者比較は全画面で禁止(スタッフ監査はv1.0③と同じ「強み表示形式」)

---

# 1. トップ画面(Audit Control)

```
┌──────────────────────────────┐
│ AI監査レポート                 │
│ 最終実行: 6/10 09:12(キャッシュ有効 あと5日)│
├──────────────────────────────┤
│ 分析する項目を選んでください     │
│ ☑ AI学習監査        (約6秒)   │
│ ☑ LINE効果監査      (約6秒)   │
│ ☐ 離脱監査          (約8秒)   │
│ ☑ 成功パターン監査   (約8秒)   │
│ ☐ スタッフ強み監査   (約7秒)   │
├──────────────────────────────┤
│ [選択した3項目を実行する]       │
│  所要時間 約20秒・分析コストが   │
│  発生します(今月 残り7回)       │
├──────────────────────────────┤
│ 実行済みレポート(キャッシュ)     │
│ ・AI学習監査    6/10 [開く]    │
│ ・LINE効果監査  6/10 [開く]    │
│ ・成功パターン  6/3  [開く]⚠期限切れ間近│
└──────────────────────────────┘
```

仕様: 所要時間表示=選択数×6〜8秒の合算を動的計算 / 予算= brain_params 'audit_budget'(既定: 月10セクション分・⑥insight_budgetとは独立)/ 残数0で実行ボタン無効+「来月1日に回復」表示 / 実行中はセクションごとに完了チェックが進む(全完了を待たず完了分から閲覧可)。

# 2. 各監査画面の表示内容(KPIと構成)

共通レイアウト: [LLM所見3行]→[主要数値カード]→[明細テーブル]→[Dashboardへの遷移ボタン]。全数値に集計期間を明記(既定: 直近90日)。

## 2-1. AI学習監査(「AIは何を学んだか」)

| ブロック | 内容(データソース) |
|---|---|
| 学習活動サマリー | 期間内のrun回数/評価セル数/起票・承認・却下・auto_applied・suspended件数(learning_runs+brain_revisions) |
| 学んだこと一覧 | 承認済みrevisionの日本語evidence要約リスト(EvidenceBuilder出力をそのまま表示・最大10件) |
| 成果検証 | 適用済みrevisionの適用前後比較(対象セルのS1/S3、適用日で区切ったbefore/after・Wilson下限併記)— 「学習が効いたか」の答え |
| 安全性 | Lv4遮断件数/evidence欠損中止/予算消化/freeze履歴/振動検知(ops_logs集計) |
| LLM所見 | 例:「今期は提案タイミングの学習が中心でした。C型HC提案の4回目化は受諾率+22ptで定着。一方ガード遮断が2件あり、いずれもcooldown短縮方向の自動起票でした(正常動作)」 |

## 2-2. LINE効果監査(「半自動運用は機能しているか」)

| ブロック | 内容 |
|---|---|
| 運用サマリー | 提示数/選択率/送信数/見送り数/編集率(scenario_outcomes v1.5列) |
| 効果 | uplift上位10コード(送った群vs見送り群・Wilson下限・n表示)/期間内の来店誘導合計の推定貢献 |
| 見送り分析 | skip_reason分布+「tone見送り3件以上」コードの文面改訂状況(revision連動) |
| 健全性 | 承認者却下率/expired率/7日制限の発動数/churn販売停止の発動推移(急増=離脱先行指標) |

## 2-3. 離脱監査(「離脱は防げているか」)

| ブロック | 内容 |
|---|---|
| 予測精度 | 前期churn>0.7群の実離脱率 vs <0.3群(ChurnPredictor較正・Brain Learningの精度レポートを再掲) |
| 救済実績 | danger判定→介入(LINE/来店)→90日内再来した「戻ってきた顧客」数と介入手段の内訳 |
| 離脱要因 | churn_reason分布/離脱者の最終来店からの共通項(周期超過/予約なし退店/提案拒否直後 の割合) |
| 早期警報 | cycle_over_1_5発生数の推移(離脱の最上流指標)/ stalled滞留数 |

## 2-4. 成功パターン監査(「導線は進化しているか」)

| ブロック | 内容 |
|---|---|
| lifecycle変動 | 期間内の昇格/降格/停止/testing中一覧(brain_revisions change_type='lifecycle') |
| ファネル推移 | パターン別の段階転換率 今期vs前期(pattern_step_stats比較) |
| testing検証 | 50%適用中候補のA/B中間結果(test群vs control群・判定予定日) |
| version履歴 | 主要パターンの改訂チェーン(superseded_by)と各版の成績 |

## 2-5. スタッフ強み監査(強み表示形式・ランキング禁止)

3名の個別カード(五十音順固定・合計/順位/平均比較なし):

| ブロック | 内容 |
|---|---|
| 確認された強み | 期間内に統計的に確認(Wilson下限>店舗BL)された強みセルの日本語リスト |
| 強みの移転 | 本人発の手法が標準化された件数と、他者がその手法で得た成果(StaffLearning revision追跡) |
| 伸びしろ | 改善テーマ1件のみ(ImprovementAnalyzer・「苦手」表記禁止) |
| 成長曲線 | 本人の主要セルS1の時系列(自分比のみ) |

# 3. 実行フロー・API

```
POST /api/audit/run        body: { sections: ['learning','line','churn','pattern','staff'] }
 → 検証: role(Owner/Manager) / 予算残 / 同時実行ロック(店舗1run)
 → audit run登録(runId) → 202 { runId, estimatedSec }
 → サーバ: セクション直列処理
    ①決定論データパック組立(各2〜4クエリ・既存テーブル/キャッシュのみ)
    ②LLM所見生成(セクション1回・固定JSONスキーマ・数値突合の幻覚検証つき
      — Dashboard⑥と同ガード。失敗時は所見欄に「自動所見なし」でデータパックのみ表示)
    ③dashboard_cache UPSERT(kind='audit_<section>', ref_id=runId,
      payload={pack, narrative, generated_at})
GET /api/audit/status?runId= → { sections: [{name, state:'done'|'running'|'queued'}] }
GET /api/audit/report?section=learning → キャッシュ返却(7日以内ならrunId不問で最新)
```

レスポンス例(report・抜粋):
```json
{ "ok": true, "data": {
  "section": "line", "generatedAt": "2026-06-12T09:12:00+09:00",
  "cacheExpiresAt": "2026-06-19T09:12:00+09:00",
  "narrative": "見送り判断が適切に機能しています。tone理由の見送りが…(3行)",
  "pack": {
    "summary": { "presented": 142, "sent": 61, "skipped": 38, "editRate": 0.31 },
    "topScenarios": [ { "code": "S-R-01", "uplift": 0.23, "ciLow": 0.06, "n": 22 } ],
    "skipReasons": { "timing": 14, "tone": 9, "customer_situation": 11, "other": 4 } } } }
```

# 4. キャッシュ戦略・DB差分

| 関心 | 設計 |
|---|---|
| キャッシュ | dashboard_cache(kind='audit_*')。**有効7日**(generated_at+7d)。期限内の再実行は確認ダイアログ『6/10の結果があります。再実行しますか?(コスト発生)』 |
| 鮮度 | データパックの集計起点はdashboard_daily/pattern_step_stats等の夜間スナップショット(監査時点の生テーブル直集計はしない=数値の出所を夜間バッチに一本化) |
| DB差分(v1.10=W17) | brain_params新キー 'audit_budget' / dashboard_cacheは既存構造で対応(新テーブルなし)。run管理はops_logs(kind='audit_run', detail={runId, sections, durations, llm_calls}) |
| 同時実行 | ops_logsのrun開始レコードをロック代わりに(store内1run・10分でタイムアウト解放) |

# 5. 権限・連携・実装順

| 項目 | 内容 |
|---|---|
| 権限 | Owner/Manager: 実行・閲覧。Staff: 全403(自分の強みカードもAudit経由では見せない — 本人向けはStaff KPI Dashboard v2.0が担当・経路を分離) |
| Dashboard連携 | 各監査画面の明細行から該当画面へ遷移(②→revisions承認 / ④→Churn Center / ⑤→Staff Strength)。逆にDashboard各画面に[詳しく監査する]ボタン(該当セクションON済みのControlへ) |
| 実装順 | A-1 データパック5種(決定論・テスト=手計算一致) → A-2 run/status/report API+予算・ロック → A-3 LLM所見+幻覚検証 → A-4 Control画面+5画面UI(Step5枠) |
| 受入 | 5項目ON実行<40s / キャッシュhitでLLM呼出0 / 予算0でボタン無効 / 入力パックに個人名・顧客名なし(走査) / スタッフ監査レスポンスにranking系キー不存在 |

---
*Audit Report Architecture v1.0 — 「AIの通信簿は、見たい時に、見たい科目だけ、7日間有効で」。監査経路の唯一の正とする。*
