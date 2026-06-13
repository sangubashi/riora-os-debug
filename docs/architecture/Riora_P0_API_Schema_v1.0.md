# Riora P0 API Schema v1.0

**株式会社martylabo / Salon Riora**
作成日: 2026-06-11
正典関係: Database Master Schema v1.0(DB構造)/ API Architecture v1.0(API体系)を上位の正とする。本書はP0 API 6本のスキーマの唯一の正。
対象: ① SaveVisitRecord ② GetCustomerDetail ③ GetBriefing ④ GetDashboard ⑤ ApproveLineSend ⑥ ApproveRevision

---

# 0. 共通定義(全API適用)

## 0-1. 共通エンベロープ

```typescript
// src/types/api.types.ts
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  degraded?: DegradedSection[];   // Silent Error UX: 部分失敗の通知(UIは表示しない)
}
export interface ApiError {
  ok: false;
  error: { code: ErrorCode; message: string; retriable: boolean; requestId: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type DegradedSection =
  | 'pattern_progress' | 'proposal_outcomes' | 'churn' | 'fire_log' | 'scenario_trigger'
  | 'briefing_stale' | 'dashboard_stale';

export type ErrorCode =
  | 'UNAUTHORIZED'        // 401 認証なし
  | 'FORBIDDEN'           // 403 role/store不一致
  | 'NOT_FOUND'           // 404
  | 'VALIDATION_FAILED'   // 422 詳細はmessage(複数違反は;区切り)
  | 'CONFLICT'            // 409 冪等・状態遷移違反
  | 'GUARD_BLOCKED'       // 409 Lv4ガード違反(approve時)
  | 'TX_FAILED'           // 500 TX1失敗(retriable: true)
  | 'INTERNAL';           // 500
```

## 0-2. 共通HTTPルール

| 項目 | 規約 |
|---|---|
| 認証 | Authorization: Bearer(Supabase JWT)。claims: store_id, role('owner'/'manager'/'staff'), staff_id |
| Content-Type | application/json(音声のみmultipart・本書対象外) |
| 日付/時刻 | DATE='YYYY-MM-DD' / TIMESTAMPTZ=ISO8601。タイムゾーンはAsia/Tokyoでサーバ解決 |
| 金額 | 整数(円)。小数禁止 |
| ID | UUID v4文字列(小文字) |
| HTTPステータス | 200(ok:true) / 401 / 403 / 404 / 409 / 422 / 500。**部分失敗(degraded)は200** |

## 0-3. 共通ブランド型

```typescript
export type UUID = string;          // uuid v4
export type DateStr = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // ISO8601
export type CustomerType = 'A_acne'|'B_pore'|'C_sensitive'|'D_aging'|'E_bridal';
export type ChurnLevel = 'safe'|'warning'|'danger';
export type ProposalKind = 'homecare'|'rebooking'|'subscription'|'upsell'|'pack';
```

---

# 1. SaveVisitRecord

`POST /api/visits/save` → RPC `save_visit_record`

## 1-1. Request JSON

```json
{
  "clientRequestId": "9b2e6c1a-7f43-4d2e-9a01-3c5d8e7f1a22",
  "customerId": "c81d4e2e-bcf2-11e6-869b-7df92533d2db",
  "staffId": "a3bb189e-8bf9-3888-9912-ace4e6543002",
  "menuId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "isNomination": true,
  "retailAmount": 6600,
  "retailCategory": "保湿",
  "homecarePurchased": true,
  "homecareDeclined": false,
  "nextBookingMade": true,
  "noBookingReason": null,
  "nextDate": "2026-07-02",
  "nextStaffId": null,
  "voiceMemoUrl": null,
  "skinLevels": { "pore": 2, "dullness": 1 }
}
```

