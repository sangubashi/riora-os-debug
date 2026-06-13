# Staff KPI Dashboard Architecture v2.0

**株式会社martylabo / Salon Riora — スタッフ個人ダッシュボード 確定版**
作成日: 2026-06-12
正典関係: Management Dashboard v1.1 のスタッフ表示制限(2指標)を、本書が**オーナー判断により置換**する。

## 0. v1.1との整合(最初に明記)

v1.1は「売上・指名の2指標のみ」と定めた。本v2.0は**KPI④〜⑨の表示を解禁する**が、v1.1の思想(数字のための接客を生まない・競争を作らない)は以下のガードレールで保存する:

| ガードレール | 実装 |
|---|---|
| ランキング絶対禁止 | 他スタッフのデータ・店舗平均・順位は一切返さない(APIレスポンス型に不存在+JSON走査テスト継続) |
| ④〜⑨に目標を設定しない | **比較対象は前月の自分のみ**(前月比矢印)。目標・達成率を持つのは①②③の売上・指名系だけ |
| Brain専用のまま非表示 | 提案成功率(受諾率) / visit_score / CSI生値 / churn / uplift / 入力完了率 — v1.1のリストから④〜⑨を除いた残りは引き続き非表示 |
| 焦りが顧客に向かわない | サブスク率・次回予約率を見て焦っても、エンジン側のゲート(4条件・cooldown・販売1件制限)が提案を物理的に止める。**表示解禁はエンジン防衛が完成している前提で成立**している |
| 下降時の表現規則 | 前月比マイナスは赤色・警告アイコン禁止。グレー「↘」のみ。コーチも責めない(7章文体規則) |

---

# 1. 画面構成(1画面・縦スクロール・iPhone)

```
┌──────────────────────────────┐
│ 🌸 リオラちゃんから(毎朝更新)   │ ← ⑦コーチカード(最上部=開きたくなる理由)
│ 「指名が好調です◎ 次回予約を   │
│  あと2件とると、お給料の見込み  │
│  が+¥9,000になりますよ」      │
├──────────────────────────────┤
│ 💰 今月のお給料見込み           │ ← 給与予測(第2の理由)
│   ¥318,400(控除後 概算)       │
│   [くわしく見る ▼]            │ ← 展開で内訳+シミュレーター
├──────────────────────────────┤
│ 今日の売上 ¥57,000(昨日 ¥43,000)│ ← ①
├──────────────────────────────┤
│ 今月売上  ¥612,000/¥800,000   │ ← ②目標バー
│ ██████████░░░ 76%             │
│ 今月指名  11/15件  ████░ 73%  │ ← ③目標バー
├──────────────────────────────┤
│ じぶん比(前月とくらべて)        │ ← ④〜⑨ 2列グリッド
│ 客単価 ¥21.4K ↗ │ 次回予約 71%↗│
│ リピート 68% →  │ サブスク 9% ↗│
│ VIP比率 14% →   │ LINE返信 — │
└──────────────────────────────┘
```

KPIカード仕様(共通): タップで30日ミニ推移チャート展開 / ④〜⑨の前月比は ↗(+2pt以上)・→(±2pt)・↘(−2pt超・グレー) / n不足(分母<10)は「集計中」/ LINE返信率はwebhook実装(Phase2)まで「—」。

| # | KPI | 定義(担当=staff_idベース・当月) |
|---|---|---|
| ① | 今日の売上 | 当日visits合計(リアルタイム軽量COUNT)+昨日値 |
| ② | 今月売上 | treatment+retail合計 / staff_targets.sales |
| ③ | 今月指名数 | is_nomination COUNT / staff_targets.nominations |
| ④ | LINE返信率 | 自分がsentにしたscenario_outcomesのwas_replied率(前月比) |
| ⑤ | VIP比率 | 担当顧客のうちVIP(visit>=6かつ高CSI)比率 ※CSI生値は出さずVIP判定結果のみ |
| ⑥ | 客単価 | avg(treatment+retail) |
| ⑦ | 次回予約率 | next_booking_made率 |
| ⑧ | リピート率 | 担当顧客の90日再来率 |
| ⑨ | サブスク率 | 担当顧客のis_subscriber率 |

