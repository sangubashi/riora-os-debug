# Repository & RPC Architecture v1.0

**株式会社martylabo / Salon Riora — データアクセス層 実装直結Code Architecture**
作成日: 2026-06-11
正典遵守: Master Schema v1.0–v1.2 / API Architecture v1.0 / Event Flow v1.0 / P0 API Schema v1.0。Engine側の契約はPattern/Scenario Code Architecture v1.0のRepository interfacesを実装する。

---

## 1. 全体構成と責務境界(10章の結論を先に)

```
Route Handler(薄)── Zod検証・role入口・envelope
   │
Service層(visitService等)── ユースケース編成・BE1実行・degraded管理
   │                          ↑ engines/(pure・TS)を呼ぶのはここだけ
Repository層(本書)── SQL↔TS変換・読取・単純書込。**ビジネス判断を持たない**
   │
RPC層(Postgres Function)── 原子性が必要な複合書込のみ。**TSロジックを持てない**
   │
Supabase(RLS)
```

**境界原則(確定)**:
- 計算(スコア・判定・Guard)はTS(engines)に置く。DBは「原子性・採番・状態遷移の整合」のみ担う
- よって save_visit_record RPC = **TX1のみ**。BE1はService層(TS)で実行(Event Flow準拠)
- approve系RPC = 状態遷移+apply の原子化。**Lv4 Guard/NG検査はRPC呼出前にTSで実施し、RPCはbefore照合(TOCTOU閉鎖)で防衛**
- Repositoryは1メソッド=1クエリ原則(JOINはRPC/VIEWに寄せる)。N+1をlintレベルで禁止(ループ内await repoの検出)

## 2. ディレクトリ構成

```
src/repositories/
  interfaces.ts / interfaces.scenario.ts     # Engine側契約(確定済)
  mappers.ts                                  # snake↔camel一元変換(唯一の変換点)
  supabase/
    CustomerRepository.ts
    VisitRepository.ts
    PatternRepository.ts
    ScenarioRepository.ts
    DashboardRepository.ts
    rpc.ts                                    # RPC呼出ラッパ(型付き)
supabase/migrations/
  W10_rpc_functions.sql                       # 3 RPC+補助関数
  W10_views.sql                               # context_bundle_v / pending_revisions_v
tests/repositories/                           # 統合テスト(ローカルSupabase)
```

## 3. Repository定義(責務・メソッド・入出力)

### 3-1. CustomerRepository

```typescript
export class CustomerRepository implements ICustomerRepo {
  /** Context Bundle一括取得(RPC get_context_bundle経由・1往復) */
  loadContextBundle(customerId: UUID): Promise<ContextBundle>;
  // 内容: customer + visits(昇順・deleted除外) + skin_records + pattern_progress
  //       + active subscription + 直近outcomes(20件) — RPC側で1JSONに合成

  findById(id: UUID): Promise<Customer | null>;
  create(input: CustomerCreate): Promise<Customer>;        // 初回カウンセリング
  updateProfile(id: UUID, patch: CustomerPatch): Promise<void>;
  updateChurn(id: UUID, score: number, reason: string | null): Promise<void>;  // BE1専用
  listBySegment(q: SegmentQuery): Promise<Page<CustomerListItem>>;  // dashboard用・必ずLIMIT
}
```

### 3-2. VisitRepository

```typescript
export class VisitRepository implements IVisitRepo {
  /** TX1はRPC。本Repoは呼出ラッパと読取のみ */
  saveVisitRecordTx1(input: SaveVisitTx1Input): Promise<Tx1Result>;  // → rpc.ts §5
  history(customerId: UUID, limit: number): Promise<Visit[]>;
  todayBookings(storeId: UUID, date: DateStr): Promise<BookingWithCustomer[]>;
  todaySalesCount(storeId: UUID, date: DateStr): Promise<{count: number; sum: number}>; // top補完
  updateVoiceMemoResult(visitId: UUID, summary: string): Promise<void>;  // after-visit-learning
}
```

