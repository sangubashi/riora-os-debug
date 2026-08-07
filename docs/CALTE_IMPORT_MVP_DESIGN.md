# Salon Boardカルテ貼り付け MVP 詳細設計書

作成日: 2026-08-07
最終確定: 2026-08-07(ユーザー方針確定を反映、実装着手前の最終版)
ステータス: **詳細設計・確定版・実装未着手**

前身調査: `docs/CALTE_IMPORT_DESIGN.md`（保存先候補・入力導線・AI接続関係の調査、
[[project_calte_import_design]]）。本書はユーザーが確定した方針に基づく実装前の詳細設計。

## 0. 要約

採用方針:「Salon Boardカルテ貼り付け MVP」。スタッフがSalon Boardのカルテ文章をコピーして
Riora OSへ保存できるようにする。保存先は`customer_notes`（カルテ内容・会話・肌状態）と
`contraindications`（明確な禁忌事項のみ）に確定。`customer_memories`・`brain_customers`・
AI提案直接データへは保存しない。

**本書作成中の重要発見**: `app/api/customers/search-notes/route.ts`（既存の「会話履歴検索」
機能）のコメントに、**`customer_notes`で`category`が未設定(NULL)の行は既に「カルテメモ」
として定義済み**であることが判明した（§3.5）。これはユーザーが確定した「customer_notesへ
カルテ内容を保存する」という方針と完全に一致する既存の設計意図であり、**新しいcategory値の
追加(migration)は不要**と判断できる根拠になる。一方で、この既存動線には見過ごせない副作用
リスクが1件見つかった（§5.4）。

## 0.1 2026-08-07 確定事項(ユーザー承認)

1. **Phase1(MVP)のみ実装**。対象: カルテ貼付/Claude解析/レビュー画面/保存。
   対象外: AI提案改善・自動学習・CSV連携(これらは将来タスクとし、今回は一切着手しない)。
2. **UIはCustomerBottomSheet内へ追加**(§4の案Aで確定。案B/Cは不採用)。
3. **禁忌事項はAIが候補表示のみ・自動保存禁止・スタッフが選択したものだけ保存**(§1.3/§2.3の
   設計方針を最終確定として維持)。
4. **`customer_notes.source`列にmigrationを適用し`'salonboard'`を追加する**(§8.3で「未確定」
   としていた小規模migrationの採用を確定。§3で用いる`source`値は`customer_notes`・
   `contraindications`とも`'salonboard'`に統一する)。
5. **カルテ原文も必ず保存する**(将来の再解析・プロンプト改善への利用を見据え、新規テーブル
   `karte_imports`を新設して原文を保持する。§3.3で新規追加)。
6. **音声メモ3系統問題には一切触れない**(§7、変更なし)。

## 1. カルテ貼付入力画面

### 1.1 画面構成

1段階目(入力): テキストエリア(貼り付け専用) + 「解析する」ボタン
2段階目(レビュー): カテゴリ別に分類された抽出候補一覧 + チェックボックス + 個別編集
3段階目(確定): 「保存する」ボタン → 選択された項目のみ保存 → 完了トースト

`VoiceMemoSection.tsx`が既に持つ「素材 → AI解析 → レビュー(チェック選択) → 保存」という
4段階UIパターンをそのまま踏襲する(スタッフの学習コストを下げる・実証済みのUXパターンを流用)。

### 1.2 顧客選択の設計(確定: 案A採用)

CustomerBottomSheet内への設置が確定(§0.1・§4)。顧客は既に開かれている状態のため、
改めての「顧客選択」ステップは設けない。代わりに**「◯◯様のカルテとして保存します」という
確認表示**を入力画面の最上部に固定表示し、誤って別顧客のカルテを貼り付けてしまう事故を防ぐ
(音声メモの`voiceMemoFlow.ts`が持つ「録音開始時のcustomerIdと保存直前のcustomerIdの
不一致検知」と同じ思想)。顧客一覧画面からの起動(旧案B)・管理者専用画面(旧案C)は不採用のため、
検索・選択UIの実装は不要。

