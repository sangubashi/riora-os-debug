# Management Dashboard Architecture v2.1(差分改版)

**株式会社martylabo / Salon Riora**
作成日: 2026-06-12
位置づけ: v2.0への差分改版。CSV Import を管理者ダッシュボードの責務として正式統合し、B案(ハイブリッド運用)を確定する。v2.0と矛盾する場合は本書を正とする。
関連正典: CSVImportSecurityArchitecture.md / SalonBoard CSV Import Implementation v1.0 / Master Schema / Brain完成設計(匿名化境界) / Multi Store(store_id規約)

---

## 0. 本改版の確定事項

| 項目 | 確定 |
|---|---|
| CSV Importの責務 | **管理者ダッシュボード(owner専用)**。スタッフアプリはCSVを扱わない |
| データモデル | **新規テーブルを作らない**。`brain_customers`/`brain_bookings`/`brain_visits` を利用。`reservations`/`sales_data`の新規採用は**禁止**(既存正典と二重化するため) |
| 運用方針 | **B案ハイブリッド**: 当日=スタッフ30秒入力(即AI反映)/夜間=CSV取込で売上実績を正データ化(冪等UPSERT) |
| データの位置づけ | スタッフ入力=リアルタイム情報 / CSV=売上実績の正データ |

既存CSV設計(CSVImportSecurityArchitecture.md)はすでに「brain_customers/visitsへ冪等UPSERT・external_key_hash照合・名寄せ選択」を持つため、**本改版はそれを画面として正式化し、B案の突合ルールを足すもの**。設計の矛盾はない。

---

## 1. 修正後の画面構成(6常設+管理ユーティリティ1)

```
サイドバー:
 ● ダッシュボード         (経営TOP=画面①・CSV取込状況カード追加)
 ● 失客リスク管理         (離脱予兆センター=画面②)
 ● 顧客管理              (顧客資産 LTV/VIP=画面③)
 ● スタッフ分析           (画面④・管理者専用)
 ● 稼働率                (席・予約枠=画面⑤)
 ● CSV Import Management  (★新画面=画面⑥・owner専用)  ← 本改版で追加
 ● 設定
```

CSV Import Management は毎日見る画面ではない(週次/月次取込)が、責務上ダッシュボード内に置く。owner以外(manager/staff)には**サイドバー項目自体を非表示**。

## 2. 画面⑥ CSV Import Management(新画面・owner専用)

```
┌──────────────────────────────┐
│ CSV取込(SalonBoard)            │
│ ① [CSVを選択](.csv・SJIS対応)  │
│ ② Dry Run結果                 │
│    取込可 124 / 要確認 3 / 除外 8│
│    破棄した列: 電話, メール, 郵便… │
│    プレビュー(保持項目のみ・先頭3行)│
│ ③ 未解決スタッフ(名寄せ)         │
│    "亀山純佳" → [亀山に紐付け][新規]│
│    "カメヤマ" → [亀山に紐付け][新規]│
│ ④ 要確認顧客(同姓同名)           │
│    [同一人物][別人として新規]      │
│ ⑤ [この内容で取り込む]           │
├──────────────────────────────┤
│ 取込履歴                       │
│ 6/10 09:12 新規12 更新98 来店142│
│ 6/3  09:05 …                  │
├──────────────────────────────┤
│ [スタッフ名エイリアス管理]        │
└──────────────────────────────┘
```

機能:
| 機能 | 内容 |
|---|---|
| CSVアップロード | .csv・SJIS/UTF-8・10MB上限。メモリストリーム(原本非保存・CSV Security準拠) |
| Dry Run | 保存せず検証。取込可/要確認/除外件数・破棄列名・保持項目プレビュー(PII除去後) |
| Import実行 | チャンク500行/TXで brain_customers/bookings/visits へ冪等UPSERT |
| Import履歴 | ops_logs(kind='csv_import')から件数・日時(内容は表示しない) |
| 未解決スタッフ一覧 | CSVの担当者名がbrain_staffに名寄せできなかった行。手動紐付け or 新規 |
| staff_name_aliases管理 | スタッフ名の表記ゆれ辞書(下記DB)。一度紐付けたら次回以降自動解決 |

権限: **ownerのみ**(manager含めずownerに限定=指示どおり)。RLS+API role判定+サイドバー非表示の三重。

## 3. 画面① 経営TOP に CSV取込状況カード追加

```
┌── CSV取込状況 ──────────────┐
│ 最終取込: 6/10 09:12         │
│ 未解決スタッフ 2件 ⚠         │
│ Dry Runエラー 0件            │
│ 前回取込 新規12/更新98/来店142│
│ [CSV Import Managementへ]    │
└────────────────────────────┘
```

- 未解決スタッフ>0 は警告色(名寄せ未解決=売上がスタッフに帰属しない=スタッフ分析が不正確になるため)
- ownerのみ表示(manager/staffには出さない)