### 3-3. PatternRepository(implements ICandidateRepo/IStatsRepo/IOutcomeRepo一部)

```typescript
export class PatternRepository {
  /** 2層解決済み候補(店内step)— NULL行+店舗行をCOALESCE解決して返す */
  loadActiveCandidates(storeId: UUID): Promise<Candidate[]>;
  // SQL: 店舗行優先のDISTINCT ON (code) ORDER BY store_id NULLS LAST
  loadCellStats(keys: CellKey[]): Promise<Map<string, CellStats>>;   // matview IN句1クエリ
  upsertProgress(p: PatternProgress): Promise<void>;                  // BE1
  insertOutcomes(rows: ProposalOutcomeInsert[]): Promise<void>;       // BE1・バルク
  insertFireLog(log: FireLogInsert): Promise<void>;                   // decision_record JSONB
  reconcileBriefedOutcomes(visitId: UUID, briefedKinds: ProposalKind[]): Promise<void>;
  // 前夜briefing消込: was_briefed=true化(BE1区画6)
}
```

### 3-4. ScenarioRepository(implements IScenarioRepo/ISendHistoryRepo/ITriggerLogRepo/IQueueRepo)

```typescript
export class ScenarioRepository {
  loadActiveScenarios(storeId: UUID): Promise<ScenarioCandidate[]>;  // 2層解決(同上SQL)
  recentSendHistory(customerId: UUID, days: number): Promise<SendHistoryItem[]>;
  permanentStops(customerId: UUID): Promise<Set<string>>;
  // SQL: scenario_outcomes WHERE was_approved=false GROUP BY code HAVING count>=2
  triggerLogExists(key: TriggerLogKey): Promise<boolean>;
  writeTriggerLog(entry: TriggerLogEntry): Promise<void>;
  insertPendingQueue(item: QueueItem): Promise<UUID | 'duplicate'>;
  // INSERT ... ON CONFLICT (customer_id, scenario_code, scheduled_date) DO NOTHING
  // RETURNING id — 戻り0行='duplicate'(例外にしない)
}
```

### 3-5. DashboardRepository

```typescript
export class DashboardRepository {
  getDaily(storeId: UUID, date: DateStr): Promise<DashboardDaily | null>;
  getDailyFallback(storeId: UUID, date: DateStr): Promise<{row: DashboardDaily; isStale: boolean}>;
  // 当日なし→前日(SILENT規約)。両方なし→ゼロ構造+isStale
  upsertDaily(row: DashboardDailyUpsert): Promise<void>;              // バッチ専用
  getBriefing(storeId: UUID, date: DateStr, staffId?: UUID): Promise<BriefingPayload | null>;
  upsertBriefing(storeId: UUID, date: DateStr, customerId: UUID, payload: Json): Promise<void>;
  listInsights(storeId: UUID, limit: 3): Promise<Insight[]>;
}
```

## 4. SQL責務の分け方(確定マトリクス)

| 処理 | 置き場所 | 理由 |
|---|---|---|
| Context Bundle合成 | **RPC(get_context_bundle)** | 5表JOIN+JSON合成を1往復に(性能予算) |
| visit_count_at採番 | **RPC(save_visit_record内)** | 同時実行の直列化はDBロックでしか保証できない |
| 2層マスタ解決 | **VIEW不使用・Repoの固定SQL** | DISTINCT ON 1文で済む・VIEWの隠れ依存を避ける |
| セル統計 | **matview読取** | 集計をリアルタイム経路から排除(確定済) |
| 状態遷移(approve系) | **RPC** | expectedStatus+before照合+書換の原子化 |
| スコア・判定・文面 | **TS(engines)** | テスト容易性・Explainability・決定論 |
| ページング・検索 | **Repo SQL** | 単純読取 |

## 5. RPC実装構造

### 5-1. save_visit_record(TX1専用)

