# Salon Boardカルテ文章 取込機能 調査・設計書

作成日: 2026-08-07
ステータス: **調査・設計のみ・実装未着手**

目的: スタッフがSalon Boardのカルテ内容をコピー＆ペーストし、Riora OS上で顧客情報・AI提案・
会話メモ・施術履歴として活用できるようにする。

## 0. 要約

先に結論を3点述べる。

1. **カルテ文章の保存先として最も適切な候補は`customer_notes`(会話メモ・カテゴリ付き)と
   `contraindications`(禁忌事項)**。両テーブルとも既存の音声メモAI解析パイプラインが
   実際に書き込んでいる実績があり、スキーマもカルテのような自由記述テキストの構造化保存に
   合っている。`customer_memories`(「覚えていること」)は**AI系機能への受け渡しが絶対禁止**の
   専用テーブルのため、カルテの中でも「個人的なエピソード」部分のみを慎重に振り分ける必要がある。
2. **重大な発見: 音声メモのAI解析パイプラインが実質3系統並存しており、どれが「正」か
   コード上一意に確定できない状態だった**（§1.5）。このため、今回の設計では既存の
   音声パイプラインのコードを直接流用・改修する方針は取らず、**同じ保存先テーブルを使う
   独立した新規パイプライン**として設計することを推奨する（後述§5）。
3. `customer_notes`/`contraindications`/`booking_prompts`/`handover_notes`はいずれも
   **legacyの`customers`テーブル**（`brain_customers`とは別ID空間）に紐づく。橋渡しは
   氏名完全一致でしか行われておらず、正式なID変換の仕組みは無い（§1.6）。

## 1. 現在の顧客データ構造の調査（保存先候補）

### 1.1 `brain_customers`（新ID空間の顧客マスタ）

```
id, store_id, name, age_group, customer_type(A_acne等), type_confidence, goal_note,
wedding_date, acquisition_channel, first_visit_date, assigned_staff_id, is_subscriber,
subscribed_at, churn_score, churn_reason, consent_anonymized_learning, created_at, deleted_at
```

**自由記述のメモ欄が存在しない。** カルテ文章の直接の保存先としては不適格
（構造化フィールドのみで、カルテのような長文テキストを持たせる設計にそもそもなっていない）。

### 1.2 `customer_notes`（会話メモ・legacy `customers` 紐付け）

列: `customer_id, staff_id, note, category, source, voice_note_id, created_at`
（`category`は`Family/Work/Health/Preference/Event`の5分類、`source`は`'voice_note'`等の由来識別）

- 既存の音声メモAI解析（`app/api/voice-pipeline/route.ts`）が実際に書き込んでいる
  （§1.5参照）。
- `CustomerBottomSheet.tsx`の手動メモ入力（`saveMemo()`）も同じテーブルへ直接insertしている
  （ただし`category`を付けずに保存するため、AI生成メモと手動メモが同じテーブル内で
  区別されている）。
- `CustomerNotesSection.tsx`が`category IS NOT NULL`のもののみを「🧠 AIノート」として一覧表示。
- **LINE文面生成(`/api/customers/[id]/line-message`)に実際に使われている**
  （`recentNoteSummaries`として直近3件の内容がプロンプトに渡る、コメントで確認済み）。
- カルテの「会話内容・要望・肌の悩み」等、テキストの本文をそのまま保存するのに最も自然な候補。

### 1.3 `contraindications`（禁忌事項・legacy `customers` 紐付け）

列: `customer_id, reservation_id, store_id, severity, title, description, recommendation,
source, source_note_id, confidence, generated_at`

- 音声メモAI解析パイプラインが書き込んでいる。`title`のみLINE文面生成のプロンプトへ
  「この禁忌に抵触する提案を避ける」制約として渡される（本文・詳細は渡さない設計）。
- カルテの「禁忌事項」欄の保存先として、構造(severity/title/description/recommendation)が
  そのまま合致する、専用設計されたテーブル。

### 1.4 `customer_memories`（「覚えていること」・`brain_customers`紐付け）

列: `customer_id, store_id, content, memory_type, trigger_date, importance, is_sensitive,
created_by, created_at`