# 2. 給与予測シミュレーター(最重要機能①)

## 2-1. 計算式(確定)

```
月間予測売上(個人) = 当月実績 + 確定予約見込(自分担当bookings×予約メニュー額)
                   + 残営業日 × 直近4週の同曜日平均(個人)

予測給与(額面) = base_salary
              + commission_rate × 予測売上(commission_base設定に従う:
                  'total'=施術+物販 / 'treatment_only'=施術のみ。既定 'total')
              + nomination_fee × 予測指名数(ペース外挿)
              + Σ 臨時加算(allowances)
              + 通勤手当(固定値)

控除後(概算) = 額面 × (1 − deduction_rate)   ※既定0.16・スタッフ別設定可
画面表記: 「控除後(概算)」+注記『正式な給与額はfreee人事労務の計算が優先されます。
社会保険は翌月徴収のため月によって差が出ます』 ← 必須固定文(給与トラブル防止)
```

初期設定値(シード): 亀山さん base¥250,000/rate 5%/指名¥250 ・ 外舘さん base¥220,000/同 ・ 鈴木さん is_commissioned=false(役員報酬のためシミュレーター非表示・KPIカードのみ)。

## 2-2. シミュレーション表示(10万円刻み3段階)

```
[くわしく見る ▼]展開時:
 内訳: 基本給 ¥250,000 / 売上歩合 ¥35,600 / 指名 ¥3,250 / 臨時 ¥0
       額面 ¥288,850 → 控除後概算 ¥242,600
 ──────────────────────
 もしも売上が…
  +¥100,000 → 給与 +¥5,000(控除後 +¥4,200)
  +¥200,000 → 給与 +¥10,000(控除後 +¥8,400)
  +¥300,000 → 給与 +¥15,000(控除後 +¥12,600)
 ──────────────────────
 [臨時加算を記録する](本人入力可: 名目+金額 → オーナー承認後に反映)
```

増分計算 = increment × commission_rate(指名増は含めない単純化・誤解を生まない最小表示)。臨時加算のスタッフ入力は status='pending' で登録 → Owner/Manager承認で予測に反映(本人が自分の給与を直接増やせる構造にはしない)。

# 3. AIコーチ(最重要機能②・リオラちゃん)

## 3-1. 生成方式: 決定論テンプレ基本+LLM自然化はオプション

毎朝のコーチはnightly batch(§3ブリーフィング生成と同便)で**決定論生成**する(LLM定常コストゼロ・Dashboard v1.0思想の継承)。`generation_mode='ai_assist'`をbrain_paramsで有効化した場合のみ、テンプレ出力をHaiku級で自然化(失敗時テンプレへフォールバック・月間予算ガード共用)。

```
生成ロジック(CoachComposer・決定論):
 1. 材料: 本人KPIスナップショット+給与予測+目標差分(②③のみ)
 2. ルール優先順(最初に該当した1本のみ・毎朝1メッセージ):
    R1 目標達成イベント(②or③達成) → 祝福
    R2 給与連動(目標差が歩合換算で表現可能) →
       『あと¥{X}万円の売上で、お給料見込みが+¥{X×rate}になりますよ』
    R3 好調指標(前月比+5pt以上の④〜⑨が存在) →
       『{指標}が好調です◎ {次の一歩}』※次の一歩は指標別固定辞書
    R4 接戦(達成率70-95%) → 残日数×必要ペースの励まし
    R5 既定 → 季節の挨拶+今日の予約件数
 3. 文体規則: 80字以内/責めない/比較しない/数字は最大2個/絵文字1個/
    「〜しましょう」でなく「〜すると近づきます」(命令形禁止)/
    Brain専用指標(成約率等)の数値は本文に出さない
```

LLM自然化プロンプト例(ai_assist時):
```
あなたは美容サロンの応援キャラクター「リオラちゃん」です。以下の下書きを、
意味と数値を一切変えずに、温かく自然な日本語に整えてください(80字以内・絵文字1個まで)。
禁止: 他人との比較/命令形/プレッシャー表現/新しい数値の追加。
下書き: 「{template_output}」
出力: 整えた文のみ
```

# 4. API設計(3本・全てrole=staff本人スコープ)

