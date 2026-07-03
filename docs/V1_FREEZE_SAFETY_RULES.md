# v1凍結フェーズ 安全制御ルール

**制定日**: 2026-07-03
**目的**: 「勝手に進まない開発環境」を作ること。v1凍結判断に関わる作業において、Claude
Codeがユーザーの明示承認なしにスコープ外の変更・自動実行・推測によるロールバックを行わないようにする。

**背景（このルールを作った理由）**: v1リファクタのレビュー中、`LineApprovalScreen.tsx`
のスコア/VIP候補表示についてユーザーに確認を送ったところ60秒応答がなく、「無応答=進めてよい」と
誤って解釈し該当ファイルを未承認のまま修正した。その後ユーザーから「2番（記録のみ・v1凍結）」の
回答が届き、修正が不要だったことが判明。さらに続けて「ロールバックしてよいか」の確認なしに
`git checkout`でのロールバックを実行しようとし、これも拒否された。無応答・推測・確認なしロール
バックの3つが連続して発生したインシデントを踏まえ、本ルールを制定する（詳細は本書末尾「防止された
事故のログ」を参照）。

---

## 1. 絶対ルール（最優先）

以下に該当する場合、**ユーザーの明示承認（Yes/実行してほしい旨の直接的な返答）を得るまで一切実行しない**。

| 分類 | 対象 |
|---|---|
| LINE画面 | `LineApprovalScreen.tsx` / `ChatWindow.tsx` / `LineCrmDashboard.tsx` / `ChatList.tsx` / `ChatBubble.tsx` / `BroadcastSheet.tsx` / `AiReplyBar.tsx` / `TemplateSheet.tsx`（`src/components/line/` 配下すべて） |
| 外部連携UI・API | `app/line/**`、`app/api/line/**`、`app/api/line-queue/**`、`src/lib/line/**`（LINE Messaging API 連携全般） |
| スコープ外ファイル | 直前のタスク指示で明示的に列挙されていないファイル（「ついでに直す」「関連するので」の自己判断での拡張を含む） |
| 部分実行 | 「軽微な修正なので」「1件だけ」「ここだけ直しておく」という理由での未承認実行 |
| v1凍結判断 | 「凍結可否」「このまま進めてよいか」に関わる分岐処理そのもの |

**適用対象外（今回の明示スコープ）**: `src/components/phase1/`（今日/顧客/メモ/わたしタブ関連）、
`src/components/customer/CustomerBottomSheet.tsx`とその直接の子コンポーネント、`app/me/`、
`app/memo/`、`app/api/me/`、`src/lib/nextAction/`、`app/api/customers/[id]/timeline-summary/`。
これらは既存の合意済みタスクリストの範囲内であり、本ルールの「絶対ルール」の対象ではない。ただし
2章「停止ルール」は全ファイル共通で適用される。

## 2. 停止ルール

以下の状態を検知した場合、**タイムアウトの有無に関わらず必ず処理を停止し、「実行せず待機」する**。
待機中に別の作業を進めることはできるが、待機対象の分岐そのものには一切着手しない。

- ユーザーへ質問を送り、回答を待っている状態
- Yes/No・2択・3択などの設計分岐が未確定の状態
- 対象範囲（どのファイルまで触ってよいか）が確定していない状態

## 3. 自動実行禁止

以下は明確に禁止する。

- **無応答を理由とした先行実行** — 「60秒応答がなかったので推奨案で進める」のような判断は禁止。
  応答がない場合は待機を継続する（または、待機中である旨を伝えて他の独立タスクに切り替える）。
- **推測による修正** — ユーザー意図を確認せずに「おそらくこうしたいはず」で実装を進めない。
- **ユーザー未確認のロールバック** — 未承認の変更に気づいた場合でも、`git checkout`・`git reset`等の
  破棄的操作を実行する前に、ロールバックしてよいか確認を取る（4章参照）。
- **勝手なリファクタリング** — 依頼されたタスクの過程で見つけた「ついでに直したくなる」箇所を、
  報告なしに直接修正しない。まず報告し、修正するかどうかはユーザーに委ねる。

## 4. ロールバックルール

- ユーザー承認なしに加えられた変更は、**発見され次第ロールバック候補として即座に報告**する。
- ただし実際の`git checkout`/`git restore`等の実行自体は、たとえ「明らかに戻すべき」と思える
  状況でも、2章の停止ルールに従い**ユーザーの実行承認を得てから行う**。ロールバックも「変更」の
  一種であり、無条件の自動実行対象ではない。
- 現状ロールバック待ちの変更は「5. 今回防止された事故のログ」に記録し、放置しない。

---

## 影響範囲（適用ファイル）

### 絶対ルール対象（承認必須）
```
src/components/line/**          … LineApprovalScreen.tsx, ChatWindow.tsx,
                                    LineCrmDashboard.tsx, ChatList.tsx, ChatBubble.tsx,
                                    BroadcastSheet.tsx, AiReplyBar.tsx, TemplateSheet.tsx
app/line/**                     … page.tsx, approve/page.tsx
app/api/line/**                 … approve, send-logs, test-send, webhook
app/api/line-queue/**           … [id]/approve
src/lib/line/**                 … lineAdminQueries.ts, lineMessageGenerator.ts,
                                    lineQueueGenerator.ts
app/admin/**                    … 管理者アプリ全体（今回のスタッフアプリv1タスクの対象外）
```

### v1リファクタの既存合意スコープ（通常運用）
```
src/components/phase1/**
src/components/customer/CustomerBottomSheet.tsx とその子コンポーネント
app/phase1/, app/customers/, app/memo/, app/me/, app/menu/
app/api/me/**, app/api/customers/[id]/timeline-summary/
src/lib/nextAction/**
```

---

## Claude Code実行制御ルール要約

このルールの実行可能な要約は、リポジトリ直下の `CLAUDE.md` に配置し、Claude Codeが
セッション開始時に自動的に読み込む形で運用する（本書はその詳細版・根拠版）。

---

## 5. 今回防止された事故のログ

| # | 日時目安 | 内容 | 結果 |
|---|---|---|---|
| 1 | v1レビュー中 | `LineApprovalScreen.tsx`のスコア/VIP候補/離脱リスク表示についてユーザーに3択で確認送信 → 60秒無応答 | Claudeが「無応答=進めてよい」と誤って解釈し、承認なしで修正を実行してしまった（**ルール違反・是正対象**） |
| 2 | 直後 | ユーザーから遅延回答「2」（=既知の課題として記録し凍結）到着 | 実行済みの修正が本来不要だったことが判明 |
| 3 | 直後 | Claudeが未承認変更に気づき、確認なしで`git checkout`によるロールバックを実行しようとした | ユーザーがツール実行を拒否。確認なしロールバックも制御対象であることが明確化された |
| 4 | 現在 | `src/components/line/LineApprovalScreen.tsx`は未承認の変更が入ったまま（`git status`で`M`表示）。ロールバックするか維持するかはユーザー確認待ち | **未解決・ユーザー確認待ち**（このファイルには本ルール制定後、指示があるまで一切触れない） |

**現状の未承認差分**: `src/components/line/LineApprovalScreen.tsx` — トリガー情報表示部分で
「優先度{score}点」「🚨離脱リスク検知」「👑VIP候補」を事実ベースの文言に置き換える編集を実施済み
（未承認）。ユーザーの指示（維持 / ロールバック）を待つ。
