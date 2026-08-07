/**
 * commitKarteImport.ts
 * karte_imports / customer_notes / contraindications への保存の唯一の経路。
 *
 * 設計: docs/CALTE_IMPORT_MVP_DESIGN.md §2.3・§8
 *   【鉄則】この3テーブルへの書き込みはこの関数からのみ行う（commitVoiceMemo.ts と
 *   同じ単一書込み経路の原則）。呼び出せるのは review画面の[保存する]ハンドラのみ。
 *   analyze API（analyzeKarteText.ts）は一切DBに触れず、この関数はスタッフが
 *   候補を確認・選択した後にのみ呼ばれる想定。
 *
 * 保存順序（ユーザー確定仕様）:
 *   ① karte_imports へ原文保存 → ② customer_notes → ③ contraindications
 *   原文保存に失敗した場合は customer_notes/contraindications への書込みを行わない。
 *
 * DB/Storageアクセスは CommitKarteImportRepo インターフェース経由に閉じ込め、
 * オーケストレーション本体は依存注入されたrepoのモックだけで純粋にテストできる
 * （src/lib/voice/commitVoiceMemo.ts と同じ設計方針）。
 */
import type { ContraindicationSeverity } from '@/types'

// ─── 公開型 ──────────────────────────────────────────────────────────────────

export interface CommitKarteImportPayload {
  customerId:  string
  staffId:     string | null
  rawText:     string
  selectedNotes: Array<{ content: string }>
  selectedContraindications: Array<{
    title:       string
    description: string
    severity:    ContraindicationSeverity
  }>
}

/**
 * commitKarteImport が必要とする永続化操作の最小インターフェース。
 * 実装は Supabase 版（createSupabaseCommitKarteImportRepo）を想定するが、
 * テストでは in-memory フェイクを注入する。
 */
export interface CommitKarteImportRepo {
  /** karte_imports への insert（このRepo実装内で唯一の書込み） */
  insertRawText(row: {
    customerId: string
    staffId:    string | null
    rawText:    string
  }): Promise<{ id: string }>
  /** customer_notes への insert（category=NULL固定、source='salonboard'固定） */
  insertNotes(rows: Array<{
    customerId: string
    staffId:    string | null
    content:    string
  }>): Promise<string[]>
  /** contraindications への insert（source='salonboard'固定） */
  insertContraindications(rows: Array<{
    customerId:  string
    title:       string
    description: string
    severity:    ContraindicationSeverity
  }>): Promise<string[]>
}

export type CommitKarteImportResult =
  | { ok: true;  karteImportId: string; noteIds: string[]; contraindicationIds: string[] }
  | { ok: false; reason: string; karteImportId: string | null }

// ─── オーケストレーション本体 ─────────────────────────────────────────────────

export async function commitKarteImport(
  repo:    CommitKarteImportRepo,
  payload: CommitKarteImportPayload,
): Promise<CommitKarteImportResult> {
  if (!payload.rawText.trim()) {
    return { ok: false, reason: 'raw_text_required', karteImportId: null }
  }

  // ── ① karte_imports insert（原文保存・唯一の書込み経路） ──
  let karteImportId: string
  try {
    const raw = await repo.insertRawText({
      customerId: payload.customerId,
      staffId:    payload.staffId,
      rawText:    payload.rawText,
    })
    karteImportId = raw.id
  } catch (e) {
    return {
      ok:            false,
      reason:        `raw_text_save_failed:${e instanceof Error ? e.message : String(e)}`,
      karteImportId: null,
    }
  }

  // ── ② customer_notes insert（スタッフが選択した項目のみ・唯一の書込み経路） ──
  let noteIds: string[] = []
  if (payload.selectedNotes.length > 0) {
    try {
      noteIds = await repo.insertNotes(payload.selectedNotes.map(n => ({
        customerId: payload.customerId,
        staffId:    payload.staffId,
        content:    n.content,
      })))
    } catch (e) {
      return {
        ok:            false,
        reason:        `notes_save_failed:${e instanceof Error ? e.message : String(e)}`,
        karteImportId,
      }
    }
  }

  // ── ③ contraindications insert（スタッフが選択した項目のみ・唯一の書込み経路） ──
  let contraindicationIds: string[] = []
  if (payload.selectedContraindications.length > 0) {
    try {
      contraindicationIds = await repo.insertContraindications(
        payload.selectedContraindications.map(c => ({
          customerId:  payload.customerId,
          title:       c.title,
          description: c.description,
          severity:    c.severity,
        }))
      )
    } catch (e) {
      return {
        ok:            false,
        reason:        `contraindications_save_failed:${e instanceof Error ? e.message : String(e)}`,
        karteImportId,
      }
    }
  }

  return { ok: true, karteImportId, noteIds, contraindicationIds }
}