**絶対ルール(`src/types/customerMemory.ts`冒頭に明記)**: `content`を
ProposalOrchestrator・FireScore・PatternEngine・LINE提案のいずれにも渡してはならない。
「覚えていてくれた」体験は売上提案・AI判定と完全分離する設計原則。

カルテ由来の「家族構成・記念日・趣味」等、業務に直結しない個人的な話題があれば
ここへ振り分けるのは自然だが、**AI提案・LINE生成には一切連携されない**ことを前提に扱うこと。

### 1.5 重大な発見: 音声メモAI解析パイプラインが実質3系統並存

カルテ取込機能の設計にあたり「既存の音声解析パイプラインを流用できないか」を調査したところ、
以下の3つの独立した実装が同居していることが判明した（過去の`docs/CUSTOMER_BRIEFING_AUDIT_1.md`
調査で発見された「2系統並存」から、今回さらに掘り下げてもう1系統見つかった形）。

| # | 実装 | 保存先 | 現在の接続状況 |
|---|---|---|---|
| A | `app/api/voice-pipeline/route.ts`（Whisper文字起こし→Claude 4カテゴリ解析→即保存の一体型） | `voice_notes`・`customer_notes`・`customer_memories`・`booking_prompts`・`handover_notes`・`contraindications`の**6テーブルへ直接書込み** | `transcribePreviewClient.ts`から呼ばれている(コメント上は「プレビューのみ・DB非接触」と説明されているが、**実装は明確にDB書込みを行っている**。設計意図とコードが食い違っている) |
| B | `src/lib/voice/commitVoiceMemo.ts`＋`app/api/voice/commit/route.ts`（VM-5〜VM-8再設計、「単一書込み経路」を鉄則として明記） | `voice_notes`・`customer_memories`の**2テーブルのみ** | API route自体は存在するが、**実際のUI(`VoiceMemoSection.tsx`)からは呼ばれていない**（grep確認済み、importなし）。ユニットテストは存在し通っている。 |
| C | `VoiceMemoSection.tsx`が実際に呼んでいる経路（`src/lib/voiceNote.ts`の`uploadVoiceNote()`＋`POST /api/customer-memories`個別呼び出し＋`extractCustomerNotes.ts`のキーワードベース分類） | `voice_notes`・`customer_memories` | **これが実際にスタッフのブラウザから到達する経路**。Claude解析は使わず、決定論的キーワードマッチングのみ。 |

**結論**: 「録音済みの音声メモがどう保存されるか」という一見単純な問いに対してすら、
コードベース内に3通りの答えが存在し、どれが実際に有効かはUIコンポーネントの実際の
import文を1つずつ確認しないと分からない状態だった。§1.2/§1.3で述べた
`customer_notes`/`contraindications`への書込み実績は**実装Aの存在によるもの**だが、
実装Aが実際に到達可能なコードパスなのか（`transcribePreviewClient.ts`の呼び出し先が
本当にこのファイルか、Next.jsのルーティング的に他の同名ファイルと衝突していないか)は、
本調査の範囲を超える別問題として切り分けた。

**カルテ取込機能への含意**: 上記の混乱を引き継がないため、**既存の音声パイプラインの
コードを直接流用・改修する設計は取らない**。代わりに、`customer_notes`/`contraindications`/
`customer_memories`という「保存先テーブル」だけを共有し、カルテ取込専用の独立した新規保存経路
（commitVoiceMemo.tsの「単一書込み経路」の考え方をカルテ版として新規に作る）を設計する
（§5）。

### 1.6 ID空間の橋渡し問題（既存の制約をそのまま引き継ぐ）

`customer_notes`/`contraindications`/`booking_prompts`/`handover_notes`はいずれも
`customer_id`が**legacyの`customers`テーブル**を参照する設計（`brain_customers`とは別テーブル・
別ID空間）。現在の唯一の橋渡し手段は`generateCustomerProposal.ts`の`fetchVoiceMemoContext()`が
使っている**氏名の完全一致検索**（一致0件/複数件の場合はその旨をそのまま返す、架空のID紐付けは
しない設計）。

カルテ取込機能もCustomerBottomSheet（`brain_customers`空間で顧客を特定する画面）から
起動する前提のため、同じ氏名一致方式を踏襲する必要がある。**新しいID変換の仕組みを
作るのは今回のスコープ外**とし、既存の妥協的な設計（一致しない場合は保存できない旨を
明示してスタッフに伝える）をそのまま踏襲することを推奨する。

