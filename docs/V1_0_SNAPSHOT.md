# v1.0 完成状態スナップショット

**記録日**: 2026-07-03　**関連**: `docs/V1_0_FREEZE_DECLARATION.md`／`docs/V1_0_KNOWN_ISSUES.md`

このドキュメントは、v1.0として凍結された時点でスタッフアプリが「何を持ち、何を持たないか」を
記録する。今後の変更差分の基準点として使用する。

## 1. 画面構成（5タブ）

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

## 2. 顧客詳細（CustomerBottomSheet）

- 禁忌事項（`ContraindicationSection`）: ドラッグハンドル直下・スクロール領域外に固定表示。
  折りたたみ不可
- 表示内容: 顧客ヘッダー（事実バッジのみ）／会話メモ／肌タグ／前回施術／KPI3列
  （累計売上・来店回数・LINE反応率 ※LINE反応率は既知バグA）／AI提案／TL-5 AI Timeline／
  音声メモ／実施済みアクション記録
- 削除済み: 顧客スコアカード、VIP類似度、VIP昇格シミュレーター、旧AI Timeline（ダミーUI）、
  VIPバッジ、離脱危険度%バッジ（すべて日数ベースの事実バッジに置換）

## 3. TL-5 AI Timeline

- 保持: person_summary／recent_change／next_focus／avoid の4セクション、risk_event
  （来店間隔90日超・指名変更・単価低下の決定論ルール）、タイムライン、会話の入り口、
  今日の接客ポイント
- 削除: ★関係性スコア（`RelationshipScore`型・`computeRelationshipScore()`・stars表示）を
  フロントエンド・バックエンド（`app/api/customers/[id]/timeline-summary/route.ts`）の両方から
  完全削除

## 4. AI提案

`src/lib/nextAction/actionRules.ts` の全18ルール中、営業色の強かった10ルールのタイトル・説明・
CTA文言を「会話のきっかけ」トーンに書き換え済み。トリガー条件・スコアリングロジック自体は
変更していない（内部の優先度判定にのみ使用、画面には「優先/推奨/参考」ラベルのみ表示）。

## 5. 削除したコンポーネント・画面（合計32ファイル）

- 評価系: `VipSimilarityCard.tsx`／`CustomerScoreCard.tsx`／`VipPromotionCard.tsx`／
  `CustomerTimeline.tsx`／`ChurnRiskRanking.tsx`／`StaffRanking.tsx`
- KPIタブ全体: `app/kpi/page.tsx` + `src/components/kpi/` 配下24ファイル
  （わたしタブに置換。管理者アプリからの参照なしを確認済み）
- AI提案FAB: `app/ai-suggestions/page.tsx`／`AiSuggestionsScreen.tsx`
- 未使用orphan: `src/components/phase1/CustomerPage.tsx`（コード上の参照0件を確認して削除）
- 設定タブの「VIP管理」ボタン（`MenuDashboard.tsx`のGRID_ITEMS、Crownアイコン）: 実運用準備
  フェーズのレビューで発見・ユーザー承認のうえ削除

## 6. 新規追加ファイル

```
app/me/page.tsx                          わたしタブ
app/memo/page.tsx                        メモタブ
app/api/me/monthly-stats/route.ts        わたしタブ用API（先月比算出）
src/components/phase1/MyStatsScreen.tsx
src/components/phase1/MemoScreen.tsx
src/store/useMyStatsStore.ts
CLAUDE.md                                Claude Code運用ルール
docs/V1_FREEZE_SAFETY_RULES.md           安全制御ルール
docs/V1_0_FREEZE_DECLARATION.md          本凍結宣言
docs/V1_0_KNOWN_ISSUES.md                既知バグリスト
docs/V1_0_SNAPSHOT.md                    本ドキュメント
```

## 7. 検証状態

- `tsc --noEmit`: v1.0スコープ内エラー0件（`e2e/*.spec.ts`の無関係な既存エラー2件のみ、
  変更前から存在）
- `next build`: 成功。全ルート生成確認済み
- 実行時確認: `npm run dev` で `/phase1` `/customers` `/memo` `/me` `/menu` 全て200応答、
  サーバーログにスタックトレースなし。ただし認証済みブラウザ操作（実際にログインしての
  対話確認）は未実施（DEMO_MODE=false・実Supabase接続のため）
- 既知バグ: A・B（`docs/V1_0_KNOWN_ISSUES.md`）。v1.0.1で対応

## 8. v1.0スコープ外（今回一切変更していない）

- `app/admin/**`（管理者アプリ全体）
- `src/components/line/**`、`app/line/**`、`app/api/line/**`、`app/api/line-queue/**`、
  `src/lib/line/**`（LINE領域）※下記「未解決事項」を除く

---

## 解消済み事項（2026-07-03）

- `src/components/line/LineApprovalScreen.tsx` の未承認差分は、ユーザー承認のうえ
  `git checkout` でロールバック済み。LINE領域は完全にクリーン（無変更）
- 設定タブの「VIP管理」ボタン（`MenuDashboard.tsx`）はユーザー承認のうえ削除済み
  （`GRID_ITEMS`から該当項目と未使用になった`Crown`インポートを除去）

いずれも `tsc --noEmit` で新規エラー0件を確認済み（既存の`e2e/*.spec.ts`無関係エラー2件のみ）。