### 1.3 保存前確認(レビュー)画面

Claude解析結果をカテゴリ別(施術内容/肌状態/悩み/注意事項/禁忌事項/次回提案候補)にグルーピングし、
1項目ずつチェックボックス付きで表示する。

- 各項目は**個別に編集可能**(Claudeの抽出ミスをその場で修正できる、VoiceMemoSectionの
  transcript編集と同じ思想)。
- **禁忌事項の項目は視覚的に強調表示**する(既存のNGワード表示と同じ色トークン
  `#C05060`/`#FFF0F2`を流用し、確認画面上でも「ここは慎重に見るべき」ことが一目でわかるようにする)。
- デフォルトの選択状態: 禁忌事項・注意事項は**デフォルトでチェックON**(見落とし防止を優先)、
  施術内容・肌状態・悩みはClaude confidence次第でON/OFF(要実装時判断)、次回提案候補は
  **デフォルトでチェックOFF**(AI提案とは独立した「メモとして残すかどうか」は完全に任意選択)。
- **「保存する」を押すまで一切DB非接触**(§2.3で詳述する自動保存禁止の実装方針)。

**確定事項(§0.1-3)**: 禁忌事項を含むすべての抽出項目はAIによる**候補表示に留まり、
自動保存は行わない**。スタッフがレビュー画面でチェックし「保存する」を押した項目のみが
DBへ書き込まれる。

## 2. AI解析設計(Claude API)

### 2.1 抽出スキーマ

既存の`app/api/customers/[id]/homecare-message/route.ts`と同一の呼び出し方式
(`fetch('https://api.anthropic.com/v1/messages')`、`ANTHROPIC_API_KEY`、
モデル`claude-haiku-4-5-20251001`、SDK不使用の生fetch)を踏襲する。

Claudeへの出力フォーマット指定(JSON):

```json
{
  "treatments":        [{ "content": string }],
  "skinCondition":      [{ "content": string }],
  "concerns":            [{ "content": string }],
  "precautions":         [{ "content": string }],
  "contraindications":   [{ "title": string, "description": string, "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL" }],
  "nextProposalCandidates": [{ "content": string }],
  "visitDate":           string | null
}
```

- `severity`は`contraindications`テーブルの既存CHECK制約(`LOW/MEDIUM/HIGH/CRITICAL`)に
  そのまま合わせる。
- `visitDate`(施術日)は正規表現による事前抽出も試み、Claude抽出結果と食い違う場合は
  スタッフに両方見せて選ばせる(自動確定しない)。
- 「注意事項」と「禁忌事項」の切り分けはプロンプトで明確に指示する: 禁忌事項は
  「今後この施術・成分を避けるべき明確な医学的理由があるもの」のみ、それ以外の
  一般的な気遣い事項は注意事項に分類させる(§3.2でも述べる「明確な禁忌事項のみ」という
  ユーザー確定方針をプロンプトレベルで反映する)。

### 2.2 プロンプト設計方針

- カルテ文章は敬語・省略・箇条書きが混在する日本語想定。既存の`homecare-message`/
  `line-message`のプロンプト設計(効果保証等の断定表現を生成させない制約、実データのみを
  使う制約)と同じ安全設計思想を踏襲する。
- **抽出のみを行わせ、要約や言い換えでの誇張を避ける**よう明示的に指示する
  (原文の意味を変えないこと、無い情報を創作しないこと)。
- 実際のSalon Boardカルテのフォーマットサンプルは本書作成時点で未入手
  （`docs/CALTE_IMPORT_DESIGN.md`§7項目3で既出の未解決事項）。プロンプトの具体的な
  文言は実装時に実サンプルを見て調整する前提とし、本書では抽出スキーマと安全設計方針のみ確定する。

### 2.3 自動保存禁止の徹底方法(設計での担保)

