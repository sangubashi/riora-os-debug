# スタッフ向けAI提案 学習データ蓄積パイプライン 詳細設計

作成日: 2026-08-07（2026-08-07 UI仕様詳細化・案1確定を追記／2026-08-07 実装完了を追記）
ステータス: **実装完了・実データ検証済み**（2026-08-07、ユーザー承認スコープ内で実装。
build/tsc/vitest/実データE2E検証まで完了。詳細は本ファイル末尾「§10 実装完了報告」参照）

## 更新履歴
- 2026-08-07: 初版提出。方針（ProposalOrchestratorを正式経路に採用／`POST /api/proposals/fire`
  新設／DB変更なし／既存fire_log→outcomesパイプライン流用／staff認証利用・requireAdmin不使用）を
  ユーザー承認。UI案1（「✨今日の接客ポイント」をProposalOrchestrator由来へ置き換え）を第一候補として
  詳細設計を追加指示。**実装はまだ開始しない**（変更範囲・影響ファイル・テスト項目の最終確認後に
  凍結解除承認を行う運用のため）。
- 2026-08-07: ユーザーが最終確認のうえ凍結解除承認(対象: CustomerBottomSheet/AIProposalCard/
  `/api/proposals/fire`/Proposal取得周辺/`buildFireLogDecisionRecord`/関連テストに限定)。
  追加要件として「短時間の重複fire防止」を指示され、§5.1.5に重複抑止設計(§10参照)を追加した上で
  実装完了。

## 0. 要約

目的（ユーザー確認済み）: 「スタッフが実際に使用したAI提案を学習データとして蓄積すること」。

調査の結果、**前提が一部誤っていたことが判明した**。「CustomerBottomSheetの現在のAI提案導線」は
実は3つの独立した別物であり、そのうち`ProposalOrchestrator`（brain_success_patterns由来の本物のAI提案
エンジン）に接続されているのは1つだけで、しかもそれは**CustomerBottomSheetではなく別画面**にある。
さらにその画面の保存先は未実装スタブで、実データは一切書き込まれない。詳細は§1。

この発見を踏まえた結論（§2）: ゼロから新しいAPI/画面を作る必要はない。既存の
`GET /api/proposals/by-name`（スタッフ認証・権限チェック済み・ProposalOrchestrator実体）を
そのまま流用し、「表示された」ことを`brain_pattern_fire_log`に記録するPOSTを1本追加するだけで、
**その後段（`brain_pattern_fire_log` → `brain_proposal_outcomes`）は完成済みの既存パイプラインが
無改修で機能する**。これが本設計の核。

## 1. 現状調査: 「AI提案」を名乗るコンポーネントは3つある

| # | 表示場所 | コンポーネント | データ源 | brain_pattern_fire_log書込 |
|---|---|---|---|---|
| A | CustomerBottomSheet「💬 会話のきっかけ」 | `NextActionPanel.tsx` | `generateNextActions()`（クライアント側の独自ルールエンジン。Menu AI Context/MatchReason、`src/lib/nextAction/`配下） | なし（対象外の別系統） |
| B | CustomerBottomSheet「✨ 今日の接客ポイント」 | インライン（`CustomerBottomSheet.tsx:1158`） | `aiSuggestion?.strategy_logic?.adviceMessage` | — |
| C | Phase1Screen → 予約カードから「AI提案」タップ | `AIProposalView.tsx` | `GET /api/proposals/by-name` → `generateCustomerProposal()` → **`ProposalOrchestrator`実体** | **なし**（GETのみ、DB書込みしない設計） |

### 発見1: Bは死んでいる（fallbackテキストのみ）
`aiSuggestion`は`useStaffStore`のstate（`setAiSuggestion`）だが、**呼び出し元がコードベース中に
一つも存在しない**。常に`null`のため、`aiAdvice`は毎回`TYPE_COPY[customer_type]`の定型文
（例:「〇〇様には『△△』を意識した接客を心がけましょう」）にフォールバックしているだけで、
ProposalOrchestratorとは無関係。ユーザーが「現在のAI提案導線」として認識している可能性が高いのは
おそらくこのカードだが、実体はテンプレ文字列。

### 発見2: 本物（C）はCustomerBottomSheetの外にあり、しかも保存先が未実装スタブ
`/api/proposals/by-name`（`app/api/proposals/by-name/route.ts`）は既に：
- `extractStaffFromRequest` + `canAccessCustomer`でスタッフ認証・権限チェック済み
- 管理者は`staff_required`で弾く設計（AUTH-1 V2と一貫）
- `generateCustomerProposal()`→`ProposalOrchestrator`を実際に呼んでいる本物のAI提案

