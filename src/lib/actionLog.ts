/**
 * actionLog.ts  —  customer_action_logs CRUD
 * 純粋な Supabase 操作のみ。UI依存なし。
 */
import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { stableQuery, prodLog, Mutex } from '@/lib/stability'
import type { ActionType, CustomerActionLog } from '@/types'

// ─── DEMO_MODE 用ダミーデータ ─────────────────────────────────────────────────

const DEMO_ACTIONS: ActionLogRow[] = [
  {
    id:              'demo-action-001',
    customer_id:     'demo',
    staff_id:        'demo-staff',
    action_type:     'line_sent',
    action_payload:  null,
    created_at:      new Date(Date.now() - 14 * 86400000).toISOString(),
    displayAt:       '14日前',
  },
  {
    id:              'demo-action-002',
    customer_id:     'demo',
    staff_id:        'demo-staff',
    action_type:     'homecare_explained',
    action_payload:  null,
    created_at:      new Date(Date.now() - 14 * 86400000).toISOString(),
    displayAt:       '14日前',
  },
  {
    id:              'demo-action-003',
    customer_id:     'demo',
    staff_id:        'demo-staff',
    action_type:     'rebook_recommended',
    action_payload:  null,
    created_at:      new Date(Date.now() - 42 * 86400000).toISOString(),
    displayAt:       '42日前',
  },
]

// ─── 行動ログ保存 ─────────────────────────────────────────────────────────────

export interface LogActionParams {
  customerId:    string
  staffId:       string | null
  actionType:    ActionType
  actionPayload?: Record<string, unknown>
}

const logMutex = new Mutex()

export async function logAction(params: LogActionParams): Promise<{ error: string | null }> {
  const { customerId, staffId, actionType, actionPayload } = params

  // DEMO_MODE: Supabase を呼ばない（401発生・/login遷移を防止）
  // VOICE_NOTES_LIVE時はvoice_*アクションのみ実DBへ進む（他の機能はDEMO_MODEのまま維持）
  const isVoiceLiveAction = VOICE_NOTES_LIVE && actionType.startsWith('voice_')
  if (DEMO_MODE && !isVoiceLiveAction) {
    prodLog('info', '[logAction] DEMO_MODE skip', { actionType })
    return { error: null }
  }

  const result = await stableQuery<{ error: string | null }>(
    async () => {
      const { error } = await supabase.from('customer_action_logs').insert({
        customer_id:    customerId,
        staff_id:       staffId,
        action_type:    actionType,
        action_payload: actionPayload ?? null,
      })
      if (error) return { error: error.message }
      return { error: null }
    },
    { error: null },
    { label: `logAction:${actionType}`, timeoutMs: 6000, maxAttempts: 2 }
  )

  if (result.error) {
    prodLog('error', '[logAction] 保存失敗', { actionType })
    return { error: result.error }
  }
  return { error: null }
}

// ─── 行動ログ取得（顧客別・直近N件） ─────────────────────────────────────────

export interface ActionLogRow extends CustomerActionLog {
  /** 表示用日時ラベル（例: 5/20 14:32）*/
  displayAt: string
}

export async function fetchRecentActions(
  customerId: string,
  limit = 10
): Promise<ActionLogRow[]> {
  // DEMO_MODE: Supabase を呼ばずダミーデータを返す（401発生を防止）
  if (DEMO_MODE) {
    return DEMO_ACTIONS.slice(0, limit)
  }

  const start = performance.now()
  const { data, error } = await supabase
    .from('customer_action_logs')
    .select('id, customer_id, staff_id, action_type, action_payload, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  const elapsed = performance.now() - start
  if (elapsed > 500) prodLog('slow', `[slow] fetchRecentActions ${elapsed.toFixed(0)}ms`)

  if (error || !data) {
    prodLog('warn', '[fetchRecentActions] 取得失敗', error?.message)
    return []
  }

  return (data as CustomerActionLog[]).map(row => ({
    ...row,
    displayAt: formatDisplayAt(row.created_at),
  }))
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function formatDisplayAt(iso: string): string {
  try {
    const d = new Date(iso)
    const m = d.getMonth() + 1
    const day = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${m}/${day} ${h}:${min}`
  } catch {
    return iso.slice(0, 16)
  }
}