```sql
-- W10_rpc_functions.sql(構造仕様・plpgsql)
CREATE FUNCTION save_visit_record(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_store uuid := (auth.jwt()->>'store_id')::uuid;  -- JWTから(クライアント値を信用しない)
BEGIN
  -- 0. 冪等: SELECT結果 FROM brain_visits WHERE store_id=v_store
  --        AND client_request_id = p->>'clientRequestId'
  --    → ヒット時は保存済みレスポンスJSON(visits.saved_response列 ※v1.2追加)を即RETURN
  -- 1. 整合検証(DBレベル最終防衛): customer/staff/menu が v_store に属し未削除
  -- 2. 採番: SELECT count(*) FROM brain_visits WHERE customer_id=...
  --          FOR UPDATE は customers行ロックで代替(SELECT .. FROM brain_customers
  --          WHERE id=.. FOR UPDATE) → 同一顧客の同時保存を直列化
  --    v_count := past+1。アプリ計算のvisitCountAtと不一致なら v_count を正とし
  --    response.degraded += 'score_recount'(visit_scoreは夜間バッチが再計算)
  -- 3. INSERT brain_visits(visit_score は p から・saved_response は後で UPDATE)
  -- 4. INSERT brain_skin_records(primary_delta は p から)
  -- 5. p->>'nextBookingMade' = true → INSERT brain_bookings(status='active')
  -- 6. saved_response 構築・UPDATE → RETURN
  -- 例外: 全て RAISE → クライアントに TX_FAILED(retriable)。部分確定なし
END $$;
```

**BE1はService層(TS)**: RPC成功後、visitService が engines(Progress/Outcomes/Churn/FireLog/ScenarioTrigger)を各区画独立tryで実行。失敗区画 → `evaluation_queue INSERT(visit_id, reason=区画名)` + ops_logs + degraded[]。**evaluation_queue挿入自体が失敗した場合のみ** ops_logs(kind='be1_orphan')に視認性最高で記録(夜間バッチが visits×progress 突合で孤児を検出する保険クエリを持つ)。

### 5-2. approve_revision

```sql
CREATE FUNCTION approve_revision(p_id uuid, p_expected text, p_note text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 1. SELECT .. FROM brain_revisions WHERE id=p_id FOR UPDATE
  --    status <> p_expected('proposed') → RAISE 'CONFLICT_PROCESSED'
  -- 2. before照合(TOCTOU閉鎖): 対象行(pattern_steps等・change_typeで分岐)の現在値と
  --    revision.before のJSONB一致を検証 → 不一致 RAISE 'CONFLICT_STALE'
  -- 3. apply: change_type別UPDATE(timing/condition/script→pattern_steps,
  --    staff_adjustment→brain_staff_adjustments, lifecycle→対象マスタ,
  --    churn_weights/params→brain_params新version INSERT)
  -- 4. version+1(brain_success_patterns / brain_scenarios)
  -- 5. brain_revisions: status='approved', decided_by=p_actor, decided_at=now()
  -- 6. scope='brand' → INSERT brain_learning_history
  -- 全体1TX。※Lv4 Guard再検査はRPC**前**にTSで実施済み(本RPCは構造整合のみ防衛)
END $$;
```

### 5-3. approve_line_send / reject_line_send

```sql
-- approve: FOR UPDATE → status='pending'検証 → expires_at>now()検証(超過→'CONFLICT_EXPIRED')
--          → status='approved', decided_by/at → RETURN(送信ワーカーがapprovedを拾う)
--          editedMessage は RPC前にTSでNG検査済み・p_messageで上書き
-- reject:  同検証 → status='rejected' → INSERT scenario_outcomes(was_approved=false,
--          reject_reason) → 同(scenario_code×customer)の却下数を集計し>=2なら
--          恒久停止は「scenario_outcomesから導出」(専用フラグ列を持たない・3-4の集計が正)
-- 冪等: 同一decision再送 → 現状statusが目的状態なら現状RETURN(200)・逆decision→CONFLICT
```

## 6. Transaction境界・冪等の総括表