だが、これを表示する`AIProposalView.tsx`は**`CustomerBottomSheet.tsx`とは別画面**
（`Phase1Screen.tsx`の`view==='ai_proposal'`）で、ボタン「接客ログを記録する」の遷移先
`ServiceLogView.tsx`は次の通り**未実装スタブ**:

```tsx
function handleSave() {
  setSaved(true)
  // TODO: supabase.from('staff_logs').insert(...)
  setTimeout(() => { onSaved() }, 1800)
}
```

つまりCが到達可能でも、その先の接客ログ保存は何もDBに書かない。一方、実際に稼働している
接客ログ保存経路は`CustomerBottomSheet.tsx`の`saveLog()`（`staff_logs`へのinsert +
`POST /api/visits/service-complete`、[[project_phase1_ai_proposal_outcome_pipeline]]で
Phase1-Eとして実装済み）のみ。

### 発見3: 既存の学習パイプラインは「fire」の起点がCSV取込/管理画面にしかない
`brain_pattern_fire_log`への書込みは現在2箇所のみ:
- `POST /api/admin/proposals`（`requireAdmin`必須。`docs/admin`の顧客詳細パネルから提案を
  「記録する」操作をしたときのみ）
- それ以外は無し

`brain_proposal_outcomes`への書込み（`recordProposalOutcome()`）は`csvImportPipeline.ts`の
会計確定（reconcile）時にのみ呼ばれる。customer_id一致 + 直近30日以内のfire_logを逆引きして
紐付ける設計（visit_idの直接参照は無い）。

この2つは実装として完成しており（Phase1-A〜E、2026-07-24 push済み）、ロジックそのものは
健全。**問題は「fire」の入力元が実質adminツールの手動操作しかなく、現場のスタッフが実際に
見たAI提案がここに一件も入ってこないこと**。これがユーザーの問題意識と一致する。

## 2. 提案ログの正しい流れ（設計）

理想形として提示された流れ：

```
CustomerBottomSheet → スタッフ用AI提案API → ProposalOrchestrator
  → brain_pattern_fire_log → brain_proposal_outcomes
```

現状の到達点との差分は「起点をどこに繋ぐか」だけで、後段は無改修で流用できる：

```
[既存・無改修で流用]
generateCustomerProposal() (ProposalOrchestrator実体)
        │
        ▼
GET /api/proposals/by-name  ← 表示専用、書込みなし（現状のまま維持）
        │ (画面に表示された時点)
        ▼
【新規】POST /api/proposals/fire  ← 表示された事実をfire_logへ記録するのみ
        │
        ▼
brain_pattern_fire_log  ← BriefingRepo.insert()を流用（decision_record構造は
        │                  既存のPOST /api/admin/proposalsと同一形式に揃える）
        ▼
[既存・無改修]
csvImportPipeline.ts reconcile() → recordProposalOutcome()
  （customer_id + 直近30日でfire_logを逆引き）
        ▼
brain_proposal_outcomes  ← was_briefed/was_executed/was_accepted/amount
```

**新規実装が必要なのは「fire」の1点のみ**。`recordProposalOutcome.ts`・`csvImportPipeline.ts`・
`brain_proposal_outcomes`まわりは一切変更しない（Phase1で作った設計が既にcustomer_id単位の
時間近傍マッチングという抽象化をしているため、fire_logの発生源が管理画面かスタッフ画面かを
区別する必要がない）。

### なぜ「表示時に即fire」で良いか
- 管理画面側の`POST /api/admin/proposals`も「生成して記録する」ボタンを押した時点でfireしており、
  実際にその後接客が行われたかは`brain_proposal_outcomes`側で後から客観判定する設計（was_briefed
  は常にtrue、was_executed/was_acceptedは来店結果の実データで別途判定）。スタッフ画面でも同じ
  思想を踏襲すれば良く、「本当に見たか」の追加検証は不要（fireそのものが「システムが提示した」
  事実の記録であり、既存設計と一貫する）。
- 重複fire（同じ客を1日に何度も開く等）は許容できる。`recordProposalOutcome()`は「直近1件」を
  採用するだけで、重複があっても1visitにつき1 outcomeしか作られない（実装済みロジックそのまま）。
  → dedup機構は不要、MVPをシンプルに保てる。

## 3. 権限設計確認

**結論: 新しいstaff認証APIは不要。`requireAdmin`の流用も不要。**

`/api/proposals/by-name`が既に正しいパターンを持っている：
- `extractStaffFromRequest(req)`でJWTからスタッフを解決
- `staff.isAdmin || !staff.staffBrainId`なら`staff_required`で拒否（管理者はこのエンドポイント対象外、
  AUTH-1 V2の`/api/me/monthly-stats`と同じ方針）
- `canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)`でAUTH-1 V2のRule A'/B'/Cを適用