- 「解析」APIと「保存」APIを**物理的に別エンドポイント**に分離する(§8.2)。解析APIは
  DB書込コードを一切持たない(`app/api/admin/proposals`のGET/POST分離、
  `app/api/voice-pipeline`(preview)/`voice/commit`(save)分離と同じ設計パターン)。
- 保存APIは、解析結果をそのまま受け取るのではなく**フロントエンドでスタッフが選択・編集した
  結果のみ**を受け取る(コンポーネントのstateを経由しないと呼び出せない設計。API単体を
  直接叩いても「選択済みのitems配列」を渡さない限り何も保存されない)。
- `commitKarteImport()`という**単一の書込み関数**を新設し、customer_notes/contraindicationsへの
  INSERTはこの関数経由のみに限定する(`commitVoiceMemo.ts`の「単一書込み経路」という設計原則
  ―― ただし§7の通りコード自体は流用しない、原則だけを踏襲する新規実装)。

## 3. 保存先設計(確定)

### 3.1 `customer_notes`への保存

カルテ内容・会話・肌状態・悩み・注意事項・(選択された場合のみ)次回提案候補、をここへ保存する。

```
customer_id:   (legacy customersテーブルのid。§8.3のID橋渡し参照)
staff_id:      (保存操作をしたスタッフ)
note:          (各項目のcontent)
category:      NULL固定(§3.5)
source:        'salonboard'(migration採用確定。§0.1-4・§3.5・§8.3)
voice_note_id: NULL(音声メモ由来ではないため)
```

1カルテにつき、カテゴリごとに複数件が生成されうる(例: 肌状態2件+悩み1件+施術内容1件 なら
customer_notesへ4行)。1行1トピックの粒度に揃える(既存の音声メモAI由来ノートと同じ粒度感)。

### 3.2 `contraindications`への保存

「明確な禁忌事項のみ」。ユーザー確定方針通り、AIが「注意事項」と判定したものはここへは
保存しない(customer_notesへ)。

```
customer_id:    (legacy customersテーブルのid)
reservation_id: NULL(カルテ取込時点では特定の予約に紐付けない)
store_id:       NULL(既存の音声パイプラインのinsertと同じ扱い方に合わせる)
severity:       Claude抽出値(LOW/MEDIUM/HIGH/CRITICAL)
title:          Claude抽出値
description:    Claude抽出値
recommendation: NULL(Phase1では生成しない。将来的にrecommendationも抽出対象にするかは別途判断)
source:         'salonboard'(customer_notesと表記統一。この列はCHECK制約なしのtextのためmigration不要)
source_note_id: NULL(customer_notesの特定行に紐付けない。将来的に必要なら再検討)
confidence:     Claudeの抽出確信度があれば設定、無ければNULL
generated_at:   保存時刻
```

### 3.3 カルテ原文の保存(確定、新規テーブル)

「将来の再解析やプロンプト改善に利用できるようにする」という確定方針(§0.1-5)に基づき、
貼り付けられたカルテ原文をそのまま保持する新規テーブル`karte_imports`を新設する。

`customer_notes`は1カルテにつき複数行(カテゴリごと)に分解して保存する設計のため、
原文をそのまま保持する場所には向かない(分解後のテキストは編集・取捨選択を経ているため
原文と一致しない)。そのため原文専用の独立したテーブルとする。

```sql
create table karte_imports (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id),
  staff_id     uuid not null references brain_staff(id),
  raw_text     text not null,
  note_ids     uuid[] not null default '{}',           -- このカルテから生成されたcustomer_notes.idの一覧
  contraindication_ids uuid[] not null default '{}',    -- このカルテから生成されたcontraindications.idの一覧
  created_at   timestamptz not null default now()
);

alter table karte_imports enable row level security;
-- ポリシーはcontraindicationsに合わせ、AUTH-1 V2のcanAccessCustomer相当の制約をAPI層で担保する前提で
-- FOR INSERT/SELECT TO authenticated とする(既存のcontraindications/customer_notesの運用と同水準)
```

