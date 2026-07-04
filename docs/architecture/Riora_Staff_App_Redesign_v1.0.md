# Riora OS スタッフアプリ v1.0 再設計書

**確定日**: 2026-07-03　**状態**: 実装完了・v1.0として凍結済み（本番反映: commit `b43a6e0`）
**関連ドキュメント**: `docs/V1_0_SNAPSHOT.md`／`docs/V1_0_FREEZE_DECLARATION.md`／
`docs/V1_0_KNOWN_ISSUES.md`／`docs/V1_0_CAPABILITIES.md`／`docs/V2_HANDOFF_NOTES.md`

---

## 1. 再設計の目的

スタッフアプリを「経営分析ツールの縮小版」から「接客の場で使う事実ベースの補助ツール」へ
再定義する。評価・比較・順位づけといった経営視点のUIをスタッフアプリから排除し、
経営分析（スコア・ランキング・KPI比較）は管理者アプリ（`app/admin/**`）に集約する。

### 絶対ルール

- スタッフアプリは**事実情報のみ**表示する。スコア・ランク・順位・確率などの評価系UIは禁止。
- 内部エンジン（`churn_risk`・`vip_rank`等の数値スコアリング）自体は、優先度判定やトーン
  分岐などの非表示ロジックに限り内部使用してよい。ただし画面には数値・記号（★等）として
  一切漏らさない（詳細は本書7章）。
- AI提案は「営業提案」ではなく「会話のきっかけの提示」として再定義する。

---

## 2. 画面構成（5タブ）

再設計前は中央FAB「AI提案」独立画面＋KPIダッシュボードタブを含む構成だったが、
以下の5タブ構成に再編した。

```
[今日] /phase1    [顧客] /customers    [メモ] /memo    [わたし] /me    [設定] /menu
```

| タブ | 内容 |
|---|---|
| 今日 | 来店前30秒ブリーフィング（最上部固定・3行以内：氏名+時刻／前回施術／注意事項）+ 本日の予約一覧（スコア・VIPバッジなし） |
| 顧客 | 検索・一覧のみ。ソートは「来店日順」「売上順」の2種。ランキング・スコア表示なし |
| メモ | 本日の予約から顧客を選び、録音→保存→AI要約のフローに入る（新設） |
| わたし | 先月比4指標（指名／リピート率／口コミ／来店数差分）のみ。他人比較・ランキングなし（新設） |
| 設定 | 既存メニュー・ガイド機能を維持 |

中央FABの「AI提案」独立画面は廃止。AI提案は顧客詳細シート内の `NextActionPanel` に統合。

### 30秒ブリーフィングの仕様（今日タブ）

来店前に3行以内で状況を把握できることを目的とした固定フォーマット。

```
1行目: 氏名＋来店時刻
2行目: 前回施術内容
3行目: 注意事項（禁忌・肌タグ由来の留意点）
```

スコア・VIPバッジ・確率等は一切含めない。

---

## 3. 顧客詳細（CustomerBottomSheet）の統合

再設計前は「今日タブ」と「顧客タブ」で別々の詳細シートコンポーネントが使われており、
顧客タブ側は簡易版（アバター・タイプ・KPI3タイルのみ）でAI提案・TL-5・音声メモに
到達できなかった。再設計により顧客タブの独自 `CustomerDetailSheet` を廃止し、
今日タブと同一の `CustomerBottomSheet` へ統合した（`CustomersScreen.tsx`に
`toCustomer()`/`toReservation()`マッパーを追加し、`CustomerRow`型から変換）。

- 禁忌事項（`ContraindicationSection`）: ドラッグハンドル直下・スクロール領域外に固定表示。
  折りたたみ不可
- 表示内容: 顧客ヘッダー（事実バッジのみ）／会話メモ／肌タグ／前回施術／KPI3列
  （累計売上・来店回数・LINE反応率 ※LINE反応率は既知バグA）／AI提案／TL-5 AI Timeline／
  音声メモ／実施済みアクション記録