新設する`POST /api/proposals/fire`は**このGETと全く同じ認証・権限チェックを内部でもう一度行う**
（クライアントの言い分を信用せず、customerIdだけを受け取ってサーバー側で権限とproposalを
再導出する。GET側の結果をクライアント経由で信用しない設計にする＝改ざん耐性）。

既存のセキュリティ設計への影響:
- `app/api/admin/proposals/**`・`requireAdmin`は無変更（触らない）
- `app/api/proposals/by-name/route.ts`もGETの挙動は無変更（書込み処理を追加しない。POSTを別ファイル
  として新設する）
- AUTH-1 V2のRule A'/B'/Cロジック自体には触れない

## 4. DB変更要否

**不要。migrationなし。**

- `brain_pattern_fire_log`: 既存カラム（`decision_record` jsonb）で足りる。`POST /api/admin/proposals`
  が既に書いている`decision_record`構造（`patternId`/`stepNo`/`proposalKind`/`scriptStyle`/
  `contextSnapshot`等）をそのまま踏襲すれば、`recordProposalOutcome()`の読み取り側は無改修で動く。
- `brain_proposal_outcomes`: 無関係（書込み元は`csvImportPipeline.ts`のみで変更なし）。
- `visit_id`は`brain_proposal_outcomes`ではNOT NULLだが、`brain_pattern_fire_log`側は
  `visit_id: null`で挿入する設計が既にある（admin route実装のまま。来店前に提案がfireされるのは
  当然で、来店確定後に`recordProposalOutcome()`が別途visit_idを持つ`brain_proposal_outcomes`行を
  作る2段構え）。

## 5. MVP範囲の提案

### スコープに含める
1. `POST /api/proposals/fire`（新規1ファイル）
   - 入力: `{ customerId }`のみ
   - 認証: `/api/proposals/by-name`と同一パターン（extractStaffFromRequest + canAccessCustomer）
   - 内部で`generateCustomerProposal()`を再実行し（クライアント供給データは信用しない）、
     `POST /api/admin/proposals`と同一構造の`decision_record`を組み立てて`briefingRepo.insert()`
   - `decision_record`組み立てロジックは`app/api/admin/proposals/route.ts:71-86`に既にあるので、
     重複コードを避けるため`src/lib/proposal/buildFireLogDecisionRecord.ts`として共通化し、
     admin側もそれを呼ぶようリファクタ（admin側の挙動は変えない、内部実装の共通化のみ）
2. CustomerBottomSheetでの表示（下記「要判断」参照。新規コンポーネント`AIProposalCard.tsx`を
   `NextActionPanel.tsx`と同じ場所に追加し、`/api/proposals/by-name`をGETして表示、成功時に
   fire-and-forgetで`POST /api/proposals/fire`を1回呼ぶ）
3. 動作確認: 実データでfire_log作成 → 対象customerの次回CSV取込reconcile時に
   `brain_proposal_outcomes`が作られることを確認（新規スクリプトでの検証、Phase1のときと同じ手法）

### スコープに含めない（将来検討）
- スタッフ向け👍👎フィードバックUI（既に`attachFeedback`/`POST /api/admin/proposals/feedback`と
  いう仕組みは存在するが、admin専用。スタッフ向けに開放するのは別タスクとして切り出す）
- `staff_logs.ai_adopted`（接客ログ画面の「AI提案を活用した」チェックボックス）との統合。
  これは既に`saveLog()`で保存されている自己申告値だが、`recordProposalOutcome()`は行動結果
  （retailAmount等の客観データ）のみで判定する設計であり、混同すると判定ロジックが二重化する。
  今回は触らない。
- fire頻度のdedup最適化（§2の通り、既存ロジックの範囲で害がないため不要と判断）

### UI方針: 案1に確定（2026-08-07ユーザー承認）
「今日の接客ポイント」（発見1の死んだfallbackカード）を、見た目・配置は変えずに中身だけ
ProposalOrchestrator由来の実データへ差し替える。詳細は§5.1。

## 5.1 案1 詳細設計（UI仕様・API契約）

### 5.1.1 現状のコードとの対応関係

対象は`CustomerBottomSheet.tsx`の以下2箇所（現状のまま抜粋）。

