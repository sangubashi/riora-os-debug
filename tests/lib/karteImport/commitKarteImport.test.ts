// ================================================================
// commitKarteImport 検証
//
// docs/CALTE_IMPORT_MVP_DESIGN.md §2.3・§8 受入テストに対応:
//   - karte_imports / customer_notes / contraindications への書込みが
//     commitKarteImport 経由でのみ発生する
//   - 原文保存(karte_imports)が失敗した場合、customer_notes/contraindicationsへは
//     一切書き込まない
//   - 選択されなかった項目は保存されない
//     （このテストは in-memory fake のみを使い、実DB/ネットワークに一切触れない）
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  commitKarteImport,
  type CommitKarteImportPayload,
  type CommitKarteImportRepo,
} from '../../../src/lib/karteImport/commitKarteImport'

function createFakeRepo() {
  const rawTexts: Array<{ id: string; customerId: string; staffId: string | null; rawText: string }> = []
  const notes: Array<{ customerId: string; staffId: string | null; content: string }> = []
  const contraindications: Array<{ customerId: string; title: string; description: string; severity: string }> = []

  let nextRawId = 1
  let nextNoteId = 1
  let nextCiId = 1

  const repo: CommitKarteImportRepo = {
    async insertRawText(row) {
      const id = `ki-${nextRawId++}`
      rawTexts.push({ id, ...row })
      return { id }
    },
    async insertNotes(rows) {
      const ids: string[] = []
      for (const r of rows) {
        notes.push(r)
        ids.push(`note-${nextNoteId++}`)
      }
      return ids
    },
    async insertContraindications(rows) {
      const ids: string[] = []
      for (const r of rows) {
        contraindications.push(r)
        ids.push(`ci-${nextCiId++}`)
      }
      return ids
    },
  }

  return { repo, rawTexts, notes, contraindications }
}

function makePayload(overrides: Partial<CommitKarteImportPayload> = {}): CommitKarteImportPayload {
  return {
    customerId: 'customer-a',
    staffId:    'staff-1',
    rawText:    'カルテ原文テキスト',
    selectedNotes: [{ content: '施術内容メモ' }],
    selectedContraindications: [{ title: '敏感肌', description: '刺激に弱い', severity: 'MEDIUM' }],
    ...overrides,
  }
}

describe('commitKarteImport', () => {
  it('通常コミットで karte_imports 1件・customer_notes/contraindications を選択件数分だけ書き込む', async () => {
    const { repo, rawTexts, notes, contraindications } = createFakeRepo()
    const result = await commitKarteImport(repo, makePayload())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.karteImportId).toBe('ki-1')
      expect(result.noteIds).toHaveLength(1)
      expect(result.contraindicationIds).toHaveLength(1)
    }
    expect(rawTexts).toHaveLength(1)
    expect(rawTexts[0].rawText).toBe('カルテ原文テキスト')
    expect(notes).toHaveLength(1)
    expect(contraindications).toHaveLength(1)
  })

  it('選択候補が0件でも karte_imports には原文が保存される', async () => {
    const { repo, rawTexts, notes, contraindications } = createFakeRepo()
    const result = await commitKarteImport(repo, makePayload({ selectedNotes: [], selectedContraindications: [] }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.noteIds).toEqual([])
      expect(result.contraindicationIds).toEqual([])
    }
    expect(rawTexts).toHaveLength(1)
    expect(notes).toHaveLength(0)
    expect(contraindications).toHaveLength(0)
  })

  it('rawTextが空文字の場合は何も書き込まずok:falseを返す', async () => {
    const { repo, rawTexts } = createFakeRepo()
    const result = await commitKarteImport(repo, makePayload({ rawText: '   ' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('raw_text_required')
      expect(result.karteImportId).toBeNull()
    }
    expect(rawTexts).toHaveLength(0)
  })

  it('原文保存(karte_imports)が失敗した場合、customer_notes/contraindicationsへは書き込まない', async () => {
    const notes: unknown[] = []
    const contraindications: unknown[] = []
    const repo: CommitKarteImportRepo = {
      async insertRawText() { throw new Error('db down') },
      async insertNotes(rows) { notes.push(...rows); return rows.map((_, i) => `note-${i}`) },
      async insertContraindications(rows) { contraindications.push(...rows); return rows.map((_, i) => `ci-${i}`) },
    }

    const result = await commitKarteImport(repo, makePayload())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/^raw_text_save_failed/)
      expect(result.karteImportId).toBeNull()
    }
    expect(notes).toHaveLength(0)
    expect(contraindications).toHaveLength(0)
  })

  it('customer_notes保存が失敗した場合でもkarteImportIdは返す（原文は既に保存済みのため）', async () => {
    const repo: CommitKarteImportRepo = {
      async insertRawText() { return { id: 'ki-x' } },
      async insertNotes() { throw new Error('notes insert failed') },
      async insertContraindications(rows) { return rows.map((_, i) => `ci-${i}`) },
    }

    const result = await commitKarteImport(repo, makePayload())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/^notes_save_failed/)
      expect(result.karteImportId).toBe('ki-x')
    }
  })

  it('contraindications保存が失敗した場合でもkarteImportId・notes書込みは維持される', async () => {
    const insertedNotes: unknown[] = []
    const repo: CommitKarteImportRepo = {
      async insertRawText() { return { id: 'ki-y' } },
      async insertNotes(rows) { insertedNotes.push(...rows); return rows.map((_, i) => `note-${i}`) },
      async insertContraindications() { throw new Error('ci insert failed') },
    }

    const result = await commitKarteImport(repo, makePayload())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/^contraindications_save_failed/)
      expect(result.karteImportId).toBe('ki-y')
    }
    expect(insertedNotes).toHaveLength(1)
  })
})