- `note_ids`/`contraindication_ids`は、`commitKarteImport()`が同一トランザクション相当の処理内で
  customer_notes/contraindicationsへINSERTした直後に採番されたidを追記する形で保存する
  (どのカルテ原文からどの保存済みデータが生成されたかを後から追跡できるようにする)。
- 表示UIはPhase1では設けない(原文はDBに保持するのみで、閲覧・再解析の実行UIはPhase2以降で検討)。
- この原文にはスタッフが「保存しない」を選んだ項目の元テキストも含まれる。原文保存自体は
  §3.4の「保存しないデータ」方針(customer_memories/brain_customers/AI提案直接データへの
  書き込み)とは独立した扱いであり、それらのテーブルには一切影響しない。

### 3.4 保存しないデータの扱い

- **`customer_memories`**: カルテ由来のデータは一切保存しない(絶対ルール、§1.4)。
- **`brain_customers`**: カルテ由来のデータで直接更新しない(customer_type等の構造化フィールドを
  カルテ文章から自動推定して書き換えるようなことはしない)。
- **`brain_visits`**: 「施術内容」はcustomer_notesへテキストとして保存するのみで、
  brain_visits.menu_id等への自動反映は行わない(メニュー名寄せの精度が保証できないカルテ文章から
  構造化データを自動生成するのは事故リスクが高いため、Phase1では明示的にスコープ外とする。
  将来的にPhase2/3で検討し得る拡張ポイントとして記録するに留める)。
- **AI提案直接データ**(`brain_pattern_fire_log`・`brain_proposal_outcomes`等): 一切書き込まない。
  「次回提案候補」はあくまでスタッフ向けの**参考メモ**であり、ProposalOrchestratorの
  意思決定プロセスには一切接続しない(選択されれば単なるcustomer_notesの1行になるだけ)。

### 3.5 重要発見: `category=NULL`は既に「カルテメモ」として定義済み

`app/api/customers/search-notes/route.ts`(既存の「会話履歴検索」機能、`CustomersScreen.tsx`から
利用)のコード・コメントを確認したところ、以下の対応がすでに存在していた:

```
会話メモ   … customer_notes.note (categoryが設定されている行。5カテゴリ or 音声メモAI自動保存由来)
カルテメモ … customer_notes.note (categoryが未設定の行。CustomerBottomSheetの自由記述メモ欄由来)
```

つまり`category IS NULL`の`customer_notes`行は、この検索機能上では**既に「カルテメモ」という
名前で扱われている**(現状はCustomerBottomSheetの手動メモ欄由来の行がこれに該当している)。

**設計への反映**: カルテ取込機能が保存する`customer_notes`行も`category = NULL`にすることで、
この既存の「カルテメモ」という意味づけと自然に一致する。**新しいcategory値を追加する
migrationは不要**。既存の検索UI(`CustomersScreen.tsx`の会話履歴検索)は変更なしで、
カルテ取込により保存された内容も自動的に「カルテメモ」として検索対象に入る
(追加のUI実装なしで検索機能が手に入る、望ましい副次効果)。

一方、`customer_notes.source`列には`CHECK (source IN ('voice_note','manual'))`という
制約があり、`'salonboard'`という値は現状使えない。**§0.1-4の確定事項により、この列へ
`'salonboard'`を追加するALTER migrationを採用する**(§8.3)。

## 4. UI設置場所の比較(確定: 案A採用)

比較の結果、**案Aを採用することが確定した**(§0.1-2)。以下は判断根拠として比較表を残す。

