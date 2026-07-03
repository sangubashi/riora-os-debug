# 音声メモパイプライン実機検証手順

**目的**: 現在のVercel環境で`OPENAI_API_KEY`・`ANTHROPIC_API_KEY`が実際に動作しているかを、
実機での録音・保存操作を通じて確認する。

**対象エンドポイント**: `app/api/voice-pipeline/route.ts`（`POST /api/voice-pipeline`。
クライアントは録音保存直後にfire-and-forgetで呼び出す。`app/api/voice/pipeline/route.ts`は
未使用の重複コードのため対象外）

**前提**: `insight_tags`保存処理は実装済み（P0対応済み、2026-07-03）。本手順はその実機確認も兼ねる。

---

## 1. 確認手順

### 手順A: 音声メモを1件録音・保存する

1. スタッフアプリにログインし、メモタブまたは顧客詳細シートから任意の顧客を選択
2. 音声メモの録音を開始し、10〜20秒程度話してから停止
3. 確認画面が表示される（**この画面のtranscriptは仕様上常に定型文のモックです。実際の発話内容とは無関係なため、本検証では無視してよい**）
4. 表示された記憶候補のうち任意のものを選択（または未選択のまま）「保存」を実行
5. 保存が完了したら、保存時刻・顧客名・録音の長さ（秒）を記録しておく（後述のSQL検索で使用）

### 手順B: 直後にVercelログを確認する（2章参照）

保存直後（数秒〜十数秒後）、`/api/voice-pipeline`のログを検索する。

### 手順C: `voice_notes`テーブルを直接確認する（3章参照）

---

## 2. ログ確認（成功時・失敗時の判定）

Vercelランタイムログを`query="pipeline"`で検索する（このプランのログ保持期間は短いため、
録音後できるだけ早く確認すること）。

### 正常系の実行順序（ログは以下の順に出力される）

```
[pipeline] 音声ダウンロード完了 size=... type=...
  ↓
（Whisperの分岐）
  ↓
[pipeline] Claude解析完了 cn=N ci=N
[pipeline] insight_tags抽出完了: N件 [タグ名, ...]
[pipeline] voice_notes保存確認: transcript=N文字 summary=N文字 insight_tags=N件
  ↓
[pipeline] customer_notes N件保存   （customerNotesが1件以上ある場合のみ）
[pipeline] booking_prompts 保存完了
[pipeline] handover_notes 保存完了
[pipeline] contraindications N件保存  （contraindicationsが1件以上ある場合のみ）
[pipeline] 全処理完了: {...}
```

### Whisper（文字起こし）の判定

| ログ | 判定 |
|---|---|
| `[pipeline] Whisper transcript (N文字): ...…` | ✅ **本物**。OpenAI Whisperが実際に音声を文字起こしした |
| `[pipeline] OPENAI_API_KEY 未設定 → mock transcript 使用` | ❌ **モック**。`OPENAI_API_KEY`が未設定 |
| `[pipeline] Whisper 失敗 → 空transcript で続行: <エラー内容>` | ⚠️ **鍵は設定されているがAPI呼び出し失敗**（音声形式・タイムアウト等）。エラー内容を確認 |

### Claude（4カテゴリ解析）の判定

Claudeの成功/失敗を直接示すログは無いため、`summary`の中身と以下のログの組み合わせで判定する。

| ログ | 判定 |
|---|---|
| （`ANTHROPIC_API_KEY 未設定`ログが出ない、かつ`Claude API error`も出ない） | ✅ **本物の可能性が高い**。ただし確実な判定は3章のSQLで`summary`の文面を見る必要がある（`"次回接客メモ: "`で始まる場合はモック確定、後述） |
| `[pipeline] ANTHROPIC_API_KEY 未設定 → mock analysis 使用` | ❌ **モック確定**。`ANTHROPIC_API_KEY`が未設定 |
| `[pipeline] Claude API error: <status> <本文>` | ⚠️ **鍵は設定されているがAPI呼び出し失敗**。ステータスコードとエラー本文を確認（レート制限・モデル名不正・鍵の権限不足等） |
| `[pipeline] Claude parse error: <エラー>` | ⚠️ **API呼び出しは成功したがJSONパースに失敗**。Claudeの応答形式が想定と異なる |

### `insight_tags`の判定（新規追加分・P0対応済み）

