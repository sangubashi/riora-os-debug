/**
 * POST /api/admin/customer-merge/execute (顧客統合 Phase3: 統合実行)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §4・docs/DUPLICATE_MERGE_SAFETY_VALIDATION.md
 *
 * 実行内容(§4準拠):
 *   1. brain_visits.customer_id を統合元→統合先へ付け替え
 *   2. visit_count_at を来店日昇順に1から再採番(安全性検証済みロジック。simulateMerge.ts)
 *   3. reservations.brain_customer_id を統合元→統合先へ付け替え(CUSTOMER_MERGE_
 *      RESERVATION_MIGRATION_1。DUPLICATE_MERGE_QUEUE_IMPLEMENTATION_REVIEW.md §1で
 *      指摘された欠落の解消。Todayタブ(/api/home/reservations・/api/today-briefing)は
 *      brain_customer_id単位で重複排除するため、統合元を指したままの予約が残っていると
 *      同一人物の予約が複数の別顧客として重複表示され続ける)
 *   4. handover_notes.customer_id を統合元→統合先へ付け替え(CUSTOMER_MERGE_
 *      HANDOVER_NOTES_MIGRATION_1。全14件の重複候補グループ全てにhandover_notesの
 *      実データが存在することが判明したため対応。handover_notesはlegacy customers.id
 *      空間を参照するため、resolveLegacyCustomerIds()(src/lib/resolveLegacyCustomerIds.ts・
 *      candidates/[groupKey]/route.tsと同じ橋渡しパターン)でbrain_customers.id→
 *      legacy customers.idへ変換してから付け替える)
 *   5. 統合先の first_visit_date をグループ内最古の日付へ補正
 *   6. 統合元(消える側)を brain_customers.deleted_at で論理削除(物理削除はしない)
 *   7. brain_ops_logs(kind='customer_merge')へ監査ログを記録(§5のrollbackに必須。
 *      reservationReassignments・handoverNoteReassignmentsも含めて記録し、rollbackで
 *      復元できるようにする)
 *
 * 【既知の制約】Supabase-js経由の複数UPDATEは単一トランザクションではない(1件ずつの
 * 逐次実行)。途中で失敗した場合、部分適用状態が残る可能性がある(docs/DUPLICATE_MERGE_
 * QUEUE_DESIGN.md §4.3で言及済みの制約と同じ)。書き込み順序は「安全な中間状態」を
 * 維持するよう設計している: ①visit付け替え→②reservation付け替え→③handover_notes
 * 付け替え→④生き残りのfirst_visit_date更新→⑤統合元の論理削除→⑥監査ログ、の順で
 * 実行し、途中失敗時も統合先の情報が破損しないようにする。真の原子性が必要な場合は
 * 将来的にRPC化を検討する(本実装のスコープ外)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient, getRepos } from '../../../../lib/repos'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { DEMO_STORE_ID } from '@/lib/constants'
import {
  simulateMerge, type SimulateMergeCustomerInput, type SimulateMergeVisitInput,
  type SimulateMergeReservationInput, type SimulateMergeHandoverNoteInput,
} from '@/lib/customerMerge/simulateMerge'
import { classifyCategory } from '@/lib/customerMerge/detectDuplicateGroups'
import { resolveLegacyCustomerIds } from '@/lib/resolveLegacyCustomerIds'
import { toValidationErrorResponse } from '../../../_schemas/common'
import type { CustomerMergeAuditDetail } from '@/types/customerMerge'

const ExecuteMergeSchema = z.object({
  storeId: z.string().uuid().optional(),
  mergeGroupId: z.string().min(1),
  survivorId: z.string().uuid(),
  mergedIds: z.array(z.string().uuid()).min(1),
})

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ExecuteMergeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  const { mergeGroupId, survivorId, mergedIds } = parsed.data
  const storeId = parsed.data.storeId ?? DEMO_STORE_ID

  if (mergedIds.includes(survivorId)) {
    return NextResponse.json({ success: false, error: 'survivor_cannot_be_in_merged_ids' }, { status: 400 })
  }

  try {
    const supabase = getServiceClient()
    const allIds = [survivorId, ...mergedIds]

    const { data: customersData, error: customerError } = await supabase
      .from('brain_customers')
      .select('id, name, first_visit_date, store_id, deleted_at, is_internal_user')
      .in('id', allIds)
    if (customerError) return NextResponse.json({ success: false, error: customerError.message }, { status: 500 })

    const customers = customersData ?? []
    if (customers.length !== allIds.length) {
      return NextResponse.json({ success: false, error: 'some_customers_not_found' }, { status: 404 })
    }
    if (customers.some((c) => c.deleted_at !== null)) {
      return NextResponse.json({ success: false, error: 'customer_already_deleted' }, { status: 409 })
    }
    if (customers.some((c) => c.store_id !== storeId)) {
      return NextResponse.json({ success: false, error: 'store_id_mismatch' }, { status: 400 })
    }
    if (customers.some((c) => c.is_internal_user)) {
      // is_internal_user=trueの顧客(スタッフ本人の試用購入記録)は統合対象から除外する
      // (docs/NOTIFICATION_INTERNAL_USER_EXCLUSION.mdと同じ方針。統合候補一覧
      // (candidates/route.ts)は既にこれらを除外して表示しているため通常到達しないが、
      // 実行API単体でも二重に防御する)。
      return NextResponse.json({ success: false, error: 'internal_user_cannot_be_merged' }, { status: 400 })
    }

    const { data: visitsData, error: visitsError } = await supabase
      .from('brain_visits')
      .select('id, customer_id, visit_date, visit_count_at')
      .in('customer_id', allIds)
      .is('deleted_at', null)
    if (visitsError) return NextResponse.json({ success: false, error: visitsError.message }, { status: 500 })

    // 区分C(統合禁止)はサーバー側でも実行を拒否する(DUPLICATE_MERGE_QUEUE_IMPLEMENTATION_
    // REVIEW.md §4指摘: UI側の判定漏れだけでなく、実行APIそのものが区分を見ていなかった)。
    const visitCountByCustomer = new Map<string, number>()
    for (const v of visitsData ?? []) {
      visitCountByCustomer.set(v.customer_id, (visitCountByCustomer.get(v.customer_id) ?? 0) + 1)
    }
    const category = classifyCategory(allIds.map((id) => visitCountByCustomer.get(id) ?? 0))
    if (category === 'C') {
      return NextResponse.json({ success: false, error: 'category_c_cannot_be_merged' }, { status: 400 })
    }

    // reservations.brain_customer_id 付け替え対象(CUSTOMER_MERGE_RESERVATION_MIGRATION_1)。
    // legacy customers.id 経由の customer_id 列には触れない(RES-2確定方針・brain_customer_id
    // のみが今日タブ等の重複排除キーとして使われているため)。
    const { data: reservationsData, error: reservationsError } = await supabase
      .from('reservations')
      .select('id, brain_customer_id')
      .in('brain_customer_id', allIds)
    if (reservationsError) return NextResponse.json({ success: false, error: reservationsError.message }, { status: 500 })

    // handover_notes.customer_id 付け替え対象(CUSTOMER_MERGE_HANDOVER_NOTES_MIGRATION_1)。
    // handover_notesはlegacy customers.id空間を参照するため、統合先・統合元それぞれの
    // legacy idをresolveLegacyCustomerIds()で解決してから対象行を取得する。
    const survivorLegacyIds = await resolveLegacyCustomerIds(supabase, survivorId)
    const survivorLegacyId = survivorLegacyIds[0]

    const mergedLegacyIdSet = new Set<string>()
    for (const mergedId of mergedIds) {
      const legacyIds = await resolveLegacyCustomerIds(supabase, mergedId)
      legacyIds.forEach((legacyId) => { if (legacyId !== survivorLegacyId) mergedLegacyIdSet.add(legacyId) })
    }
    const mergedLegacyIds = Array.from(mergedLegacyIdSet)

    let handoverNotesData: { id: string; customer_id: string }[] = []
    if (mergedLegacyIds.length > 0) {
      const { data, error: handoverNotesError } = await supabase
        .from('handover_notes')
        .select('id, customer_id')
        .in('customer_id', mergedLegacyIds)
      if (handoverNotesError) return NextResponse.json({ success: false, error: handoverNotesError.message }, { status: 500 })
      handoverNotesData = data ?? []
    }

    const memberInputs: SimulateMergeCustomerInput[] = customers.map((c) => ({ id: c.id, firstVisitDate: c.first_visit_date }))
    const visitInputs: SimulateMergeVisitInput[] = (visitsData ?? []).map((v) => ({
      id: v.id, customerId: v.customer_id, visitDate: v.visit_date, visitCountAt: v.visit_count_at,
    }))
    const reservationInputs: SimulateMergeReservationInput[] = (reservationsData ?? []).map((r) => ({
      id: r.id, brainCustomerId: r.brain_customer_id as string,
    }))
    const handoverNoteInputs: SimulateMergeHandoverNoteInput[] = handoverNotesData.map((h) => ({
      id: h.id, customerId: h.customer_id,
    }))

    const plan = simulateMerge(
      survivorId, memberInputs, visitInputs, reservationInputs,
      survivorLegacyId, mergedLegacyIds, handoverNoteInputs
    )

    // ① brain_visits.customer_id 付け替え + visit_count_at 再採番
    for (const reassignment of plan.visitReassignments) {
      const { error } = await supabase
        .from('brain_visits')
        .update({ customer_id: plan.survivorId, visit_count_at: reassignment.newVisitCountAt })
        .eq('id', reassignment.visitId)
      if (error) {
        return NextResponse.json({
          success: false, error: `visit_reassignment_failed: ${error.message}`,
          partialFailure: true, visitId: reassignment.visitId,
        }, { status: 500 })
      }
    }

    // ② reservations.brain_customer_id 付け替え(Todayタブ重複表示の根本原因の解消)
    for (const reassignment of plan.reservationReassignments) {
      const { error } = await supabase
        .from('reservations')
        .update({ brain_customer_id: plan.survivorId })
        .eq('id', reassignment.reservationId)
      if (error) {
        return NextResponse.json({
          success: false, error: `reservation_reassignment_failed: ${error.message}`,
          partialFailure: true, reservationId: reassignment.reservationId,
        }, { status: 500 })
      }
    }

    // ③ handover_notes.customer_id 付け替え(legacy id空間・引継ぎメモの到達不能化を防ぐ)
    for (const reassignment of plan.handoverNoteReassignments) {
      const { error } = await supabase
        .from('handover_notes')
        .update({ customer_id: plan.survivorLegacyId })
        .eq('id', reassignment.handoverNoteId)
      if (error) {
        return NextResponse.json({
          success: false, error: `handover_note_reassignment_failed: ${error.message}`,
          partialFailure: true, handoverNoteId: reassignment.handoverNoteId,
        }, { status: 500 })
      }
    }

    // ④ 統合先の first_visit_date 補正
    const { error: survivorUpdateError } = await supabase
      .from('brain_customers')
      .update({ first_visit_date: plan.firstVisitDateAfter })
      .eq('id', plan.survivorId)
    if (survivorUpdateError) {
      return NextResponse.json({
        success: false, error: `survivor_update_failed: ${survivorUpdateError.message}`, partialFailure: true,
      }, { status: 500 })
    }

    // ⑤ 統合元の論理削除(物理削除はしない)
    const { error: deleteError } = await supabase
      .from('brain_customers')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', plan.mergedIds)
    if (deleteError) {
      return NextResponse.json({
        success: false, error: `merged_customers_delete_failed: ${deleteError.message}`, partialFailure: true,
      }, { status: 500 })
    }

    // ⑥ 監査ログ記録(rollbackに必須。docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §4.5準拠)
    const auditDetail: CustomerMergeAuditDetail = {
      mergeGroupId,
      sourceCustomerIds: plan.mergedIds,
      targetCustomerId: plan.survivorId,
      survivorLegacyId: plan.survivorLegacyId,
      executedAt: new Date().toISOString(),
      executedBy: gate.email,
      visitReassignments: plan.visitReassignments,
      reservationReassignments: plan.reservationReassignments,
      handoverNoteReassignments: plan.handoverNoteReassignments,
      firstVisitDateBefore: plan.firstVisitDateBefore,
      firstVisitDateAfter: plan.firstVisitDateAfter,
    }
    const repos = getRepos()
    const opsLog = await repos.opsLogRepo.insert({
      storeId,
      kind: 'customer_merge',
      actorId: null,
      detail: auditDetail as unknown as Record<string, unknown>,
    })

    return NextResponse.json({
      success: true,
      opsLogId: opsLog.id,
      survivorId: plan.survivorId,
      mergedIds: plan.mergedIds,
      visitsReassigned: plan.visitReassignments.length,
      reservationsReassigned: plan.reservationReassignments.length,
      handoverNotesReassigned: plan.handoverNoteReassignments.length,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