| 案 | 内容 | メリット | デメリット |
|---|---|---|---|
| **A. CustomerBottomSheet内**(顧客詳細) | `VoiceMemoSection`等と同じ並びに新規セクション追加 | 顧客が既に選択済みで顧客選択UIが不要。既存のVoiceMemoSection/CustomerMemorySectionと統一感のあるUX。スタッフが接客の流れの中で自然に使える | v1凍結ルールの直接対象。ファイルが既に2000行超と巨大でさらに複雑化。BottomSheetの限られた画面領域に新セクションを収める必要がある |
| **B. 顧客管理画面内**(`CustomersScreen.tsx`、顧客一覧) | 検索バー付近に新規エントリーポイントを追加、別モーダルで貼付フローを開く | 一覧から直接始められる(接客前の準備等にも使える)。CustomerBottomSheetほど画面が密集していない | 同じくv1凍結ルール対象(スタッフアプリ全体が対象のため)。顧客が未確定な状態から始まるため、明示的な顧客選択UIが追加で必要になり実装量が増える |
| **C. 管理者専用インポート画面**(`app/admin/**`) | `admin/csv-import`と同様の「アップロード→プレビュー→確定」パターンの新規画面 | v1凍結ルール(スタッフアプリ対象)の直接の対象外。実装パターンの前例が多い(CSV取込画面等) | **目的とのミスマッチが大きい**: この機能を使うのは接客するスタッフ本人であり、管理者権限を持たない一般スタッフはadmin領域にそもそもアクセスできない設計(AUTH-1/RBACの前提と矛盾する)。現場から離れた画面での運用は実務上非現実的 |

**確定: 案A**。目的(「スタッフが接客の場でカルテを取り込む」)に最も合致し、既存のVoiceMemoSection
と一貫したUXになる。案Cは権限モデル上ミスマッチが大きく不採用。案Bは将来的な拡張
(顧客未確定の状態からの起動)として、必要になれば案A実装後に別途検討する。

**v1凍結解除の範囲**: `CustomerBottomSheet.tsx`への新規セクション追加という具体的な変更内容を
明示したうえで、実装着手前に別途明示的な凍結解除承認が必要(§10)。

## 5. 既存システムへの影響確認

### 5.1 LINE生成(`/api/customers/[id]/line-message`)

`recentNoteSummaries`(customer_notes直近3件の内容)・`contraindicationTitles`
(contraindications.titleのみ)が既にプロンプトへ渡っている。カルテ取込で保存した
customer_notes/contraindicationsも、この既存の仕組みにそのまま乗る(**LINE側のコードは
一切変更しない**)。

**影響**: カルテ由来のメモが増えると、「直近3件」に含まれる内容がカルテ由来のものに
入れ替わる可能性がある。悪影響というより「情報が増えて文面の材料が増える」方向の変化だが、
カルテの記述量によっては1件の文字数が長くなり、プロンプトに渡す文字数が増える可能性がある
(既存コードは`.slice(0, 3)`で件数を絞っているが、1件あたりの文字数制限は無い模様。
実装時に長文カルテメモの扱い―― 切り詰めるか等 ―― を確認する必要がある)。

### 5.2 AI Timeline(`timeline_summary_cache`)

customer_notes/contraindicationsを一切参照しない完全に独立した系統
(`docs/CALTE_IMPORT_DESIGN.md`§4で確認済み、再確認の必要なし)。**Phase1では無関係**。
Phase2(§6)でAI Timelineへの反映を検討する。

### 5.3 AI提案(ProposalOrchestrator)

`fetchVoiceMemoContext()`経由でcustomer_notes/contraindicationsを取得しているが、
実際のスコアリング・表示のいずれにも使われていない実質デッドコード
([[project_customer_memory_audit1_findings]]で確認済み)。**Phase1ではカルテ取込データを
保存してもAI提案の挙動は一切変化しない**。Phase3(§6)で接続を検討する。

### 5.4 `customer_notes`既存利用箇所への影響(要注意点あり)