| ログ | 判定 |
|---|---|
| `[pipeline] insight_tags抽出完了: N件 [...]` | ✅ 抽出処理は必ず実行される（transcriptが本物でもモックでも動く。決定論的キーワードマッチングのためAPI鍵と無関係） |
| `[pipeline] voice_notes保存確認: ...insight_tags=N件` | ✅ DB保存が成功したことの確認ログ |
| このログが出ずに`[pipeline] voice_notes update error: ...`が出る | ❌ DB更新失敗。エラーメッセージを確認 |

### 異常系（処理全体が失敗した場合）

```
[pipeline] エラー: <エラー内容>
```
このログが出た場合、`voice_notes.analysis_status`は`'failed'`に更新され、`transcript`/`summary`/`insight_tags`はいずれも更新されない（保存前の状態のまま）。

---

## 3. `voice_notes`確認SQL

Supabase SQL Editor、または `mcp__plugin_supabase_supabase__execute_sql`（project_id: `ohszxgajckzphhfhdrsv`）で実行する。

### 3-1. 直近の音声メモを確認（保存直後の1件を特定する）

```sql
select
  id,
  customer_id,
  staff_id,
  duration_sec,
  analysis_status,
  transcript,
  summary,
  insight_tags,
  created_at,
  analyzed_at
from voice_notes
order by created_at desc
limit 5;
```

### 3-2. モック判定用（文言パターンでの自動判定）

Whisperモックの定型文・Claudeモックの`"次回接客メモ: "`接頭辞に一致するかどうかを機械的に判定する。

```sql
select
  id,
  created_at,
  analysis_status,
  duration_sec,
  case
    when transcript in (
      'お肌の乾燥が気になるとのことでした。',
      '娘さんの誕生日イベントに向けてケアしたいとのことでした。仕事が残業続きで乾燥とエイジングが気になると話していました。',
      '今日のお客様は家族旅行の予定があり、お子さんの入学式に向けてお肌をきれいにしたいとのことでした。職場では残業が多くて疲れている様子で、睡眠不足による肌荒れが悩みとのこと。次回は美白ケアを試してみたいとのことでした。'
    ) then 'Whisper=モック（定型文と完全一致）'
    when transcript is null or transcript = '' then '文字起こしなし（空 or 未処理）'
    else 'Whisper=本物の可能性が高い（要目視確認）'
  end as whisper_judgement,
  case
    when summary like '次回接客メモ: %' then 'Claude=モック（mockAnalysis()由来の接頭辞）'
    when summary is null then '未処理'
    else 'Claude=本物の可能性が高い（要目視確認）'
  end as claude_judgement,
  coalesce(array_length(insight_tags, 1), 0) as insight_tags_count,
  insight_tags
from voice_notes
order by created_at desc
limit 5;
```

### 3-3. 特定の顧客・時間帯で絞り込む（手順Aで記録した情報を使う）

```sql
select id, analysis_status, transcript, summary, insight_tags, created_at, analyzed_at
from voice_notes
where customer_id = '<手順Aで選択した顧客のID>'
  and created_at >= now() - interval '15 minutes'
order by created_at desc;
```

### 3-4. 確認項目チェックリスト（SQL結果に対して目視で判定）

| 項目 | 確認内容 |
|---|---|
| `analysis_status` | `'completed'`になっているか（`'failed'`や`'processing'`のまま止まっていないか） |
| `transcript` | 3-2の`whisper_judgement`が「本物の可能性が高い」で、かつ実際に自分が話した内容に近いか |
| `summary` | 3-2の`claude_judgement`が「本物の可能性が高い」で、`"次回接客メモ: "`の定型接頭辞ではなく、transcriptの内容を踏まえた要約になっているか |
| `insight_tags` | 空配列`{}`ではなく、話した内容に対応するタグ（例: 「乾燥」と話せば`dryness_concern`）が入っているか |

---

## 4. 本ドキュメントの使い方

1. 1章の手順Aで実機録音・保存を実施
2. 2章のログ一覧と照合し、Whisper・Claudeそれぞれが本物/モック/エラーのどれだったかを判定
3. 3章のSQLを実行し、DBに実際に保存された内容を確認
4. 結果をまとめ、`OPENAI_API_KEY`・`ANTHROPIC_API_KEY`がVercel環境で有効に機能しているかを結論づける

本ドキュメントの作成に伴うコード変更は行っていません。