- 顧客タブから起動した場合、実予約（`reservations`行）を持たないため `Reservation.id` を
  `string | null` に型変更し、`null`許容とした（`booking_prompts`／`handover_notes`／
  `contraindications`／`staff_logs`／`voice_notes`の対応FKがいずれもnullable であることを
  Supabase側で直接確認したうえでの変更）
- 削除済み: 顧客スコアカード、VIP類似度、VIP昇格シミュレーター、旧AI Timeline（ダミーUI）、
  VIPバッジ、離脱危険度%バッジ（すべて日数ベースの事実バッジに置換）

---

## 4. TL-5 AI Timeline

- 保持: `person_summary`／`recent_change`／`next_focus`／`avoid` の4セクション、`risk_event`
  （来店間隔90日超・指名変更・単価低下の決定論ルール。LLM不使用）、タイムライン、
  会話の入り口、今日の接客ポイント
- 削除: ★関係性スコア（`RelationshipScore`型・`computeRelationshipScore()`・stars表示）を
  フロントエンド・バックエンド（`app/api/customers/[id]/timeline-summary/route.ts`）の両方から
  完全削除

---

## 5. AI提案の再定義

「営業提案」から「会話のきっかけの提示」へトーンを変更した。

- `src/lib/nextAction/actionRules.ts` の全18ルール中、営業色の強かった10ルールのタイトル・
  説明・CTA文言を書き換え
- トリガー条件・優先度判定ロジック自体は変更していない（内部の優先度判定にのみ使用）
- 画面には「優先/推奨/参考」ラベルのみ表示し、スコア数値は一切表示しない
- 実施したらワンタップで記録可能（接客ログ・実施済みアクション記録）

---

## 6. 音声メモのエラーハンドリング・実データ化

- マイク許可タイムアウトのフォールバック処理を追加（既知バグBとしてタイマーリークが
  残存。`docs/V1_0_KNOWN_ISSUES.md`参照）
- サーバー側パイプライン（`app/api/voice-pipeline/route.ts`）にて、抽出済みだが未保存だった
  `insight_tags` をDB保存する処理をP0対応として追加
- 記憶候補抽出（`extractCustomerNotes`）が0件になるケースへのフォールバック候補生成を追加
  （`VoiceMemoSection.tsx`）

---

## 7. 内部エンジンとUI表示の分離という設計方針

`churn_risk`・`vip_rank`などの内部スコアリング値は、`NextActionPanel`・`CustomerRiskCard`・
`adaptivePriority`など内部の優先度判定にのみ使用し、画面には一切数値を出さない
（`CustomerRiskCard.tsx`のコメント「数値を直接見せない。自然言語で状態を表現。」が象徴的）。
`TagFilterBar`の`risk`/`vip`フィルタも同様に、判定条件として内部使用するのみで数値非表示。

v2以降の新機能追加時も、「内部で使っているスコアが画面のどこかに数値・記号として
漏れ出ていないか」をUIレビュー項目に加えることを推奨する（`docs/V2_HANDOFF_NOTES.md`参照）。

---

## 8. 削除したコンポーネント・画面（合計32ファイル＋α）

- 評価系: `VipSimilarityCard.tsx`／`CustomerScoreCard.tsx`／`VipPromotionCard.tsx`／
  `CustomerTimeline.tsx`／`ChurnRiskRanking.tsx`／`StaffRanking.tsx`
- KPIタブ全体: `app/kpi/page.tsx` + `src/components/kpi/` 配下24ファイル
  （わたしタブに置換。管理者アプリからの参照なしを確認済み）
- AI提案FAB: `app/ai-suggestions/page.tsx`／`AiSuggestionsScreen.tsx`
- 未使用orphan: `src/components/phase1/CustomerPage.tsx`（コード上の参照0件を確認して削除）
- 顧客タブの簡易 `CustomerDetailSheet`（約210行、`CustomersScreen.tsx`内ローカル定義）
- 設定タブの「VIP管理」ボタン（`MenuDashboard.tsx`のGRID_ITEMS、Crownアイコン）: 実運用準備
  フェーズのレビューで発見・ユーザー承認のうえ削除