| 利用箇所 | 現状の挙動 | カルテ取込追加後の影響 |
|---|---|---|
| `CustomerNotesSection.tsx`(AIノート一覧表示) | `category IS NOT NULL`の行のみ表示 | カルテ取込行(`category=NULL`)は**この一覧には表示されない**(意図通り、既存の「AIノート」欄とは別物として扱われる) |
| `CustomersScreen.tsx`会話履歴検索 | `category`の有無で「会話メモ」/「カルテメモ」を判定 | カルテ取込行は自動的に「カルテメモ」として検索対象になる(§3.5、望ましい副次効果) |
| `CustomerBottomSheet.tsx`の手動メモ欄プリフィル | **`category`条件なしで直近1件を取得し「前回のメモ」として編集欄にそのまま表示する**（[[project_customer_memory_audit1_findings]]で既に指摘済みの「AI生成ノートと手動メモの混同」問題） | ⚠️ **要注意**: カルテ取込行も`category=NULL`のため、この「直近1件取得」の対象に含まれてしまう。カルテ由来の長文メモが直近になった場合、手動メモ編集欄に長文がそのままプリフィルされる可能性がある。**Phase1実装時に、このプリフィルロジックが`source`列(`'manual'`のみを対象にする等)で絞り込むよう調整するか、この問題を許容するかを判断する必要がある**(既存動作を壊さないためには対応が望ましいが、`CustomerBottomSheet.tsx`という凍結対象ファイルの追加変更になる点に注意) |
| LINE生成`recentNoteSummaries` | 直近3件をプロンプトに使用 | §5.1参照 |

### 5.5 `contraindications`既存利用箇所への影響

| 利用箇所 | 現状の挙動 | カルテ取込追加後の影響 |
|---|---|---|
| `CustomerBottomSheet.tsx`「今日気をつけること」(`allergyText`) | `title.includes('アレルギー')`の項目を抽出して表示 | カルテ由来の禁忌事項に「アレルギー」を含むtitleがあれば自動的にここに表示される(意図通り) |
| `app/api/today-briefing/route.ts` | 当日の禁忌事項一覧を取得して表示 | 同様に自動的に反映される(意図通り) |
| LINE生成`contraindicationTitles` | §5.1参照 | 同左 |

**共通の懸念**: いずれも表示側のロジックは無変更で「データが増えるだけ」のため、
既存機能を壊す変更にはならない。ただし**AIの誤検出・誤分類がそのまま「今日気をつけること」
表示に反映されてしまう**リスクがあるため、§1.3のレビュー画面での人間確認を必須プロセスとする
設計を厳守する。

## 6. 実装範囲の分離(確定)

- **Phase1(今回実装するスコープ)**: カルテ貼付 → Claude解析 → レビュー確認 → 保存
  (`customer_notes`/`contraindications`/`karte_imports`原文のみ)。
- **対象外(今回は一切着手しない)**:
  - AI提案改善(ProposalOrchestrator連携、旧Phase3相当)
  - 自動学習(AI Timelineへの反映改善、旧Phase2相当)
  - CSV連携(Salon Board CSV/API連携、旧案C相当)

Phase1の実装完了・実データでの運用を見てから、上記対象外項目の要否・優先度を改めて判断する。
今回はいずれにも一切着手しない。

## 7. 音声メモ3系統問題について

`docs/CALTE_IMPORT_DESIGN.md`§1.5で発見した「音声メモAI解析パイプラインが実質3系統並存」
問題は、**今回は触らない・別タスクとして扱う**（ユーザー確定方針）。本書のPhase1設計は
既存の音声パイプラインのコードを一切参照・流用せず、独立した新規モジュール
(`src/lib/karteImport/`)として設計する(§8)。保存先テーブル(customer_notes/contraindications)を
共有するのみで、書込みロジックは完全に別系統にする。

## 8. Phase1実装設計

### 8.1 新規ファイル一覧(実装フェーズの想定。今回は設計のみ)