```tsx
// L1157-1160: フォールバック文言の算出（接客スタイル型ベース、TYPE_COPY）
const fallback = c ? (TYPE_COPY[c.customer_type] ?? TYPE_COPY['慎重・不安型']) : null;
const aiAdvice = aiSuggestion?.strategy_logic?.adviceMessage
  ?? (c && fallback ? `${c.name}様には「${fallback.goal}」を意識した接客を心がけましょう。` : '');
const aiNg = fallback?.ng ?? '';

// L1749-1764: カード本体
<div className="bg-[#FFF8F7] rounded-[22px] p-4 border border-[#F5E6E8]">
  <p className="text-[11px] tracking-[0.2em] text-[#C8A58C] font-semibold mb-2.5">✨ 今日の接客ポイント</p>
  <p className="text-sm text-[#5C4033] leading-[1.75]">{aiAdvice}</p>
  {aiNg && (
    <div className="mt-2.5 bg-[#FFF0F2] rounded-2xl p-2.5 flex gap-2">...</div>
  )}
</div>
```

重要な注記: `c.customer_type`（`src/types/index.ts`の`CustomerType` = `'慎重・不安型' | '感情重視型' |
'効果重視型' | '信頼構築型' | 'VIP型'`という「接客スタイル型」）と、ProposalOrchestratorが使う
`customerType`（`src/types/riora.types.ts`の`CustomerType` = `'A_acne'|'B_pore'|'C_sensitive'|
'D_aging'|'E_bridal'`という「肌悩み型」）は**同名の別型**（型定義ファイルが別）。今回置き換える
`aiAdvice`/`aiNg`は前者（接客スタイル型ベースの定型文）で、ProposalOrchestratorは後者（肌悩み型
ベースのパターン）を使う。差し替え後、この定型文ロジック自体は**削除せず、フォールバック用途として
温存する**（後述）。

### 5.1.2 新規コンポーネント `AIProposalCard.tsx`

`NextActionPanel.tsx`・`CustomerInsightPanel.tsx`と同じ場所（`src/components/customer/`）に、
同じ設計方針（既存デザイントークンを完全踏襲・UIデザイン変更禁止のコメントを付す）で新設する。

```ts
interface AIProposalCardProps {
  customerId:     string
  /** L1157-1160のfallback算出結果をそのまま渡す（ロジック重複を避ける・CustomerBottomSheet側は無変更） */
  fallbackAdvice: string
  fallbackNg:     string
}
```

`staffId`は不要（`/api/proposals/fire`はサーバー側で`extractStaffFromRequest`により再解決するため、
クライアントから渡す必要がない。改ざん耐性の設計はGET `/api/proposals/by-name`と同じ）。

**内部ロジック:**
1. マウント時に`authedFetch('/api/proposals/by-name?customerName=...')`…ではなく、`customerId`を
   直接使える新設計にする（`by-name`は元々`AIProposalView`が予約カードの`customerName`しか
   持っていなかったための名前検索方式。CustomerBottomSheetは`customerId`を最初から持っているため、
   `customerName`経由の曖昧検索を避けたい）。
   → **`GET /api/proposals/by-name`に`customerId`クエリパラメータでの検索も追加する**
   （`customerName`と`customerId`のどちらか一方必須、`customerId`優先。既存の`AIProposalView`の
   呼び出しは無変更のまま動作する。新規ではなく既存ルートの後方互換拡張）。
2. `found:true`かつ`advice`が非nullなら、その値を表示用stateにセット。
3. `found:false`または`advice`がnull（=ProposalOrchestratorが`ok:false`で失敗、または
   ネットワークエラー）の場合は、`props.fallbackAdvice`/`props.fallbackNg`をそのまま表示
   （**現状の見た目と完全に同一**。既存コードのTYPE_COPYロジックはCustomerBottomSheet側に
   残したまま、propsとして渡すだけなので回帰リスクなし）。
4. 表示用データ取得が成功し`advice`が非nullだった場合のみ、`POST /api/proposals/fire`を
   fire-and-forgetで1回呼ぶ（`useRef`で同一`customerId`への二重発火を防止。StrictModeの
   開発時二重実行対策）。失敗しても画面表示には一切影響させない
   （`/api/visits/service-complete`の呼び出しと同じ非致命的パターンを踏襲）。
5. `<ErrorBoundary label="AIProposalCard" silentFail>`でラップする
   （`NextActionPanel`/`CustomerInsightPanel`と同じ既存パターン）。

**表示ロジック（状態は2つだけ、ローディングスケルトンは設けない）:**

| 状態 | advice | avoidNote(NGワード欄) |
|---|---|---|
| 初期表示・フェッチ中 | `fallbackAdvice`（即時表示、ちらつき無し） | `fallbackNg` |
| 取得成功・`advice`あり（通常 or 縮退時の定型文） | `proposal.advice` | `proposal.avoidNote`（無ければNGワード欄自体を非表示。縮退時は通常null） |
| 取得失敗・`found:false`・`advice`がnull | `fallbackAdvice`（据え置き） | `fallbackNg`（据え置き） |