### 1.7 `brain_visits` / `staff_logs`（施術履歴・接客ログ）

- `brain_visits`: 構造化された来店記録（メニューID・金額・次回予約有無等）。フリーテキストの
  カルテ全文を保持するカラムは無い。
- `staff_logs`: 2026-08-07の修正後も、フリーテキスト欄`log_text`は**旧スキーマにのみ存在**
  （新スキーマの6列は全てboolean、[[project_staff_logs_schema_mismatch]]参照）。現在の
  `CustomerBottomSheet.tsx`の接客ログ保存はこの`log_text`欄を使っていない。カルテの保存先
  としては使われていない・使う設計にもなっていない。

## 2. 現在の入力導線の調査

| 画面/機能 | 現状 |
|---|---|
| `CustomerBottomSheet.tsx`の手動メモ(`saveMemo()`) | `customer_notes`へ直接insert(category無し)。単純なtextarea1つのみのシンプルなUI |
| `CustomerNotesSection.tsx` | `customer_notes`(category付き)の一覧表示専用。入力UIは持たない |
| `VoiceMemoSection.tsx` | 録音→文字起こし→確認・編集→カテゴリ分類候補のチェックボックス選択→保存、という
  「素材(音声) → AI解析 → レビュー → 選択保存」の4段階UIが既に確立している。**この構造は
  カルテ貼り付け機能にそのまま応用できる**(素材が音声Blobではなくペーストされたテキストに
  変わるだけ) |
| `CustomerMemorySection.tsx` | `customer_memories`専用の追加フォーム(内容/カテゴリ/重要度/日付/Sensitive) |
| テキスト貼り付け(paste)UI | **既存では見つからなかった(新規)** |

**自然な追加先の判断**: `VoiceMemoSection.tsx`が持つ「素材→AI解析→レビュー→選択保存」の
UXパターンが最も近い。同じCustomerBottomSheet内に**新規セクション「カルテ取込」**として
追加し、録音ボタンの代わりにtextarea(貼り付け)を置く設計が自然（音声メモと同じ場所に
並べる、または統合タブとして同居させる、のいずれかは要判断・§7参照）。

## 3. Salon Boardカルテ貼り付け時に必要な処理の設計

| 処理 | 難易度 | 備考 |
|---|---|---|
| テキスト貼り付けUI | 低 | textarea 1つ + 「解析する」ボタン。新規UI |
| 日付抽出(施術日) | 低 | 正規表現ベースで十分（Salon Boardのカルテは日付フォーマットが比較的定型と想定されるが、実際のフォーマットのサンプルは今回未入手。実装時に実サンプルの確認が必須） |
| 施術内容抽出 | 中 | `src/lib/import/menuResolver.ts`(CSV取込で使っている既存のメニュー名寄せロジック)と同種のアプローチが使える可能性。ただし用途がCSV(列が決まっている)とカルテ(自由文中に埋もれている)で異なるため転用には調整が要る |
| 肌状態・悩み抽出 | 中〜高 | `extractCustomerNotes.ts`(決定論キーワードマッチ)は「家族/仕事/健康/好み/イベント」向けで肌状態カテゴリを持たない。新規キーワードルール追加か、`app/api/voice-pipeline/route.ts`が使っているClaude解析パターン(4〜5カテゴリ同時抽出)を参考にした新規LLM解析が必要 |
| 禁忌事項抽出 | 中 | `contraindications`テーブルの構造(severity/title/description/recommendation)に合わせた抽出。安全に関わるため精度要求が高く、AI解析後は必ずスタッフの目視確認・選択制にすべき(§5) |
| 会話メモ化 | 低〜中 | `customer_notes`への保存。カテゴリ分類はキーワードorLLM |
| AI提案への反映可否 | 要判断 | §4で詳述。現状ProposalOrchestratorはvoiceMemoContextを事実上使っていない(表示・スコアリングとも未接続)ため、「反映される」という期待値をユーザーに持たせないよう注意 |

**推奨する処理フロー(§5案Bの内部設計)**:
1. テキスト貼り付け
2. Claude(Haiku等、既存の音声解析と同一モデル)で構造化抽出:
   `{ date: string|null, treatments: string[], skinConcerns: string[],
      contraindications: {severity,title,description}[], conversationNotes: string[],
      personalNotes: {content, memoryType}[] }`のようなJSON