## 1-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "visitId": "0e3b7a6c-...",
    "visitCountAt": 3,
    "visitScore": 85,
    "churn": { "score": 0.12, "level": "safe" },
    "patternAdvanced": { "patternCode": "B1", "fromStep": 2, "toStep": 3 },
    "nextVisitProposals": [
      { "proposalKind": "subscription", "stepNo": 4, "isMandatory": true }
    ]
  },
  "degraded": []
}
```

## 1-3. TypeScript型

```typescript
export interface SaveVisitRequest {
  clientRequestId: UUID;
  customerId: UUID;
  staffId: UUID;
  menuId: UUID;
  isNomination: boolean;
  retailAmount?: number;            // 省略=0
  retailCategory?: '保湿'|'洗顔'|'美容液'|'その他';
  homecarePurchased: boolean;
  homecareDeclined?: boolean;       // 省略=false
  nextBookingMade: boolean;
  noBookingReason?: 'considering'|'unsure'|'cold'|null;
  nextDate?: DateStr;
  nextStaffId?: UUID;
  voiceMemoUrl?: string | null;
  skinLevels: Partial<Record<
    'acne'|'pore'|'dryness'|'redness'|'sagging'|'dullness'|'firmness', number>>;
}
export interface SaveVisitResponse {
  visitId: UUID;
  visitCountAt: number;
  visitScore: number;               // 0-100
  churn: { score: number; level: ChurnLevel };
  patternAdvanced: { patternCode: string; fromStep: number; toStep: number } | null;
  nextVisitProposals: Array<{ proposalKind: ProposalKind; stepNo: number; isMandatory: boolean }>;
}
```

## 1-4. Validation Rule

| 項目 | ルール |
|---|---|
| clientRequestId | 必須・UUID形式 |
| customerId/staffId/menuId | 必須・自store_idに存在・deleted_atなし |
| skinLevels | 各値 0–5 の整数。キーは7種のみ。**空オブジェクト可**(前回と同じ=入力なし) |
| retailAmount | 0–500,000・整数。retailAmount>0 のとき retailCategory推奨(必須にしない) |
| homecarePurchased=true かつ homecareDeclined=true | 422(矛盾) |
| nextBookingMade=true | nextDate必須・今日より後・180日以内 |
| nextBookingMade=false | nextDate/nextStaffId は無視(エラーにしない)。noBookingReason任意 |
| staffId | role='staff' の場合 JWT.staff_id と一致必須(代理入力禁止) |

## 1-5. Error Response(例)

```json
{ "ok": false, "error": { "code": "VALIDATION_FAILED",
  "message": "skinLevels.pore: must be 0-5; nextDate: required when nextBookingMade",
  "retriable": false, "requestId": "req_..." } }
```
TX1失敗: `{ code: 'TX_FAILED', retriable: true }` → UIは「保存できませんでした。もう一度タップ」+下書き保持(唯一エラーを見せるAPI)。

## 1-6. Idempotency Rule

- UNIQUE(store_id, client_request_id) を brain_visits に保持
- 同一IDの再送: TX1〜BE1をスキップし、**初回成功時のレスポンスを完全再現して200**(CONFLICTにしない — ダブルタップを成功体験にする)
- 異なるIDで同一(customerId, visit_date)の二重登録は許可(同日2回来店は実在する)が、レスポンスに visitCountAt が増えることで検知可能

## 1-7. Transaction Boundary

```
TX1(同期・ロールバック単位): brain_visits → brain_skin_records → brain_bookings
BE1(ベストエフォート・各々独立try): pattern_progress → proposal_outcomes →
    churn(customers) → pattern_fire_log → scenario_trigger/line_send_queue