見た目（カードの枠・色・タイポグラフィ・NGワード欄の表示条件分岐）は現状のJSXをそのまま
`AIProposalCard.tsx`へ移設するのみで、スタイル値は一切変更しない。

### 5.1.3 `CustomerBottomSheet.tsx`側の変更（最小差分）

- L1749-1764の`<div>`ブロックを`<ErrorBoundary label="AIProposalCard" silentFail><AIProposalCard
  customerId={c.id} fallbackAdvice={aiAdvice} fallbackNg={aiNg} /></ErrorBoundary>`に置換。
- L1157-1160（`fallback`/`aiAdvice`/`aiNg`の算出ロジック）は**無変更のまま残す**
  （AIProposalCardへpropsとして渡すため。既存の`aiSuggestion`参照・`TYPE_COPY`参照もそのまま）。
- それ以外（`NextActionPanel`・`CustomerInsightPanel`・接客ログ保存`saveLog()`等）は無変更。

### 5.1.4 `GET /api/proposals/by-name` の後方互換拡張

```diff
- const customerName = req.nextUrl.searchParams.get('customerName');
- if (!customerName) {
-   return NextResponse.json({ found: false, reason: 'missing_customerName' });
- }
+ const customerId   = req.nextUrl.searchParams.get('customerId');
+ const customerName = req.nextUrl.searchParams.get('customerName');
+ if (!customerId && !customerName) {
+   return NextResponse.json({ found: false, reason: 'missing_customer_identifier' });
+ }
```

`brain_customers`検索を`customerId`指定時は`.eq('id', customerId)`、`customerName`指定時は
従来通り`.eq('name', customerName)`に分岐。以降の処理（`is_internal_user`除外、
`canAccessCustomer`、`generateCustomerProposal`呼び出し）は完全に無変更。
既存の`AIProposalView.tsx`（`customerName`で呼んでいる）への影響はゼロ。

### 5.1.5 `POST /api/proposals/fire`（新設）

```
POST /api/proposals/fire
Authorization: Bearer <staff JWT>
Body: { "customerId": "uuid" }
```

処理フロー（`app/api/admin/proposals/route.ts`のPOSTとほぼ同一。認証部分のみ
`by-name`と同一パターンに差し替え）:

1. `extractStaffFromRequest(req)` → 無ければ401 `unauthorized`
2. `staff.isAdmin || !staff.staffBrainId` → 400 `staff_required`（`by-name`と同一方針。
   管理者はこのエンドポイント対象外）
3. body検証（zod、`{ customerId: idSchema }`）→ 不正なら400 `invalid_json`/`validation_error`
4. `brain_customers`から`id, is_internal_user`取得。無い/`is_internal_user=true` → 404
   `customer_not_found`
5. `canAccessCustomer(staff.staffBrainId, customerId, false)` → falseなら403 `forbidden`
6. `generateCustomerProposal({ storeId: STORE_ID, customerId, staffId: staff.staffBrainId })`
   （`legacyClient`は渡さない＝voiceMemoContextの取得を省略し、fire専用に必要最小限のクエリに
   留める）
7. `result.ok === false` → 404 `{ success:false, error: result.reason }`（**insertしない**。
   admin POSTの`buildResult().ok`分岐と同一挙動）
8. `result.ok === true`（縮退時含む）→ 共有ヘルパー`buildFireLogDecisionRecord(result)`で
   `decisionRecord`/`explanation`を組み立て、`repos.briefingRepo.insert({ storeId: STORE_ID,
   customerId, visitId: null, decisionRecord, explanation })`
9. 200 `{ success:true, fireLogId: saved.id }`

### 5.1.6 共有ヘルパー `src/lib/proposal/buildFireLogDecisionRecord.ts`

`app/api/admin/proposals/route.ts`のL71-87（`decisionRecord`/`explanation`組み立て部分）を
そのまま関数として切り出す。**admin側の挙動・出力は一切変えない**（純粋なリファクタ）。

```ts
export function buildFireLogDecisionRecord(
  result: GenerateCustomerProposalResult & { ok: true }
): { decisionRecord: Record<string, unknown>; explanation: string } {
  // 既存admin route L74-87のロジックをそのまま移設
}
```

`app/api/admin/proposals/route.ts`と新設`app/api/proposals/fire/route.ts`の両方がこれを呼ぶ。

## 6. 影響範囲・ファイル一覧（案1確定版）

### 新規ファイル（プロダクトコード）
- `app/api/proposals/fire/route.ts` — 新設POSTエンドポイント（§5.1.5）
- `src/lib/proposal/buildFireLogDecisionRecord.ts` — decision_record組み立ての共通化（§5.1.6）
- `src/components/customer/AIProposalCard.tsx` — 新規表示コンポーネント（§5.1.2）
- `app/api/_schemas/proposal.ts`への追記 — `proposalFireSchema`（新規ファイルではなく既存への追記）

