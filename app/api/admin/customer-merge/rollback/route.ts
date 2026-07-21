/**
 * POST /api/admin/customer-merge/rollback (顧客統合 Phase4: rollback)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §5・docs/DUPLICATE_MERGE_SAFETY_VALIDATION.md §3.4
 *
 * 統合実行時(execute/route.ts)にbrain_ops_logs(kind='customer_merge')へ記録した
 * 監査ログ(visitReassignments・reservationReassignments・handoverNoteReassignments)
 * のみを使って統合前状態を復元する。
 *
 * 安全確認: 統合先(生き残り)に統合後新しいvisitが追加されていないかを確認する。
 * 監査ログに記録されたvisit群が「現在も統合先を指したまま・visit_count_atも
 * 統合直後の値のまま」であることを検証し、1件でもズレていれば復元を拒否する
 * (docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §5.2「統合後に新しいデータが追加されると
 * 完全な取り消しは難しくなる」という既知の制約を、機械的にチェックする形で実装する)。
 * reservations・handover_notesについても同様に「監査ログ記録の行が現在も統合先を
 * 指したままか」を確認する(どちらもvisit_count_atのような再採番が無いため、visitほど
 * 厳密な件数比較は不要。統合後に他の操作で移動されていないかの確認のみで十分)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient, getRepos } from '../../../../lib/repos'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { DEMO_STORE_ID } from '@/lib/constants'
import { toValidationErrorResponse } from '../../../_schemas/common'
import type { CustomerMergeAuditDetail, CustomerMergeRollbackAuditDetail } from '@/types/customerMerge'

const RollbackSchema = z.object({
  storeId: z.string().uuid().optional(),
  opsLogId: z.string().uuid(),
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

  const parsed = RollbackSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  const { opsLogId } = parsed.data
  const storeId = parsed.data.storeId ?? DEMO_STORE_ID

  try {
    const supabase = getServiceClient()

    const { data: opsLogRow, error: opsLogError } = await supabase
      .from('brain_ops_logs')
      .select('id, kind, detail, store_id')
      .eq('id', opsLogId)
      .maybeSingle()
    if (opsLogError) return NextResponse.json({ success: false, error: opsLogError.message }, { status: 500 })
    if (!opsLogRow) return NextResponse.json({ success: false, error: 'ops_log_not_found' }, { status: 404 })
    if (opsLogRow.kind !== 'customer_merge') {
      return NextResponse.json({ success: false, error: 'ops_log_is_not_a_merge_record' }, { status: 400 })
    }
    if (opsLogRow.store_id !== storeId) {
      return NextResponse.json({ success: false, error: 'store_id_mismatch' }, { status: 400 })
    }

    const auditDetail = opsLogRow.detail as unknown as CustomerMergeAuditDetail

    // 安全確認: 監査ログのvisitが現在も統合先を指したまま・visit_count_atも統合直後の
    // 値のままであることを確認する(統合後に新規visitが追加されていた場合はブロックする)。
    const visitIds = auditDetail.visitReassignments.map((r) => r.visitId)
    const { data: currentVisits, error: currentVisitsError } = await supabase
      .from('brain_visits')
      .select('id, customer_id, visit_count_at')
      .in('id', visitIds)
    if (currentVisitsError) return NextResponse.json({ success: false, error: currentVisitsError.message }, { status: 500 })

    const currentById = new Map((currentVisits ?? []).map((v) => [v.id, v]))
    const mismatches: string[] = []
    for (const r of auditDetail.visitReassignments) {
      const current = currentById.get(r.visitId)
      if (!current) { mismatches.push(`visit ${r.visitId}: 現在見つからない(削除済みの可能性)`); continue }
      if (current.customer_id !== auditDetail.targetCustomerId) mismatches.push(`visit ${r.visitId}: customer_idが統合先と異なる(別の操作で移動した可能性)`)
      if (current.visit_count_at !== r.newVisitCountAt) mismatches.push(`visit ${r.visitId}: visit_count_atが統合直後の値と異なる`)
    }

    // 統合先に統合後追加された新規visitが無いかも確認する(件数比較)。
    const { count: survivorCurrentVisitCount, error: countError } = await supabase
      .from('brain_visits')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', auditDetail.targetCustomerId)
      .is('deleted_at', null)
    if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 })
    if ((survivorCurrentVisitCount ?? 0) !== auditDetail.visitReassignments.length) {
      mismatches.push(`統合先のvisit数が統合直後(${auditDetail.visitReassignments.length}件)と一致しない(現在${survivorCurrentVisitCount}件。統合後に新規visitが追加された可能性)`)
    }

    // reservationsについても、監査ログ記録の予約が現在も統合先を指したままかを確認する
    // (reservationReassignmentsはCUSTOMER_MERGE_RESERVATION_MIGRATION_1で追加。旧い
    // 監査ログ(このフィールドが無いもの)ではreservationReassignmentsが未定義になり
    // うるため、空配列にフォールバックして安全側に倒す)。
    const reservationReassignments = auditDetail.reservationReassignments ?? []
    if (reservationReassignments.length > 0) {
      const reservationIds = reservationReassignments.map((r) => r.reservationId)
      const { data: currentReservations, error: currentReservationsError } = await supabase
        .from('reservations')
        .select('id, brain_customer_id')
        .in('id', reservationIds)
      if (currentReservationsError) return NextResponse.json({ success: false, error: currentReservationsError.message }, { status: 500 })

      const currentReservationById = new Map((currentReservations ?? []).map((r) => [r.id, r]))
      for (const r of reservationReassignments) {
        const current = currentReservationById.get(r.reservationId)
        if (!current) { mismatches.push(`reservation ${r.reservationId}: 現在見つからない(削除済みの可能性)`); continue }
        if (current.brain_customer_id !== auditDetail.targetCustomerId) {
          mismatches.push(`reservation ${r.reservationId}: brain_customer_idが統合先と異なる(別の操作で移動した可能性)`)
        }
      }
    }

    // handover_notesについても、監査ログ記録の行が現在も統合先のlegacy idを指したままか
    // を確認する(handoverNoteReassignments/survivorLegacyIdはCUSTOMER_MERGE_HANDOVER_
    // NOTES_MIGRATION_1で追加。旧い監査ログではどちらも未定義になりうるため、空配列/
    // targetCustomerIdへのフォールバックで安全側に倒す)。
    const handoverNoteReassignments = auditDetail.handoverNoteReassignments ?? []
    const survivorLegacyId = auditDetail.survivorLegacyId ?? auditDetail.targetCustomerId
    if (handoverNoteReassignments.length > 0) {
      const handoverNoteIds = handoverNoteReassignments.map((r) => r.handoverNoteId)
      const { data: currentHandoverNotes, error: currentHandoverNotesError } = await supabase
        .from('handover_notes')
        .select('id, customer_id')
        .in('id', handoverNoteIds)
      if (currentHandoverNotesError) return NextResponse.json({ success: false, error: currentHandoverNotesError.message }, { status: 500 })

      const currentHandoverNoteById = new Map((currentHandoverNotes ?? []).map((h) => [h.id, h]))
      for (const r of handoverNoteReassignments) {
        const current = currentHandoverNoteById.get(r.handoverNoteId)
        if (!current) { mismatches.push(`handover_note ${r.handoverNoteId}: 現在見つからない(削除済みの可能性)`); continue }
        if (current.customer_id !== survivorLegacyId) {
          mismatches.push(`handover_note ${r.handoverNoteId}: customer_idが統合先と異なる(別の操作で移動した可能性)`)
        }
      }
    }

    if (mismatches.length > 0) {
      return NextResponse.json({
        success: false, error: 'rollback_unsafe', reasons: mismatches,
        message: 'この統合は復元できません(統合後にデータが変化しているため)。docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §5.2参照。',
      }, { status: 409 })
    }

    // ① brain_visits を統合前の customer_id / visit_count_at へ復元
    for (const r of auditDetail.visitReassignments) {
      const { error } = await supabase
        .from('brain_visits')
        .update({ customer_id: r.fromCustomerId, visit_count_at: r.oldVisitCountAt })
        .eq('id', r.visitId)
      if (error) {
        return NextResponse.json({
          success: false, error: `visit_restore_failed: ${error.message}`, partialFailure: true, visitId: r.visitId,
        }, { status: 500 })
      }
    }

    // ② reservations.brain_customer_id を統合前の値へ復元
    for (const r of reservationReassignments) {
      const { error } = await supabase
        .from('reservations')
        .update({ brain_customer_id: r.fromCustomerId })
        .eq('id', r.reservationId)
      if (error) {
        return NextResponse.json({
          success: false, error: `reservation_restore_failed: ${error.message}`, partialFailure: true, reservationId: r.reservationId,
        }, { status: 500 })
      }
    }

    // ③ handover_notes.customer_id を統合前の値へ復元
    for (const r of handoverNoteReassignments) {
      const { error } = await supabase
        .from('handover_notes')
        .update({ customer_id: r.fromCustomerId })
        .eq('id', r.handoverNoteId)
      if (error) {
        return NextResponse.json({
          success: false, error: `handover_note_restore_failed: ${error.message}`, partialFailure: true, handoverNoteId: r.handoverNoteId,
        }, { status: 500 })
      }
    }

    // ④ 統合先の first_visit_date を統合前の値へ復元
    const { error: survivorRestoreError } = await supabase
      .from('brain_customers')
      .update({ first_visit_date: auditDetail.firstVisitDateBefore })
      .eq('id', auditDetail.targetCustomerId)
    if (survivorRestoreError) {
      return NextResponse.json({
        success: false, error: `survivor_restore_failed: ${survivorRestoreError.message}`, partialFailure: true,
      }, { status: 500 })
    }

    // ⑤ 統合元(消えた側)の論理削除を解除
    const { error: undeleteError } = await supabase
      .from('brain_customers')
      .update({ deleted_at: null })
      .in('id', auditDetail.sourceCustomerIds)
    if (undeleteError) {
      return NextResponse.json({
        success: false, error: `undelete_failed: ${undeleteError.message}`, partialFailure: true,
      }, { status: 500 })
    }

    // ⑥ rollback自体の監査ログを記録
    const rollbackDetail: CustomerMergeRollbackAuditDetail = {
      originalMergeOpsLogId: opsLogId,
      mergeGroupId: auditDetail.mergeGroupId,
      restoredCustomerIds: auditDetail.sourceCustomerIds,
      targetCustomerId: auditDetail.targetCustomerId,
      executedAt: new Date().toISOString(),
      executedBy: gate.email,
    }
    const repos = getRepos()
    const rollbackLog = await repos.opsLogRepo.insert({
      storeId,
      kind: 'customer_merge_rollback',
      actorId: null,
      detail: rollbackDetail as unknown as Record<string, unknown>,
    })

    return NextResponse.json({
      success: true,
      rollbackOpsLogId: rollbackLog.id,
      restoredCustomerIds: auditDetail.sourceCustomerIds,
      visitsRestored: auditDetail.visitReassignments.length,
      reservationsRestored: reservationReassignments.length,
      handoverNotesRestored: handoverNoteReassignments.length,
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