| 操作 | 境界 | 冪等の仕組み |
|---|---|---|
| save_visit_record | RPC全体=TX1 / BE1は区画独立 | UNIQUE(store_id, client_request_id)+saved_response再生 |
| approve/reject系 | RPC全体1TX | FOR UPDATE+expectedStatus+目的状態なら現状返却 |
| queue起票 | 単INSERT | ON CONFLICT DO NOTHING(3キーUNIQUE) |
| trigger_log | 単INSERT | 4列UNIQUE(同日同イベント) |
| dashboard/briefing | 単UPSERT | PK衝突=上書き(バッチ再実行安全) |
| brain_events(ETL) | バルクINSERT | 5列UNIQUE ON CONFLICT DO NOTHING |

## 7. RLS考慮事項

| 実行者 | 接続 | 規律 |
|---|---|---|
| Route Handler読取(Repo) | ユーザーJWT(RLS有効) | store_idはRLSが強制。RepoのSQLにstore_id条件を**重ねて書く**(防衛二重化・RLS設定ミスの保険) |
| RPC(SECURITY DEFINER) | RLSバイパス | **store_idは必ずauth.jwt()から取得**。引数のstoreIdを信用しない(P0 Schema準拠)。関数冒頭で対象行の store_id=v_store 検証必須 |
| バッチ(service_role) | RLSバイパス | 全クエリにstore_id明示フィルタ(レビュー観点)。Brain層書込はBrain Batchキーのみ |
| 2層マスタ読取 | ユーザーJWT | NULL行読取ポリシー(Master Schema 30本のうち2本)で許可済み。Repoは追加条件不要 |

## 8. エラー処理・ログ戦略

| 層 | 方針 |
|---|---|
| Repository | DB例外を**ドメインエラーに翻訳**して再throw: unique→'DUPLICATE'/FK→'INVALID_REF'/RLS空振り→'NOT_FOUND'。生のPostgrestErrorを上層に漏らさない(mappers.tsにerrorMap) |
| RPC | RAISEのERRCODE規約: 'RIORA_CONFLICT_*'/'RIORA_VALIDATION' → rpc.tsがErrorCode(P0 Schema)に変換 |
| Service(BE1) | 区画try→evaluation_queue+ops_logs+degraded(確定済)。throwを外に出さない |
| ログ | Repo成功はログしない(ノイズ)。失敗のみops_logs。RPCはpg内RAISE LOG最小限(冪等hit件数のみ・監視用) |

## 9. テスト戦略

| 種別 | 対象 | 必須ケース |
|---|---|---|
| 統合(ローカルSupabase) | RPC 3本 | 冪等再送=同一レスポンス / **並行採番**(同一顧客に2並行save→visit_count_at連番・デッドロックなし) / stale revision / expired approve / 逆decision CONFLICT / before照合不一致 |
| 統合 | RLS | 別store JWTで全Repo読取0件 / RPCに偽storeId引数→jwt優先で拒否 / NULL行マスタが両店から見える |
| 統合 | Repo | 2層解決(店舗行優先・NULL行fallback) / duplicate='duplicate'戻り / fallback(前日dashboard) / 恒久停止導出(却下2件で出現) |
| 単体 | mappers | snake↔camel全カラム往復 / errorMap全分岐 |
| 性能 | get_context_bundle | 顧客200名・来店1000件で<100ms / loadCellStats IN句100キー<50ms |
| 保険 | BE1孤児検出 | evaluation_queue挿入失敗を注入→夜間突合クエリが検出 |

## 10. Master Schema差分(v1.3=W10として起票)

- brain_visits: `client_request_id UUID` + UNIQUE(store_id, client_request_id) / `saved_response JSONB`
- RPC 3本+get_context_bundle / pending_revisions_v(承認画面用VIEW)
- 本差分はMaster Schema改版手続き(チェックサム更新: UNIQUE+1, FK±0)に従い、本書採用と同時に発行する

---
*Repository & RPC Architecture v1.0 — データアクセス層の唯一の正。「計算はTS・原子性はDB・信用するのはJWTのみ」。tests/repositoriesのスケルトンから着手すること。*