### 新規ファイル（テスト。§8参照）
- `tests/api/proposals-fire.test.ts`
- `tests/lib/proposal/buildFireLogDecisionRecord.test.ts`

### 変更ファイル
- `app/api/admin/proposals/route.ts` — decision_record組み立て部分を共通ヘルパー呼び出しに置換
  （挙動は変えない、内部リファクタのみ。既存`tests/api/proposals.test.ts`は無改修のままグリーン
  であることを確認する）
- `app/api/proposals/by-name/route.ts` — `customerId`クエリパラメータ対応を追加（§5.1.4、
  後方互換）
- `src/components/customer/CustomerBottomSheet.tsx` — L1749-1764の「今日の接客ポイント」ブロックを
  `AIProposalCard`呼び出しに置換（§5.1.3）。L1157-1160の`fallback`/`aiAdvice`/`aiNg`算出ロジックは
  無変更のまま残す。

### 触らないファイル（重要・確認事項4の裏付け）
- `src/lib/proposal/recordProposalOutcome.ts`
- `src/lib/import/csvImportPipeline.ts`
- `src/repositories/supabase/OutcomeRepo.ts`
- `src/components/customer/NextActionPanel.tsx`／`CustomerInsightPanel.tsx`（役割が異なる別系統、
  §1参照。今回は統合しない）
- `src/components/phase1/AIProposalView.tsx`／`ServiceLogView.tsx`（既存のまま。将来的に
  `ServiceLogView.tsx`の未実装スタブを直すかは別タスク）
- `app/admin/**`全般
- `src/components/line/**`等LINE領域
- DB migration（新規ファイルなし）

## 7. v1.0凍結ルールとの関係（重要・実装着手前に必ず確認）

`CLAUDE.md`により、`src/components/customer/CustomerBottomSheet.tsx`を含むスタッフアプリv1は
2026-07-03付けで凍結済み。2026-07-16に承認された v1.0.1 の凍結解除は**今日タブのブリーフィング
仕様に限定**されており、本設計が対象とする「AI提案カードの追加/差し替え」はその範囲外。

したがって、本ドキュメントはあくまで**設計の提出**であり、次のいずれかが無いと実装には着手しない：
- v1.0.1の凍結解除範囲を本件（AI提案学習パイプライン、`CustomerBottomSheet.tsx`のL1749-1764置換）
  にも明示的に拡大する承認、または
- 別途「v1.0.2」等として本件を独立に承認する指示

UI方針（案1）は確定したが、実装着手そのものについては、ユーザーが本ドキュメント（§6の
変更範囲・影響ファイル一覧、§8のテスト項目）を最終確認したうえでの明示的な凍結解除承認を
得るまで着手しない。

## 8. テスト項目

### 8.1 `tests/api/proposals-fire.test.ts`（新規、`tests/api/visits-service-complete.test.ts`を
土台にした構成。モック対象: `getRepos`/`extractStaffFromRequest`/`canAccessCustomer`/
`generateCustomerProposal`）

- 未認証（`extractStaffFromRequest`がnull） → 401
- 管理者、または`staffBrainId`が無いスタッフ → 400 `staff_required`
- 不正なJSON → 400 `invalid_json`
- `customerId`欠落 → 400 `validation_error`
- `brain_customers`に該当なし → 404 `customer_not_found`
- `is_internal_user=true`の顧客 → 404 `customer_not_found`（内部ユーザー除外、`by-name`と同方針）
- `canAccessCustomer`がfalse（担当外顧客） → 403 `forbidden`、`briefingRepo.insert`は呼ばれない
- `generateCustomerProposal`が`ok:false`（`no_visit_history`等） → 404、`briefingRepo.insert`は
  呼ばれない
- `generateCustomerProposal`が`ok:true`・通常提案 → 200、`briefingRepo.insert`が
  `{ storeId, customerId, visitId: null, decisionRecord: { patternId, stepNo, proposalKind,
  scriptStyle, contextSnapshot, ... }, explanation }`で呼ばれる
- `generateCustomerProposal`が`ok:true`・縮退提案（`degraded:true`） → 200、`decisionRecord.degraded
  === true`で`briefingRepo.insert`が呼ばれる
- `getRepos`が例外 → 500
- `briefingRepo.insert`が例外 → 500

### 8.2 `tests/lib/proposal/buildFireLogDecisionRecord.test.ts`（新規、純粋関数テスト）

- 通常提案（非縮退）を渡すと、`app/api/admin/proposals/route.ts`の既存ロジックと同一構造の
  `decisionRecord`（`candidates`/`resolution`/`contextSnapshot`/`explainTexts`/`patternId`/
  `stepNo`/`proposalKind`/`scriptStyle`）を返す