```
GET /api/staff/my-kpi          … 1章の全カード(v1.1の同名APIを拡張・置換)
GET /api/staff/my-salary-forecast … 2章(内訳+3段階シミュ+設定の閲覧値)
GET /api/staff/my-coaching     … 当朝のコーチ1件(dashboard_cache読取)
POST /api/staff/my-allowance   … 臨時加算の申請(pending起票)
```

レスポンス例(my-salary-forecast):
```json
{ "ok": true, "data": {
  "month": "2026-06",
  "forecast": { "sales": 712000, "nominations": 13 },
  "salary": { "base": 250000, "commission": 35600, "nominationFee": 3250,
              "allowances": 0, "commute": 10000, "gross": 298850,
              "netEstimate": 251000, "deductionRate": 0.16 },
  "simulation": [
    { "addSales": 100000, "addGross": 5000, "addNet": 4200 },
    { "addSales": 200000, "addGross": 10000, "addNet": 8400 },
    { "addSales": 300000, "addGross": 15000, "addNet": 12600 } ],
  "settings": { "commissionRate": 0.05, "commissionBase": "total",
                "nominationFee": 250, "readonly": true },
  "disclaimer": "正式な給与額はfreee人事労務の計算が優先されます" } }
```

# 5. DB差分(Master Schema v1.9 = W16)

```
brain_staff 追加列:
  base_salary INT / commission_rate NUMERIC / commission_base TEXT
    CHECK('total','treatment_only') DEFAULT 'total' /
  nomination_fee INT DEFAULT 250 / commute_allowance INT DEFAULT 0 /
  deduction_rate NUMERIC DEFAULT 0.16 / is_commissioned BOOLEAN DEFAULT true

staff_allowances(新テーブル・29枚目 ※Master Schema改版手続き必須):
  id UUID PK / store_id FK / staff_id FK / month DATE / label TEXT /
  amount INT / status CHECK('pending','approved','rejected') /
  requested_by UUID / decided_by UUID / decided_at
  RLS: staffは自分の行のC/R、U/D不可。承認はOwner/Manager

dashboard_cache: kind追加 'staff_kpi' / 'staff_coaching'(夜間スナップショット)
nightly-dashboard: §3後段にStaffKpiSnapshot+CoachComposerを追加(顧客ループと同便)
```

# 6. 権限制御

| 操作 | Staff | Manager | Owner |
|---|---|---|---|
| 自分のKPI/給与予測/コーチ閲覧 | ○(本人のみ・JWT.staff_id強制) | ○(任意staffId指定可) | ○ |
| 給与設定(base/rate/控除率)の閲覧 | ○(readonly・自分のみ) | ○ | ○ |
| 給与設定の編集 | ✕ | ○ | ○(スタッフ一覧画面) |
| 臨時加算の申請 | ○(自分・pending) | ○ | ○ |
| 臨時加算の承認 | ✕ | ○ | ○ |
| 他スタッフのデータ | ✕(APIが構造的に返さない) | ○ | ○ |

# 7. 実装順・受入条件(Claude Code)

```
K-1 W16マイグレーション+給与設定UI(Manager・スタッフ一覧画面に3項目)
K-2 SalaryForecastCalculator(pure・2-1式)+テスト:
    亀山フィクスチャで額面¥288,850の数値一致/鈴木is_commissioned=falseで非表示/
    deduction境界/シミュ3段階
K-3 StaffKpiSnapshot(nightly)+my-kpi API(①のみリアルタイム)
K-4 CoachComposer(R1〜R5決定論)+my-coaching+テスト:
    ルール優先順/80字/命令形・比較・Brain専用数値の不出現(正規表現走査)
K-5 allowances申請承認フロー+ガードレール走査テスト
    (他者staff_id不出現/ranking系キー不存在/④〜⑨にtarget不存在)
受入: スタッフ1名で「朝開く→コーチ→給与見込み→今日の数字」が3タップ以内・1秒以内(全てキャッシュ読取)
```

---
*Staff KPI Dashboard Architecture v2.0 — 「競争ではなく、自分の昨日と給料明細と話す画面」。v1.1の表示制限を置換し、思想はガードレールとして継承する。*
