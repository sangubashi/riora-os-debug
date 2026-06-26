# LINE画面本物化(Pass G) DB調査レポート

調査日: 2026-06-25
方法: 本番DB読み取り専用(`scripts/investigate_line_screen.ts`)。書き込み・既存コード変更なし。

## 1. タスクで指定された対象テーブル

| テーブル | 件数 | 状態 |
|---|---|---|
| `line_send_queue` | 4件 | 実在(レガシー`customers`空間)。詳細は§3 |
| `brain_scenarios` | 0件 | テーブルは存在するが空 |
| `scenario_trigger_log` | — | **テーブル自体が本番に存在しない**(PostgRESTスキーマキャッシュで404) |
| `scenario_outcomes` | — | **テーブル自体が本番に存在しない** |
| `brain_pattern_fire_log` | 0件 | テーブルは存在するが空 |

`scenario_trigger_log`/`scenario_outcomes`は設計書(`docs/architecture/Riora_ScenarioEngine_Code_Architecture_v1.0.md`)には記載があるが、マイグレーションが一度も作られていない(コード内コメントでも「DM側は後続実装のため本マイグレーションでは扱わない」と明記済み)。`brain_scenarios`/`brain_pattern_fire_log`は0件で、Brain側のLINE/シナリオ機構は実質未稼働。

## 2. 関連テーブル(実装に直接関わるもの)

| テーブル | 件数 | 状態 |
|---|---|---|
| `brain_line_send_queue` | 0件 | Brain側DM配信キュー(空) |
| `line_send_logs` | 10件 | **実データ**(後述§3) |
| `line_threads` | — | **本番に存在しない**(マイグレーション定義はあるが未適用と判明) |
| `line_messages` | — | **本番に存在しない**(同上) |
| `line_user_ids` | 1件 | 実データ(webhookのfollow処理で記録された実フォロワー1件) |
| `line_templates` | 15件 | **実データ(マスタ・`001_schema.sql`でシード済み)** |
| `line_campaigns` | — | 本番に存在しない |
| `line_logs` | 18件 | **要注意 — 後述§3で詳述(架空データと判明)** |
| `line_segments` / `line_broadcasts` | — | 本番に存在しない |

## 3. 重大な発見: `line_logs`(18件)はダミーデータである

`line_logs`は顧客に紐付いた送受信履歴(`direction`/`message`/`sent_at`/`customer_id`)を持つ、唯一「顧客別トーク」に使えそうなテーブルだったが、内容を精査した結果、**`scripts/demo_seed_fixed.sql:509`以降のSQLで直接INSERTされたデモ用の作文メッセージ**であることが判明した(同ファイル41行目で`DELETE FROM line_logs`→509行目で固定の18件をINSERTする構成)。

実例(全て同スクリプトの作文):
```
[2026-05-19] received 田中あかり 「ギフト券についてもう少し教えてもらえますか」
[2026-05-18] sent     伊藤遥   「伊藤様、本日13時のご予約ありがとうございます！...」
```

これは実際にLINEで送受信されたメッセージではない(本物のLINE Webhookはmessageイベントを未処理・実装なし、後述§4)。**このテーブルの内容を「顧客別トーク」の実データとして画面に表示することは、ダミーデータ禁止に違反する**ため、本タスクでは使用しない(本番データは禁止事項により削除・変更もしない。読み取りを避けるのみ)。

## 4. `line_send_queue`(4件)/`line_send_logs`(10件)は実データだが、全て社内テスト送信

`line_send_queue`の4件・`line_send_logs`の10件を全件確認した。全件が以下の特徴を持つ:
- 宛先(`line_user_id`/`recipient_id`)が単一の実LINEアカウント(`U57051505...`)= 本番リリース前の社内テストアカウント
- `customer_name`が「E2Eテスト」「監査テスト」、`triggered_by`が`e2e_test`、`metadata.source`が`manual_audit_script`/`approval_flow`
- `customer_id`は4件全てNULL(顧客に紐付いていない)
- いずれも実際にLINE Push APIを通して送信され、成功している(`status: 'success'`/`'sent'`)

**これらは架空の作文ではなく、本番公開前に実施された承認フロー・送信フローのE2E監査テストの実記録**である。顧客への実送信(マーケティング目的の配信)はまだ一度も行われていない、という事実を正確に反映している。

## 5. `line_user_ids`(1件)

Webhookのfollow処理で実際に記録された実フォロワー1件(`display_name: "B.I.G"`、実LINEプロフィール画像URL付き)。`customer_id`はNULL(brain_customers/customersいずれにも未紐付け)。

## 6. Webhook受信の実装状況(確認)

`app/api/line/webhook/route.ts`を確認した結果、`follow`/`unfollow`イベントのみ実装済みで、**`message`イベント(顧客からの実際のテキスト受信)は未実装**(処理分岐の`else`に落ち、ログ1行のみ記録・本文は保存されない)。これが「顧客別トーク」に使える実データが存在しない直接の原因。

## 7. テンプレート(`line_templates`・15件)

`001_schema.sql`のシードデータとして15件のテンプレート文面が登録済み(美容サロン向けの実用的な文面)。これは個人の会話記録ではなく、スタッフが使う**雛形マスタ**であり、`brain_success_patterns`等と同種の「事前に用意された実運用コンテンツ」である。ダミーデータ禁止には該当しない(架空の顧客データではない)。

## まとめ

| 機能 | 実データの有無 | 方針 |
|---|---|---|
| ① チャット一覧 | **顧客に紐付く実メッセージは0件** | Empty State表示(要件⑤どおり) |
| ② 顧客別トーク | **同上(line_logsは架空データのため使用不可)** | Empty State表示 |
| ③ 配信履歴 | **実データあり(4+10件・全てテスト送信)** | 実データのまま表示(テスト送信である事実も誠実に保持) |
| ④ テンプレート管理 | **実データあり(15件)** | 実データをそのままCRUD接続 |
| ⑤ Empty State | (上記①②に直接適用) | 「LINE履歴なし」を実装 |

**①②は「LINE画面の本物化に失敗した」のではなく、「顧客からの実メッセージを記録する仕組み自体(Webhookのmessageイベント処理)が未実装のため、表示すべき実データが本番に存在しない」という構造的な制約である。**

## 本調査で変更したコード

なし(`scripts/investigate_line_screen.ts`を新規作成し読み取り専用で実行したのみ)。