BE1失敗 → evaluation_queue + ops_logs + degraded[]に区画名
非同期: after-visit-learning(voiceMemoUrl非null時)
dashboard_dailyへの書込なし(夜間バッチ専管)
```

## 1-8. Permission

Owner○ / Manager○ / Staff○(JWT.staff_id=staffIdのみ) / Service Role—(RPC直接) / Brain Batch—

---

# 2. GetCustomerDetail

`GET /api/customers/:id`(Context Bundle)

## 2-1. Request

パスパラメータ: id(UUID)。クエリ: `?include=skinTrend`(任意・肌時系列を同梱)

## 2-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "c81d...", "name": "佐藤様", "ageGroup": "30s",
      "customerType": "B_pore", "typeConfidence": 0.82,
      "goalNote": "毛穴の黒ずみ改善", "weddingDate": null,
      "acquisitionChannel": "hotpepper", "firstVisitDate": "2026-05-02",
      "assignedStaffId": "a3bb...", "isSubscriber": false,
      "churn": { "score": 0.12, "level": "safe", "reason": null },
      "csi": 68
    },
    "pattern": {
      "patternCode": "B1", "patternLabel": "毛穴改善→サブスク導線",
      "currentStep": 3, "totalSteps": 4, "stalled": false,
      "subscConditions": { "met": 3, "detail":
        { "firstVisitImpact": true, "homecare": true, "nominationStreak": true, "goalClear": false } }
    },
    "recentVisits": [
      { "visitId": "0e3b...", "visitDate": "2026-06-04", "menuName": "毛穴洗浄＋ヒト幹",
        "staffName": "亀山", "isNomination": true, "visitScore": 85,
        "homecarePurchased": true, "nextBookingMade": true }
    ],
    "memoSummary": "鼻の黒ずみを気にしている。来月旅行予定。",
    "skinTrend": [
      { "visitDate": "2026-05-02", "pore": 4, "dullness": 3 },
      { "visitDate": "2026-06-04", "pore": 2, "dullness": 1 }
    ]
  }
}
```

## 2-3. TypeScript型

```typescript
export interface CustomerDetailResponse {
  customer: {
    id: UUID; name: string; ageGroup: string | null;
    customerType: CustomerType | null; typeConfidence: number;
    goalNote: string | null; weddingDate: DateStr | null;
    acquisitionChannel: string | null; firstVisitDate: DateStr | null;
    assignedStaffId: UUID | null; isSubscriber: boolean;
    churn: { score: number; level: ChurnLevel; reason: string | null };
    csi: number;                                  // 0-100
  };
  pattern: {
    patternCode: string; patternLabel: string;
    currentStep: number; totalSteps: number; stalled: boolean;
    subscConditions: { met: 0|1|2|3|4; detail: {
      firstVisitImpact: boolean; homecare: boolean;
      nominationStreak: boolean; goalClear: boolean; } };
  } | null;                                       // 初回前はnull
  recentVisits: Array<{
    visitId: UUID; visitDate: DateStr; menuName: string; staffName: string;
    isNomination: boolean; visitScore: number;
    homecarePurchased: boolean; nextBookingMade: boolean; }>;  // 直近5件・降順
  memoSummary: string | null;                     // InsightGenerator要約(原文は返さない)
  skinTrend?: Array<{ visitDate: DateStr } & Partial<Record<
    'acne'|'pore'|'dryness'|'redness'|'sagging'|'dullness'|'firmness', number>>>;
}
```

## 2-4〜2-8. ルール

| 項目 | 内容 |
|---|---|
| Validation | id: UUID形式。include: 'skinTrend'のみ許可 |
| Error | NOT_FOUND(他店顧客はRLSで不可視=同じくNOT_FOUND・存在を漏らさない) |
| Idempotency | GET(副作用なし)。Cache-Control: no-store(肌・churnは日次変動) |
| Transaction | 読取のみ。1クエリJOIN(loadContextBundle)+memoSummaryはキャッシュ列読取 |
| Permission | Owner○ / Manager○ / Staff○(全顧客可・施術中の参照業務のため) / SR・BB— |

---

# 3. GetBriefing

`GET /api/briefing?date=2026-06-12`

## 3-1. Request