```
supabase/migrations/
  <timestamp>_karte_import.sql — customer_notes.source CHECKへ'salonboard'追加(ALTER) +
                                   karte_imports テーブル新規作成(§3.3・§8.3)

src/lib/karteImport/
  analyzeKarteText.ts       — Claude呼び出し・抽出ロジック(DB非接触)
  commitKarteImport.ts      — 唯一の書込みオーケストレーション(repo注入・テスト容易)
  commitKarteImportRepo.supabase.ts — Supabase実装(customer_notes/contraindications/karte_imports insert)

app/api/customers/[id]/karte-import/
  analyze/route.ts          — POST。認証+canAccessCustomer、analyzeKarteText()呼び出し、DB非接触
  commit/route.ts           — POST。認証+canAccessCustomer、commitKarteImport()呼び出し、唯一の保存経路

src/components/customer/
  KarteImportSection.tsx    — 新規UIセクション(入力→レビュー→保存の3段階)

src/types/
  karteImport.ts            — 抽出候補・保存リクエストの型定義

tests/lib/karteImport/
  analyzeKarteText.test.ts
  commitKarteImport.test.ts
tests/api/
  karte-import-analyze.test.ts
  karte-import-commit.test.ts
```

変更ファイル(要凍結解除、§10):
```
src/components/customer/CustomerBottomSheet.tsx — KarteImportSectionの差し込み(1箇所)
```

### 8.2 API契約

**`POST /api/customers/[id]/karte-import/analyze`**（解析のみ・DB非接触）

```
Request:  { rawText: string }
Response: {
  success: true,
  extracted: {
    treatments: {id, content}[],
    skinCondition: {id, content}[],
    concerns: {id, content}[],
    precautions: {id, content}[],
    contraindications: {id, title, description, severity}[],
    nextProposalCandidates: {id, content}[],
    visitDateGuess: string | null,
  }
} | { success: false, error: string }
```

**`POST /api/customers/[id]/karte-import/commit`**（保存の唯一経路）

```
Request: {
  rawText: string,                                  // karte_importsへそのまま保存(§3.3、必須)
  selectedNotes: { content: string }[],             // customer_notesへ(category=NULL, source='salonboard')
  selectedContraindications: { title: string, description: string, severity: string }[],
  visitDate: string | null,                          // 参考情報として将来使う可能性(Phase1では未使用でも受け取りは可)
}
Response: {
  success: true,
  noteIds: string[],
  contraindicationIds: string[],
  karteImportId: string,
} | { success: false, reason: string }
```

`rawText`は選択状態に関わらず常に`karte_imports`へ1行保存する(§3.3・§0.1-5、
「保存する」操作が行われた時点でのカルテ全文を将来の再解析用に残す)。

認証はいずれも`extractStaffFromRequest` + `canAccessCustomer`(既存の`/api/proposals/fire`・
`/api/voice/commit`と同一パターン)。`requireAdmin`は使わない(スタッフ向け機能のため、
案A/Bいずれの場合も)。

### 8.3 DB変更要否(確定)

| 対象 | 要否 | 内容 |
|---|---|---|
| `customer_notes.category` | **不要** | `NULL`固定で既存の「カルテメモ」定義と一致(§3.5) |
| `customer_notes.source` | **必要(小規模migration・採用確定)** | 現行`CHECK (source IN ('voice_note','manual'))`に`'salonboard'`を追加するALTER(既存の`staff_logs`ALTER TABLE ADD COLUMNと同じ「追加のみ・破壊的変更なし」の方針)。§0.1-4で採用確定 |
| `contraindications.source` | **migration不要(値は'salonboard'に統一)** | CHECK制約が無いtext列のため、customer_notesと同じ`'salonboard'`をそのまま使える |
| `karte_imports`(新規テーブル) | **必要(新規作成・採用確定)** | カルテ原文保存用。§3.3のDDL参照。§0.1-5で採用確定 |
| ID橋渡し(legacy customers) | **変更なし** | `generateCustomerProposal.ts`の`fetchVoiceMemoContext()`と同じ氏名完全一致方式を踏襲。一致しない場合は「カルテ保存不可」である旨をスタッフに明示する(架空のID紐付けはしない、既存方針の継続) |