## 4. 追加API一覧(owner専用・4本)

```
POST /api/admin/csv/dry-run     … アップロード+検証(保存なし)。ValidationResult返却
POST /api/admin/csv/import      … Dry Run結果+名寄せ/同姓同名の決定を受けて実行
GET  /api/admin/csv/history     … 取込履歴(ops_logs集計・件数のみ)
GET/POST /api/admin/staff-aliases … エイリアス辞書の閲覧・追加
```

- 全て role=owner 強制(他ロールは403)。実体は SalonBoard CSV Import Implementation v1.0 のサービス層を呼ぶ薄ラッパ
- 経営TOPの取込状況カードは既存 `GET /api/dashboard/top` のレスポンスに `csvImportStatus` を追加(新APIにしない)

## 5. DB利用テーブル一覧(新規ゼロ・既存利用)

| テーブル | CSV取込での用途 |
|---|---|
| brain_customers | external_key_hash照合→既存更新 or 新規採番。prefecture/city/age_group補完(COALESCE方向・手入力を上書きしない) |
| brain_bookings | SalonBoardの予約/来店実績を status='done' 等で取込 |
| brain_visits | 売上実績(treatment/retail)・来店日。**source='salonboard_import'** 付与で学習側が区別。**1顧客×1来店日=1行**の設計のため、同日複数会計時の挙動には既知の制約がある(§6末尾「同日複数会計時の挙動」参照) |
| ops_logs | kind='csv_import' 履歴(内容は残さない) |
| staff_name_aliases(★) | スタッフ名表記ゆれ辞書 |

**staff_name_aliases のみ新規だが、これは「マスタ辞書」であり業務データテーブルではない**(reservations/sales_data のような業務データの二重化には当たらない)。Master Schema改版手続きに沿って追加。構造:
```
staff_name_aliases(store_id, alias TEXT, staff_id FK, created_by)
  UNIQUE(store_id, alias)  -- "亀山純佳"/"カメヤマ"/"亀山" → 同一staff_id
```
これを認めるか、エイリアスをbrain_staffのJSONB列(name_aliases)に持つかは実装判断。**新テーブルを避けるならbrain_staff.name_aliases JSONBが望ましい**(指示の「新規テーブルを作らない」を厳守するならこちら)。本改版は **brain_staff.name_aliases JSONB を既定**とし、別テーブル案は代替に留める。

## 6. CSV取込フロー(B案ハイブリッドの突合ルール)

```
【当日・リアルタイム】
 スタッフ30秒入力 → brain_visits INSERT(source='staff_input')
   → BE1でPattern/Scenario即評価 → AI提案が当日反映

【夜間・CSV取込(owner運用・SalonBoard CSVを取り込んだ日)】
 CSV → Dry Run → Import実行:
  1. PII Sanitize(電話/メール/詳細住所 破棄・CSV Security準拠)
  2. external_key_hash で顧客解決
  3. 突合(同一来店の二重計上を防ぐ・B案の核心):
     同一(customer_id, visit_date)に staff_input 行が既にある場合
       → CSV行を「正データ」とし、売上金額・メニューを UPDATE(上書き)
       → source を 'staff_input' → 'reconciled' に更新
       → スタッフ入力の肌記録・音声メモ・proposal_outcomes は保持(CSVに無い情報)
     staff_input 行が無い場合(スタッフ入力漏れ・CSVのみ)
       → CSV行を INSERT(source='salonboard_import')
  4. 冪等: 同一CSV再取込は (customer_id, visit_date, external_key_hash) で増分ゼロ
 → 売上・来店実績が「正データ」に確定
```

突合の設計判断:
- **金額・メニューはCSVを正**(SalonBoardが会計の唯一の正)。スタッフ入力の概算売上は夜間にCSVで上書きされる
- **肌記録・音声メモ・提案結果はスタッフ入力を保持**(CSVに存在しない=Rioraの付加価値データ)。CSVは消さない
- だから「スタッフ入力=リアルタイム情報、CSV=売上実績の正データ」が両立する
- visit_count_at はCSV取込後に時系列で一括再採番(スタッフ入力とCSVが混在しても正しい来店回数になる)

### 6-1. 同日複数会計時の挙動(既知の制約・2026-09-13調査で判明)

brain_visitsは`(customer_id, visit_date)`単位で1行に集約する設計(上記3.突合参照)のため、
**同一顧客が同じ来店日に複数回会計した場合**、2件目以降のCSV行は「既に取込済みのvisitが
存在する」経路に入り、以下のとおり**フィールドごとに非対称な上書き挙動**になる:

| フィールド | 挙動 | 実際に残るのは |
|---|---|---|
| `treatment_amount`(治療費) | 上書きされない | その日**最初に処理された**会計の値 |
| `retail_amount`(店販金額・ヘッダー合計) | 上書きされない | 同上、最初の会計の値 |
| `retail_category`(店販商品名の要約) | 上書きされない | 最初の会計時点の値(初回に店販が無ければ`null`固定) |
| `staff_id` / `menu_id` / `is_nomination` | 上書きされない | 最初の会計の値 |
| `brain_visit_retail_items`(店販明細行) | **毎回、全削除→入れ直し** | **最後に処理された**会計の明細のみ |

つまり「ヘッダー系フィールドは最初の会計が生き残り、店販明細行だけは最後の会計に
上書きされる」という非対称な挙動であり、**ヘッダーのretail_amountと店販明細
(brain_visit_retail_items)の合計が一致しない状態が起こり得る**(例: 1件目で店販8,000円
→ヘッダーは8,000円のまま固定、3件目が店販0円だと明細は0件になり、
「ヘッダー8,000円・明細0件」という不整合が残る)。CSV行の処理順は会計ID順であり
来店時刻の昇順とは限らないため、「最初に処理された会計」がその日最初の来店とは
限らない点にも注意。

**経営ダッシュボードの売上集計への影響(既知の制約)**: `DashboardAggregator`の日次売上は
`VisitRepo.sumSalesByStoreAndDate()`が`brain_visits.treatment_amount + retail_amount`を
日付単位にそのまま合計する設計のため、同日複数会計が1行に集約される以上、
**2件目以降の会計の売上(治療費・店販とも)は日次・月次売上に一切算入されない**。
施術売上・店販売上を分けて集計する場合も同様(分けても合算されない問題自体は解消しない)。

**過去件数について**: 元のSalonBoard CSVファイルは取込後に永続化されず、
brain_ops_logs(kind='csv_import')の監査ログにもこの経路(2件目以降のスキップ)を
数えるカウンタが無いため、**過去に実際何件の同日複数会計が発生したかをDBから正確に
特定する手段は無い**。2026-09時点の顧客ステータスバックフィルで7組の重複
(治療費・店販とも上記の挙動どおりに集約済み)が判明しているが、これは氷山の一角の
可能性があり、それ以外の件数は不明として扱うこと。

## 7. スタッフアプリとの責務分界(確定)

| 操作 | 担い手 |
|---|---|
| CSVダウンロード(SalonBoard) | owner/管理者(手作業) |
| CSVアップロード・Dry Run・Import・名寄せ | **owner専用・管理者ダッシュボード(画面⑥)** |
| 当日の30秒来店入力 | スタッフアプリ |
| AI提案の実行(LINE送る/予約取る) | スタッフアプリ |
| 売上実績の閲覧 | 経営=ダッシュボード / スタッフ=自分の数字のみ(Staff KPI v2.0) |

**スタッフはCSVに一切触れない。** 経営ダッシュボードは現場操作(LINE送信等)に触れない(v2.0改修済)。責務が双方向に綺麗に分離。

## 8. Brain設計・Multi Store設計との整合

- **Brain**: CSV由来 visits も nightly-etl で匿名化(hash/band/style)。ただし source='salonboard_import' 単独行(スタッフ入力を伴わない過去移行データ等)は**提案outcomes学習の母集団から除外**(他店文脈・接客プロセス情報がないため)。'reconciled' 行は学習対象(スタッフの提案+CSVの結果が揃うため、むしろ最良の教師データ)
- **Multi Store**: CSV取込は必ず owner の store_id スコープで実行。external_key_hash = sha256(会員番号 + store.anon_salt) で店舗別ソルト。**他店の会員番号と衝突しない**=多店舗化してもCSV取込が混ざらない。staff_aliasも store_id 配下

## 9. 実装優先順位の更新

```
(既存) MD-1 経営TOP … に「CSV取込状況カード」を追加
(新規) MD-6 CSV Import Management 画面 + 4 API
        実体は SalonBoard CSV Import Implementation v1.0(C-1〜C-4)を流用
        → 画面はそのサービス層の薄いUIラッパ
優先度: MD-1(経営TOP・取込状況カード含む) を最優先のまま。
        MD-6 は Step8-3(既存顧客移行)と同時期。理由: 移行ツール=CSV取込の実体であり、
        B案の突合ロジックは移行後の日常運用でも使うため、移行と運用で同じ実装を共有する。
前提: Master Schema(brain_staff.name_aliases JSONB追加)+ CSV突合ロジックの
      source='reconciled' 状態追加(brain_visits.source の CHECK 拡張)
```

DB差分(Master Schema 次版): brain_visits.source の CHECK に 'reconciled' 追加 / brain_staff.name_aliases JSONB 追加。**新規業務テーブルなし**(指示厳守)。

---
*Management Dashboard Architecture v2.1 — CSVは経営の責務・スタッフは触れない。新テーブルを作らず brain_customers/bookings/visits に冪等UPSERT。スタッフ入力=今、CSV=正。両者は夜間に突合して一つの真実になる。*