クエリ: date(任意・省略=今日)。staffスコープはJWTから解決(パラメータで他人分を要求不可)。

## 3-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "briefingDate": "2026-06-12",
    "generatedAt": "2026-06-11T23:31:04+09:00",
    "isStale": false,
    "items": [
      {
        "bookingId": "7d1f...", "time": "11:00",
        "customerId": "c81d...", "customerName": "佐藤様",
        "customerType": "B_pore", "visitNumber": 4,
        "patternLabel": "毛穴改善→サブスク導線", "patternStep": "第3段階→提案期",
        "todayGoal": "サブスク提案(条件4/4達成・今日が最適日)",
        "talkHint": "前回「鼻の黒ずみ」を気にされていた。毛穴写真の比較から入る",
        "avoidNote": "商品は1点のみ。重ね提案しない",
        "successReference": "同型顧客の4回目提案 成約率72%(n=18)",
        "proposals": [
          { "proposalKind": "subscription", "isMandatory": true,
            "script": "毛穴がここまで落ち着いてきたので、このペースを..." }
        ]
      }
    ]
  },
  "degraded": []
}
```

## 3-3. TypeScript型

```typescript
export interface BriefingResponse {
  briefingDate: DateStr;
  generatedAt: ISODateTime;
  isStale: boolean;            // 前日キャッシュへのフォールバック時true(Silent Error)
  items: BriefingItem[];       // 自分の担当予約のみ・時刻昇順
}
export interface BriefingItem {
  bookingId: UUID; time: string;             // 'HH:mm'
  customerId: UUID; customerName: string;
  customerType: CustomerType | null; visitNumber: number;
  patternLabel: string | null; patternStep: string | null;
  todayGoal: string; talkHint: string | null; avoidNote: string | null;
  successReference: string | null;
  proposals: Array<{ proposalKind: ProposalKind; isMandatory: boolean; script: string }>;
}
```

## 3-4〜3-8. ルール

| 項目 | 内容 |
|---|---|
| Validation | date: 今日±7日以内(過去の監査閲覧はP2の別API) |
| Error | 該当日キャッシュなし: ok:true・items:[]・isStale:true(エラーにしない) |
| Idempotency | GET。ETag=dashboard_cache.updated_at(同一なら304) |
| Transaction | dashboard_cache(kind='briefing')読取のみ。実テーブル集計しない |
| Permission | Staff○(自分の担当分のみ・API+RLS二重) / Manager・Owner○(staffId=クエリ指定で全員分閲覧可) / SR=生成側 / BB— |

---

# 4. GetDashboard

`GET /api/dashboard/top`(3分ルールの1本)

## 4-1. Request

クエリなし(店舗・当日はJWT/サーバ解決)。

## 4-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "snapshotDate": "2026-06-11",
    "month": {
      "sales": 1842000, "target": 2500000, "forecast": 2210000,
      "breakeven": 2180000, "breakevenGap": -338000, "achievementRate": 0.74
    },
    "today": { "bookings": 6, "expectedSales": 98000, "firstVisits": 2, "nominations": 3,
               "actualSalesSoFar": 57000 },
    "actions": {
      "churnDanger": { "count": 4, "customerIds": ["..."] },
      "noRebookingYesterday": 2,
      "subscReady": { "count": 2, "customerIds": ["..."] }
    },
    "insights": [
      { "id": "ins_...", "severity": "warning",
        "finding": "タイプB新規の次回予約率が82%→58%に低下",
        "causeHypothesis": "亀山担当分のHC提案が3回目に遅延傾向",
        "suggestedAction": "ブリーフィングの必須提案の実行確認" }
    ],
    "kpi": { "subscriberCount": 12, "subscriberDelta": 2, "mrr": 144000,
             "repeatRate90d": 0.68, "rebookingRate": 0.71, "homecareRate": 0.35 },
    "isStale": false
  }
}
```

## 4-3. TypeScript型