## 9. 新規追加ファイル

```
app/me/page.tsx                          わたしタブ
app/memo/page.tsx                        メモタブ
app/api/me/monthly-stats/route.ts        わたしタブ用API（先月比算出）
src/components/phase1/MyStatsScreen.tsx
src/components/phase1/MemoScreen.tsx
src/store/useMyStatsStore.ts
CLAUDE.md                                Claude Code運用ルール
docs/V1_FREEZE_SAFETY_RULES.md           安全制御ルール
docs/V1_0_FREEZE_DECLARATION.md          凍結宣言
docs/V1_0_KNOWN_ISSUES.md                既知バグリスト
docs/V1_0_SNAPSHOT.md                    完成状態スナップショット
docs/V1_0_CAPABILITIES.md                v1.0でできること・できないこと一覧
docs/V1_0_FINAL_READINESS_REPORT.md      実運用準備フェーズ最終レポート
docs/V2_HANDOFF_NOTES.md                 v2引き継ぎノート
docs/VOICE_PIPELINE_TEST.md              音声メモ実機検証手順
```

---

## 10. v1/v2 境界

### v1.0スコープ（今回対応済み）

上記1〜9章すべて。5タブ構成・顧客詳細統合・TL-5整理・AI提案トーン変更・音声メモの
insight_tags保存とフォールバック追加まで。

### v1.0スコープ外（意図的に手を付けていない）

- `app/admin/**`（管理者アプリ全体）— 経営分析・スタッフ比較・ランキングはこちらに集約
- `src/components/line/**`、`app/line/**`、`app/api/line/**`、`app/api/line-queue/**`、
  `src/lib/line/**`（LINE領域）。`LineApprovalScreen.tsx`／`ChatWindow.tsx`には
  「優先度◯点」「VIP候補」「離脱リスク検知」等の評価系表示が元のまま残存しており、
  v2で正式にスコープへ含めて是正することを推奨

### v1.0.1で対応する事項（既知バグ）

- **既知バグA**: `line_response_rate`が常に0%固定（実データ未接続。影響範囲はアプリ全体で
  `Phase1Screen.tsx`・`CustomersScreen.tsx`双方とも同様にハードコード。当初「顧客タブのみの
  問題」と誤って報告した経緯があるが、`app/api/customers/list/route.ts`の直接調査により
  app全体の問題であると訂正済み）
- **既知バグB**: 音声メモのマイク許可タイムアウトタイマーが解放されないレースコンディション

詳細は `docs/V1_0_KNOWN_ISSUES.md` を参照。

---

## 11. 検証状態

- `tsc --noEmit`: v1.0スコープ内エラー0件
- `next build`: 成功。全ルート生成確認済み
- 実行時確認: `/phase1` `/customers` `/memo` `/me` `/menu` 全て200応答、サーバーログに
  スタックトレースなし
- 本番デプロイ: commit `b43a6e0` が Vercel production target へ反映済み
  （deployment `dpl_5JkELT3D1AhwtGnhNMSHGhYDv14h`）

---

## 12. 今後の検討事項（v2）

詳細は `docs/V2_HANDOFF_NOTES.md` に記録済み。要点のみ再掲する。

- LINE反応率の実データ接続（既知バグA）と、そのためのLINE↔`brain_customers`連携・返信
  トラッキング基盤の新設（現行スキーマには存在しない）
- 音声メモタイマーリークの修正（既知バグB）
- `CustomerBottomSheet.tsx`のパネル数の多さに対する段階的開示の検討
- 口コミ件数（わたしタブ4指標目）のデータソース設計
- LINE領域の評価系表示の是正（ユーザー承認が別途必要）