上記2件のmigration(`customer_notes.source`のALTER + `karte_imports`新規作成)は、他の既存
migrationと同様に**Claude Codeが直接DDLを実行する権限を持たない**ため、migrationファイルを
作成し、ユーザーがSupabase SQL Editor等で手動適用する運用を踏襲する。

## 9. テスト項目(想定)

- `analyzeKarteText.ts`: Claude呼び出しをモックし、レスポンスJSON→型付き候補への変換が
  正しいこと、Claude呼び出し失敗時のエラーハンドリング。
- `commitKarteImport.ts`: repo注入によるユニットテスト(`commitVoiceMemo.test.ts`と同型)、
  空配列(何も選択されなかった場合)は何も書き込まれないこと。
- `POST .../analyze`: 未認証401、権限外403、DB書込みが一切発生しないこと(モックrepoの
  insertが呼ばれないことを確認)。
- `POST .../commit`: 未認証401、権限外403、`customer_notes`は`category:null, source:'salonboard'`
  で保存されること、`contraindications`は選択された項目のみ`source:'salonboard'`で保存されること、
  `karte_imports`へ`rawText`が選択状態に関わらず必ず1行保存されること、
  空配列の場合はcustomer_notes/contraindicationsは何も保存されずsuccess:trueを返すこと
  (ただしkarte_importsへの原文保存は行われること)。
- 実データ確認: 実際のcanAccessCustomer/legacy customers名寄せを使った統合確認
  (既存の`/api/proposals/fire`検証時と同じ手法)。
- 手動UI確認: レビュー画面でのチェック解除が保存に反映されること、禁忌事項の強調表示、
  `CustomersScreen.tsx`の会話履歴検索でカルテ取込メモが「カルテメモ」として検索できること
  (§3.5の効果の実地確認)。

## 10. v1凍結ルールへの影響・承認事項

- `CustomerBottomSheet.tsx`への`KarteImportSection`差し込みは凍結対象。実装着手前に
  この1箇所への変更内容を明示したうえで、別途明示的な凍結解除承認が必要
  ([[project_staff_proposal_learning_pipeline_design]]・[[project_staff_logs_schema_mismatch]]
  と同じ手続き)。
- 新規APIルート(`karte-import/analyze`・`karte-import/commit`)・新規lib・新規型定義は
  これまでの前例(`POST /api/proposals/fire`等)と同様、既存ファイルの変更を伴わない
  新規追加のため、凍結ルールの直接の対象にはならない想定(最終判断はユーザーに委ねる)。
- LINE領域(`src/components/line/**`等)のコードは一切変更しない。§5.1の「LINE生成への
  間接影響」はプロンプトへ渡るデータが変わるだけで、LINEのコード自体への変更はゼロ。

## 11. 残る未確定事項・要ユーザー判断

§0.1の確定事項により、Phase1範囲・UI設置場所・禁忌事項の扱い・`customer_notes.source`
migration採用・原文保存方針・音声メモ3系統問題の扱いは全て確定した。残るのは以下の
実装ディテールのみ。

1. §5.4で見つけた「手動メモ欄プリフィルにカルテ取込メモが混入する」問題への対応要否
   (対応する場合は`CustomerBottomSheet.tsx`の追加変更が必要)。
2. §1.3のレビュー画面での各カテゴリのデフォルトチェック状態(施術内容/肌状態/悩みの
   ON/OFF方針。禁忌事項・注意事項はデフォルトONで確定済み)。
3. Salon Board実カルテのフォーマットサンプルの入手可否(§2.2、プロンプト精度に直結)。
4. `contraindications.recommendation`列をPhase1でClaudeに抽出させるか、Phase1では
   NULLのままにするか。
5. `visitDate`(施術日)抽出結果をPhase1で何かに使うか(現状は保存先が無いため参考表示のみ
   になる想定)、それとも今回は抽出自体を見送るか。

実装はまだ開始していません。上記の回答が揃い、`CustomerBottomSheet.tsx`への変更に対する
v1凍結解除の承認を得てから着手します。