```typescript
export interface DashboardTopResponse {
  snapshotDate: DateStr;
  month: { sales: number; target: number | null; forecast: number;
    breakeven: number | null; breakevenGap: number | null; achievementRate: number | null };
  today: { bookings: number; expectedSales: number; firstVisits: number;
    nominations: number; actualSalesSoFar: number };   // actualのみリアルタイム軽量COUNT
  actions: {
    churnDanger: { count: number; customerIds: UUID[] };   // 上位10件まで
    noRebookingYesterday: number;
    subscReady: { count: number; customerIds: UUID[] };
  };
  insights: Array<{ id: string; severity: 'info'|'warning'|'critical';
    finding: string; causeHypothesis: string; suggestedAction: string }>;  // 最大3件
  kpi: { subscriberCount: number; subscriberDelta: number; mrr: number;
    repeatRate90d: number; rebookingRate: number; homecareRate: number };
  isStale: boolean;
}
```

## 4-4〜4-8. ルール

| 項目 | 内容 |
|---|---|
| Validation | なし(パラメータレス) |
| Error | dashboard_daily当日行なし → 前日行+isStale:true(SILENT)。前日もなし→ok:true・全数値null/0+isStale:true |
| Idempotency | GET。Cache-Control: private, max-age=60(actualSalesSoFarの鮮度上限) |
| Transaction | dashboard_daily 1行+ai_insights 3行+visits軽量COUNT(当日のみ)。**他テーブル集計禁止** |
| Permission | Owner○ / Manager○ / Staff—(403) / SR=生成側 / BB— |
| breakeven | business_settings.fixed_costs未設定の月はnull(UIは「設定待ち」表示) |

---

# 5. ApproveLineSend

`POST /api/line-queue/:id/approve`(却下は /reject・同型)

## 5-1. Request JSON

```json
{ "expectedStatus": "pending", "editedMessage": null }
```
却下時(/reject): `{ "expectedStatus": "pending", "rejectReason": "文面が硬い" }`