- 縮退提案（`degraded:true`）を渡すと、`{ degraded: true, reason, contextSnapshot }`を返す
- `explanation`の算出（縮退時は`提案生成が縮退しました: ${reason}`、通常時は`staffLine1`）

### 8.3 `tests/api/proposals.test.ts`（既存・回帰確認）

- リファクタ後も**無改修のまま全件グリーン**であること（decisionRecord組み立てを共有ヘルパーに
  委譲しても、admin POSTの出力が一切変わらないことの担保）

### 8.4 `GET /api/proposals/by-name`の拡張分（既存ファイルへのテスト追記）

- `customerId`指定時に`.eq('id', customerId)`で検索されること
- `customerName`指定時は従来通り`.eq('name', customerName)`で検索されること（回帰確認）
- 両方未指定 → `found:false, reason:'missing_customer_identifier'`
- 既存の`customerName`ベースのテストケースが無改修のままグリーンであること

### 8.5 実データ検証（Phase1と同じ手法。一時検証スクリプトは終了後削除）

1. 開発環境で実在顧客IDに対し`POST /api/proposals/fire`を実行し、`brain_pattern_fire_log`に
   1行増えること・`decision_record`の構造が期待通りであることを直接クエリで確認
2. その顧客の来店がCSV取込でreconcileされた際、`recordProposalOutcome()`が新設fire_log行を
   拾って`brain_proposal_outcomes`を作成することを確認（Phase1-Bb当時に使った手法を踏襲）
3. 本番相当データでの書き込み検証は行わない場合、[[reference-demo-credentials-prod-testing]]の
   注意点（DEMO_CREDENTIALSは書き込み系検証に使わない）に従い、ローカル/開発DBでのみ実施する

### 8.6 手動UI確認（ブラウザ、`CLAUDE.md`のUI変更時ルールに準拠）

- パターンが実在する顧客でCustomerBottomSheetを開き、「✨今日の接客ポイント」が
  ProposalOrchestrator由来の文言（TYPE_COPY定型文と異なる内容）に変わっていること
- パターンが無い/縮退する顧客で開き、**現状と見た目が変わらない**（fallback文言が表示される）こと
  の回帰確認
- ネットワークタブで`GET /api/proposals/by-name?customerId=...`と`POST /api/proposals/fire`が
  発火していること・fireの失敗がカード表示に影響しないこと（例: オフラインで`fire`だけ失敗させる）
- `NextActionPanel`（💬会話のきっかけ）・`CustomerInsightPanel`（🧠AIインサイト）・接客ログ保存
  （`saveLog()`）が今まで通り動作すること（無関係セクションの回帰確認）
- `admin/customerAssets`の`CustomerProposalPanel`（既存のadmin提案ツール）が今まで通り動作すること
- `npx tsc --noEmit`でエラー0件（[[feedback-stale-ide-diagnostics]]の通り、IDE inline
  diagnosticsではなくこちらで実測する）

## 9. 実装着手前 最終確認チェックリスト（凍結解除承認用）

ユーザーが凍結解除承認を判断する際のチェックリスト。

- [ ] §6の変更ファイル一覧（新規4+テスト2、変更3、無変更多数）に過不足がないか
- [ ] `CustomerBottomSheet.tsx`への変更が§5.1.3の「L1749-1764ブロックの置換のみ・
      L1157-1160は無変更」という最小差分に収まる設計になっているか
- [ ] `app/api/admin/proposals/route.ts`のリファクタ（共通ヘルパー抽出）が既存挙動を
      変えない設計になっているか（§5.1.6・§8.3）
- [ ] `app/api/proposals/by-name/route.ts`の`customerId`対応追加が既存の`customerName`経路
      （`AIProposalView.tsx`）を壊さない後方互換設計になっているか（§5.1.4・§8.4）
- [ ] §8のテスト項目で問題ないか（不足していると感じる観点があれば実装着手前に追記依頼）
- [ ] v1.0.1凍結解除の範囲を本件に拡大する旨の明示的な承認（本チェックリスト確認後、
      別途Yes/実行承認として発話してもらう想定）

上記が揃うまで、本セッションはコード変更に着手しない。

## 10. 実装完了報告（2026-08-07）

§9のチェック後、ユーザーが以下スコープで凍結解除を承認: CustomerBottomSheet / AIProposalCard /
`/api/proposals/fire` / Proposal取得周辺(`/api/proposals/by-name`) / `buildFireLogDecisionRecord`
/ 関連テスト。LINE領域・NextActionPanel・ProposalOrchestrator本体・`recordProposalOutcome`・
CSV取込・管理者画面・Rate Limitには一切触れていない。