3. カテゴリ別プレビュー画面(VoiceMemoSectionのレビュー画面と同じUXパターン)でスタッフが
   各項目をチェック/編集/除外
4. 選択された項目のみ、テーブル別に保存:
   - `treatments`/`date` → 表示のみ(brain_visitsへの自動反映はしない、§4で理由を説明)
   - `skinConcerns`/`conversationNotes` → `customer_notes`(category付き)
   - `contraindications` → `contraindications`テーブル
   - `personalNotes` → `customer_memories`

## 4. 既存AI機能との接続確認

| 機能 | customer_notes | contraindications | customer_memories | 判断 |
|---|---|---|---|---|
| **AI Timeline**(`timeline_summary_cache`) | 未接続(grep確認: 参照ゼロ) | 未接続 | 専用(Timeline側が独自に生成する要約とは別物) | カルテ取込データはAI Timelineには反映されない。反映させるには別途Timeline生成ロジックの拡張が必要(今回のスコープ外) |
| **AI提案エンジン**(ProposalOrchestrator) | `fetchVoiceMemoContext()`経由で取得しているが**実際のスコアリング(PatternScorer/PatternMatcher)には一切使われていない**、返り値に含まれるだけで表示にも使われない(実質デッドコード、[[project_customer_memory_audit1_findings]]で確認済み) | 同上 | **絶対に渡さない**(絶対ルール) | カルテ由来の`customer_notes`/`contraindications`を増やしても、現状のAI提案は変化しない。「AI提案に反映される」と謳うのは誤解を招くため、MVPでは「表示・記録のみ」と明確に説明すべき |
| **LINE提案**(`/api/customers/[id]/line-message`) | `recentNoteSummaries`として直近3件の内容がプロンプトに渡る(**実際に使われている**) | `title`のみ制約として渡る(**実際に使われている**) | **絶対に渡さない**(絶対ルール) | カルテ由来の`customer_notes`/`contraindications`は、保存されるだけで自動的に次回のLINE文面生成に反映される(良い意味で既存の仕組みに乗る) |

**結論**: `customer_notes`と`contraindications`は「保存すれば既存のLINE提案に自然に活きる」
実利用中のテーブル。一方`AI提案エンジン`(ProposalOrchestrator)は現状これらを実質使っていない
ため、カルテ取込機能を「AI提案が賢くなる機能」として説明するのは正確ではない。
`customer_memories`は設計原則通りAI系には一切渡らない。

## 5. MVP案(3段階)

### 案A（最小）: 単純カルテメモ保存のみ

貼り付けたテキストをAI解析せず、そのまま1件のメモとして保存する
（例: `customer_notes`へ`category='karte_raw'`のような専用値で1行insert、または日付を
手動入力させて`created_at`相当の情報として持たせる）。

- **メリット**: 実装が非常に小さい(既存`saveMemo()`とほぼ同じ形)。AI解析の精度リスクが無い。
  すぐに「検索できる形で残る」という最低限の価値は出る。
- **リスク**: 構造化されないため、施術内容・禁忌事項等をカルテ全文から探す手間はスタッフに残る。
  「AI提案・会話メモ・施術履歴として活用」という目的の後半3つ(施術履歴としての活用等)は
  ほぼ達成できない。
- **実装範囲**: `customer_notes`へのinsert1本+textarea UI。新規テーブル・migration不要。

### 案B（推奨）: 貼り付け → AI解析 → 顧客情報へ分類保存

§3の処理フローの通り。Claude解析でカテゴリ別候補を抽出し、スタッフが確認・選択してから
`customer_notes`/`contraindications`/`customer_memories`へ振り分け保存する。

- **メリット**: 目的に最も合致する。既存の音声メモUXパターン(素材→AI解析→レビュー→選択保存)を
  踏襲できるため、スタッフの学習コストが低い。保存先を既存テーブルに寄せるため、
  LINE提案には自動的に活きる(§4)。
- **リスク**: Claude解析の精度(特に禁忌事項の誤検出・見落とし)は安全に関わるため、
  「AIが自動保存する」のではなく「AIが候補を出し、スタッフが必ず確認してから保存する」
  設計を厳守する必要がある(既存のVoiceMemoSectionと同じ思想)。§1.5の「3系統並存」問題を
  繰り返さないよう、保存経路は新規に1本だけ作る設計規律が必要。
