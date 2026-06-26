# LINE画面本物化(Pass G) 完成レポート

作成日: 2026-06-25
DB調査の詳細: `docs/LINE画面_DB調査レポート.md`

## 0. 着手前の重大な発見

調査の結果、当初タスクで対象とされた`scenario_trigger_log`/`scenario_outcomes`は**本番に存在せず**(設計書のみ・マイグレーション未作成)、`brain_scenarios`/`brain_pattern_fire_log`/`brain_line_send_queue`も0件で、Brain側のLINE機構は実質未稼働だった。

一方、顧客に紐付く実メッセージを持つ唯一のテーブル`line_logs`(18件)は、`scripts/demo_seed_fixed.sql`によって**作文された架空の会話**だと判明した。本物の送受信実績は`line_send_logs`(Webhookログ・実データ)にあったが、Webhookは`follow`/`unfollow`のみ実装で`message`イベント(顧客からの実受信)は未実装だったため、**顧客から実際に受信した本文を保存する仕組み自体が存在しなかった**。

この2点をユーザーに報告し、(1) `/admin`側に新規LINE画面を作る、(2) Webhookに`message`イベント処理を追加し以降の実会話を記録できるようにする、という方針の確認を得て実装した。

## 1. 実装内容

### Webhook修正(最小限・設定変更なし)

`app/api/line/webhook/route.ts`に`handleMessage()`を追加。`message`イベント受信時、テキストメッセージはその実本文を、非テキスト(画像/スタンプ等)は`[非テキストメッセージ: <type>]`という種別名のみを`line_send_logs`に保存する(架空の本文は作らない)。`line_user_ids.customer_id`が紐付け済みなら`metadata.customer_id`に実紐付け結果を残す。署名検証・follow/unfollow処理・既存のWebhook設定(チャネルシークレット等)は無変更。

### 新規データアクセス層

`src/lib/line/lineAdminQueries.ts` — 旧`customers`ID空間の実テーブル(`line_send_logs`/`line_send_queue`/`line_user_ids`/`line_templates`/`template_categories`)への薄いクエリ関数群。`line_logs`(架空データ)は使用しない。follow/unfollowイベントや、Webhook修正前の`[WEBHOOK incoming] message`プレースホルダ本文は「会話内容ではない」として明確に除外する。

### 新規API(`/admin`配下・既存テーブル構造の変更なし)

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/admin/line/threads` | チャット一覧(recipient_idで集約・実顧客名/LINE表示名を解決) |
| GET | `/api/admin/line/threads/[recipientId]` | 顧客別トーク詳細(時系列・送信/受信) |
| GET | `/api/admin/line/history` | 配信履歴(成功/失敗・実データ) |
| GET | `/api/admin/line/templates` | テンプレート一覧(カテゴリ名解決) |
| POST | `/api/admin/line/templates` | テンプレート新規作成 |
| PATCH | `/api/admin/line/templates/[id]` | テンプレート編集 |
| DELETE | `/api/admin/line/templates/[id]` | テンプレート削除 |

### 新規UI(`/admin/line`)

`src/components/admin/line/LineScreen.tsx`(タブ: チャット/配信履歴/テンプレート) + `ChatListTab.tsx`/`DeliveryHistoryTab.tsx`/`TemplateManagerTab.tsx`。`src/store/useLineAdminStore.ts`(Zustand・fetch-onlyパターン、他MD-*画面と同方式)。`AdminSidebar.tsx`に「LINE」ナビ項目を追加(既存項目は無変更)。

## 2. 各要件への対応状況

| 要件 | 状況 |
|---|---|
| ①チャット一覧(顧客名/最終メッセージ/最終送受信日時) | 実データ表示。現状実フォロワーは1件(B.I.G・customer_id未紐付け)のみ |
| ②顧客別トーク(送信/受信を時系列) | 実データ表示。現状は全件「送信」(社内テスト送信5件)。受信は0件(Webhook修正後、今後の実受信から記録される) |
| ③配信履歴(成功/失敗) | 実データ表示(`line_send_queue`4件、全件送信成功) |
| ④テンプレート管理(DB接続・ダミー禁止) | 実データ(`line_templates`15件・`template_categories`5件)でCRUD実装 |
| ⑤Empty State(「LINE履歴なし」) | 3タブ全てで実装・確認済み |

## 3. 実機検証

ローカルでプロダクションビルドを起動し、本番DB(読み取り専用)に対して実行・スクリーンショット取得:

- `docs/screenshots/LINE_チャット一覧.png` — 実フォロワー1件・実送信本文を表示
- `docs/screenshots/LINE_顧客別トーク.png` — 実送信5件を時系列表示(架空文言は表示されないことを確認済み)
- `docs/screenshots/LINE_配信履歴.png` — 実送信履歴4件(送信成功)
- `docs/screenshots/LINE_テンプレート管理.png` — 実テンプレート15件

## 4. テスト結果

`npx vitest run`: **64 files / 601 tests 全成功**(直前591件 + 本タスクで10件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

新規テスト:
- `tests/api/lineWebhook.test.ts`(4件・message イベント処理を検証)
- `tests/lib/line/lineAdminQueries.test.ts`(10件・実会話判定ロジック・旧プレースホルダ除外を含む)

## 5. 禁止事項の遵守

- **ダミーデータ禁止/モックデータ禁止**: `line_logs`(架空会話と判明)は使用していない。Webhook修正前のプレースホルダ本文も実会話として表示しないようフィルタした
- **本番データ更新禁止**: 本タスクでの実装・検証は全て読み取り専用(GET確認のみ)。テンプレートCRUD機能は実装したが、本番データへの実書き込みテストは実施していない(ユニットテストのモックでのみ検証)
- **LINE送信禁止**: 実際のLINE Push APIは一度も呼び出していない
- **Webhook設定変更禁止**: 署名検証・チャネルシークレット・follow/unfollow処理は無変更。`message`イベントの処理ロジック追加のみ(イベント処理の拡張であり設定変更ではない)
- **既存テーブル構造変更禁止**: 新規マイグレーションなし。既存テーブルへの読み取り・通常のINSERT(Webhookの既存ログ書き込み動作の延長)のみ

## 6. 残課題(別タスクとして提起)

1. 顧客への実LINE配信(マーケティング目的)はまだ一度も行われていないため、配信履歴は全件「社内テスト送信」。実運用が始まれば自然に実データが積み上がる
2. `line_user_ids.customer_id`の紐付け（LINEフォロワー→実顧客）を行う仕組みが未整備。これがないと「顧客別トーク」に実顧客名が表示されない
3. `brain_scenarios`/`brain_line_send_queue`(Brain側DM機構)は0件のまま。Scenario Engineの永続化層(`scenario_outcomes`/`scenario_trigger_log`含む)は設計のみで未実装(別タスク)