## 5-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "queueId": "q_7f3a...", "status": "approved",
    "scheduledAt": "2026-06-12T10:00:00+09:00",
    "scenarioCode": "S-SB-07", "customerId": "c81d..."
  }
}
```

## 5-3. TypeScript型

```typescript
export interface ApproveLineSendRequest {
  expectedStatus: 'pending';        // 楽観ロック(現在statusの宣言)
  editedMessage?: string | null;    // 承認時の文面微修正(NGワード検査を再通過)
}
export interface RejectLineSendRequest {
  expectedStatus: 'pending';
  rejectReason?: string;
}
export interface LineSendDecisionResponse {
  queueId: UUID;
  status: 'approved' | 'rejected';
  scheduledAt: ISODateTime | null;
  scenarioCode: string;
  customerId: UUID;
}
```

## 5-4. Validation Rule

| 項目 | ルール |
|---|---|
| id | 自store_idのline_send_queue行 |
| expectedStatus | 'pending'固定。実statusと不一致 → CONFLICT(誰かが先に処理) |
| editedMessage | 1–500文字。NGワード辞書再検査 → 検出時 GUARD_BLOCKED(承認自体を不成立に) |
| expires_at超過行 | CONFLICT(message: 'expired')。承認不可 |

## 5-5〜5-8. ルール

| 項目 | 内容 |
|---|---|
| Error | CONFLICT(処理済/期限切れ) / GUARD_BLOCKED(NG文面) / FORBIDDEN(staff) |
| Idempotency | 同一idへの同一decisionの再送 → 200で現状返却(冪等)。逆decision(approve済→reject) → CONFLICT |
| Transaction | 1TX: line_send_queue.status更新+decided_by/decided_at → (approve時)送信ワーカーへの予約 → (reject時)scenario_outcomes INSERT(was_approved=false, reject_reason)+**同一(scenario,customer)2回却下の恒久停止フラグ判定** |
| Permission | Owner○ / Manager○ / Staff—(閲覧のみ) / SR=sent遷移のみ / BB— |

---

# 6. ApproveRevision

`POST /api/revisions/:id/approve`(却下は /reject・同型)

## 6-1. Request JSON

```json
{ "expectedStatus": "proposed", "note": "C型のHC提案4回目化を採用" }
```

## 6-2. Response JSON

```json
{
  "ok": true,
  "data": {
    "revisionId": "rev_...", "status": "approved",
    "applied": {
      "patternCode": "C1", "stepNo": 3,
      "changeType": "timing",
      "newVersion": 3,
      "effectiveFrom": "2026-06-12"
    }
  }
}
```

## 6-3. TypeScript型

```typescript
export interface ApproveRevisionRequest {
  expectedStatus: 'proposed';
  note?: string;                    // 承認メモ(learning historyへ)
}
export interface ApproveRevisionResponse {
  revisionId: UUID;
  status: 'approved';
  applied: {
    patternCode: string; stepNo: number | null;
    changeType: 'timing'|'condition'|'script'|'new_pattern'|'churn_weights'|'staff_adjustment';
    newVersion: number;
    effectiveFrom: DateStr;         // 翌日のブリーフィング生成から有効
  } | null;                         // scope='brand'の承認はapply対象が配信側のためnull
}
```

## 6-4. Validation Rule

| 項目 | ルール |
|---|---|
| id | 自店(scope='store')はOwner/Manager。scope='brand'は本部権限(Phase1ではOwner=本部を兼ねる) |
| expectedStatus | 'proposed'のみapprove可。'rejected'/'approved'済 → CONFLICT |
| **Lv4 Guard再検査** | approve時に**必ず再実行**(起票時と承認時の二重)。違反 → GUARD_BLOCKED+ops_logs(kind='guard_violation')。**applyは一切行わない** |
| before整合 | apply直前に現在のpattern_steps値とrevision.beforeを照合。不一致(他のrevisionが先に適用済) → CONFLICT(message: 'stale revision')。再起票を促す |

## 6-5〜6-8. ルール

| 項目 | 内容 |
|---|---|
| Error | GUARD_BLOCKED / CONFLICT(stale/処理済) / FORBIDDEN |
| Idempotency | 同一idへのapprove再送 → 200で現状返却(applyは初回のみ)。approve後のreject → CONFLICT(取消はロールバックrevisionを新規起票する運用) |
| Transaction | 1TX: ①Lv4再検査 ②before照合 ③pattern_steps/staff_adjustments等の書換 ④success_patterns.version+1 ⑤brain_revisions.status='approved'+decided_by ⑥(scope='brand'時)brain_learning_history INSERT。**①②失敗時はTX全体不成立** |
| Permission | Owner○ / Manager○ / Staff— / SR=起票のみ / BB=scope='brand'起票のみ |
| 反映タイミング | 即時DB反映・**発火への反映は翌朝ブリーフィング生成から**(当日の施術中に基準が変わる事故を防ぐ) |

---

# 7. 型生成への申し送り(Claude Code)

1. 本書のinterfaceを `src/types/api.types.ts` にそのまま起こし、Route Handler/RPC/クライアントの3者で共有(独自定義の複製禁止)
2. ValidationはZodスキーマを各interfaceと1:1で生成(`SaveVisitRequestSchema`等)。本書4節の表がZodルールの正
3. ErrorCode→HTTPステータスのマッピングは0-1/0-2に固定。新コード追加は本書改版を先行
4. 楽観ロック(expectedStatus)と冪等(clientRequestId / 同一decision再送200)のテストをP0受入条件に含める: ①ダブルタップ ②承認競合 ③stale revision ④NG文面承認ブロック の4本は必須

---
*Riora P0 API Schema v1.0 — P0 API 6本のスキーマの唯一の正とする。*