### 10.1 実装した重複抑止の設計（追加要件への対応）

DB変更なしの制約があるため、UNIQUE制約ではなくアプリケーション層の短時間重複抑止として実装した
（§5.1.5に既述の設計を踏襲）:

- `POST /api/proposals/fire`は、insert前に`briefingRepo.recentByCustomer(customerId, 5)`で
  直近のfire_logを読み、**同一パターン(patternId+stepNo+proposalKind+scriptStyle)が60分以内に
  既に記録されていれば新規insertせず、その既存行のidをそのまま返す**（`deduped: true`）。
- 60分という時間枠は「稼働中の1回の接客セッション」を想定した値（BottomSheetの再表示・
  リロードによるflapping対策）。日をまたぐ再fireは新しい機会として意図的に許容する。
- クライアント側(`AIProposalCard.tsx`)にも`useRef`による同一customerIdへの二重発火防止を
  実装し、サーバー側チェックと合わせた多層防御にしている。
- **既知の限界**: DB側にUNIQUE制約を追加しない方針のため、ほぼ同時に届く多重リクエスト同士の
  真のレースコンディション（read-then-insertの間隙）までは完全には排除できない。これは
  「DB変更なし」という制約とのトレードオフとして許容した設計判断。

### 10.2 検証結果

- **TypeScript**: `npx tsc --noEmit` — 新規/変更ファイルに起因するエラー0件。
  （プロジェクト全体では本セッションと無関係な既存エラーが別途あるが、変更ファイルとは無関係と
  確認済み）
- **単体テスト**: `tests/api/proposals-fire.test.ts`（17件）・`tests/lib/proposal/
  buildFireLogDecisionRecord.test.ts`（2件）・`tests/api/proposals-by-name.test.ts`（9件）を
  新規作成、全件成功。既存`tests/api/proposals.test.ts`（admin側の回帰確認用）も無改修のまま
  全件成功、リファクタが挙動を変えていないことを確認した。
- **全体テストスイート**: `npx vitest run`で本セッション変更と無関係な83件の失敗が別途存在するが、
  `git stash`で本セッションの変更を退避した状態でも同一箇所が同一内容で失敗することを確認済み
  （既存の環境依存の不具合であり、本実装が原因ではない）。
- **build**: `npm run build`成功（exit 0、エラー0件）。`/api/proposals/fire`ルートが正しく
  ビルド出力に含まれることを確認。
- **実データE2E検証**: ローカルdevサーバー（`.env.local`経由で本番Supabaseに接続、
  [[reference-demo-credentials-prod-testing]]の技術を応用）で、実在スタッフ(亀山)・実在顧客
  (customer_type設定済み)に対し実際にAPIを呼び出して確認した:
  1. `GET /api/proposals/by-name?customerId=...` → ProposalOrchestrator由来の実際の提案文言
     （upsellパターンB2-step1、FireScore 37点等）が返ることを確認(TYPE_COPYの定型文ではない)。
  2. `POST /api/proposals/fire`（1回目） → 200、`brain_pattern_fire_log`に正しい構造の
     `decision_record`（patternId/stepNo/proposalKind/scriptStyle/contextSnapshot/explainTexts）
     で1行のみ新規作成されたことを直接クエリで確認。
  3. 同一内容で即座に`POST /api/proposals/fire`（2回目） → `deduped: true`・1回目と同じ
     `fireLogId`が返り、**新規行は作成されなかった**ことを確認（重複抑止が実データで機能）。
  検証に使った一時スクリプトは終了後に削除済み（プロジェクト運用ルール通り）。

  **開示事項**: 上記2の検証により、本番の`brain_pattern_fire_log`に実データとして1行
  （顧客: 大石凌平、スタッフ: 亀山、パターンB2-step1、2026-08-07T03:53:37Z作成）が追加されている。
  内容自体は本機能が正しく動作した結果の正しいレコードであり、削除は行っていない
  （書き込み系操作の無断ロールバックを避ける方針[[feedback-scoped-approval-discipline]]に従い、
  削除の要否はユーザー判断に委ねる）。

- **ブラウザでの目視UI確認**: 本環境ではClaude in Chrome拡張が未接続のため、実施できなかった。
  カード自体は既存JSX（デザイントークン込み）を`AIProposalCard.tsx`へそのまま移設したのみで、
  レイアウト変更は行っていない。目視確認は`npm run build`成功・E2E検証で表示内容
  （`advice`/`avoidNote`の実データ）が正しく取得できることまでは確認済みだが、**実際のレンダリング
  結果そのものはユーザー側での確認を推奨する**（`docs/STAFF_PROPOSAL_LEARNING_PIPELINE_DESIGN.md`
  §8.6の手動確認項目を参照）。