- **実装範囲**: 新規textarea UI・新規Claude解析API・新規レビューUI(VoiceMemoSectionの
  レビュー画面を参考に新規実装)・`customer_notes`/`contraindications`/`customer_memories`への
  保存(いずれも既存テーブル、migration不要)。

### 案C（高度）: Salon Board CSV/カルテ完全連携

Salon Board側のAPIまたはエクスポート機能と直接連携し、コピー&ペースト自体を不要にする
(自動取得・自動反映)。

- **メリット**: スタッフの手作業(コピー&ペースト)自体が無くなる。将来的な理想形。
- **リスク**: Salon Board側が公式APIを提供しているか不明(要調査、本設計書のスコープ外)。
  提供が無い場合はスクレイピング等の非公式手段が必要になり、Salon Board側の利用規約・
  仕様変更リスクを負う。実装規模も大きい。
- **実装範囲**: 未調査(Salon Board側の技術的制約次第で大きく変わるため、本設計書では
  範囲の見積り自体を行わない)。

**推奨**: 案Bをまず実装し、実データでの解析精度・スタッフの利用実態を見てから、
必要であれば案Cを別途検討する。案Aは「まず動くものが欲しい」場合の中間ステップとしてのみ検討。

## 6. v1凍結ルールへの影響確認

`CLAUDE.md`により、`CustomerBottomSheet.tsx`を含むスタッフアプリv1は凍結中。v1.0.1の
凍結解除は「今日タブのブリーフィング仕様」に限定されており、本機能はその対象外。

- **CustomerBottomSheetへの新規セクション追加**(案A/B共通): 凍結対象。実装前に別途
  明示的な凍結解除承認が必要（[[project_staff_proposal_learning_pipeline_design]]・
  [[project_staff_logs_schema_mismatch]]と同じ手続きを踏む想定）。
- **新規APIルート**(`/api/customers/[id]/karte-import`のような新設エンドポイント想定):
  これまでの前例(`POST /api/proposals/fire`等)と同様、既存のAPI Route追加は凍結の対象外
  として扱われてきたが、最終的な凍結解除範囲の線引きはユーザー判断に委ねる。
- **`customer_notes`/`contraindications`/`customer_memories`への書込みロジック追加**:
  これらのテーブル自体はLINE領域(`src/components/line/**`等)ではないため、LINE凍結ルールには
  抵触しない。ただし`customer_notes`の内容がLINE文面生成のプロンプトに使われる(§4)という
  **間接的な影響**があるため、LINE生成の出力内容が変わりうる点は実装時に明示しておくべき
  (LINEのコード自体は変更しないが、入力データが変わることで出力が変わる)。
- **`customer_memories`関連の変更**: 触れる場合は§1.4の絶対ルール(AI系への非連携)を厳守。

**結論**: 本機能はCustomerBottomSheetという凍結対象領域への機能追加を伴うため、実装着手前に
今回のスコープ(具体的な追加ファイル・セクション名)を明示したうえで、改めて凍結解除の
明示承認を得る必要がある。

## 7. 未確定事項・要ユーザー判断

1. MVP範囲は案A/B/Cのどれで進めるか（本調査では案Bを推奨）。
2. UIの設置場所: `VoiceMemoSection.tsx`と同じ並びに新規「カルテ取込」セクションを追加するか、
   将来的に音声メモと統合したタブ構成にするか。
3. Salon Boardの実際のカルテ文章のサンプル（フォーマット・改行・日付表記等）を入手できるか。
   これが無いと§3の抽出ロジック(特に日付・施術内容抽出)の精度設計ができない。
4. 禁忌事項の自動抽出について、安全上どこまでAIの判断を信用してよいか(例: 「必ずスタッフが
   目視確認してから保存」を必須プロセスとするか、それとも一定の確信度以上は自動保存を許すか)。
5. §1.5で発見した「音声パイプライン3系統並存」問題は、本機能とは別に整理・是正すべきか
   （本設計書のスコープ外だが、放置すると今後も同種の混乱の原因になりうる）。

実装はまだ開始していません。上記の回答が揃い、v1凍結解除の承認を得てから着手します。
