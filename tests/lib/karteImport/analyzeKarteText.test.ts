// ================================================================
// analyzeKarteText 検証
//
// docs/CALTE_IMPORT_MVP_DESIGN.md §2 受入テストに対応:
//   - Claude呼び出しのみでDBに一切触れない（fetchはClaude APIエンドポイントのみモック）
//   - レスポンスJSONを型付き候補へ正しく変換する
//   - Claude呼び出し失敗・不正レスポンス時はok:falseを返す
// ================================================================
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// route.ts系と同様、ANTHROPIC_API_KEYはモジュールトップレベル定数のため
// env設定後に動的importする。
let analyzeKarteText: typeof import('../../../src/lib/karteImport/analyzeKarteText').analyzeKarteText
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  ;({ analyzeKarteText } = await import('../../../src/lib/karteImport/analyzeKarteText'))
})

function mockClaudeResponse(text: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok:   true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  })))
}

const VALID_JSON = JSON.stringify({
  treatments:             [{ content: 'ハーブピーリング施術' }],
  skinCondition:          [{ content: '毛穴の開きが気になる状態' }],
  concerns:               [{ content: '乾燥が気になる' }],
  precautions:            [{ content: '日焼け直後のため強めの施術は避ける' }],
  contraindications:      [{ title: '妊娠中', description: '妊娠中のため一部施術禁忌', severity: 'HIGH' }],
  nextProposalCandidates: [{ content: '次回はハンドケアの提案を検討' }],
  visitDate:              '2026-08-01',
})

describe('analyzeKarteText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('正常系: JSONレスポンスを型付き候補へ変換する', async () => {
    mockClaudeResponse(VALID_JSON)
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.extracted.treatments).toEqual([{ content: 'ハーブピーリング施術' }])
      expect(result.extracted.contraindications).toEqual([
        { title: '妊娠中', description: '妊娠中のため一部施術禁忌', severity: 'HIGH' },
      ])
      expect(result.extracted.visitDateGuess).toBe('2026-08-01')
    }
  })

  it('前置き文やMarkdown装飾に囲まれたJSONでも抽出できる', async () => {
    mockClaudeResponse(`以下が抽出結果です:\n\`\`\`json\n${VALID_JSON}\n\`\`\``)
    const result = await analyzeKarteText('カルテ原文サンプル')
    expect(result.ok).toBe(true)
  })

  it('原文が短すぎる場合はClaudeを呼ばずtext_too_shortを返す', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await analyzeKarteText('短')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('text_too_short')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Claude APIがエラーステータスを返した場合はok:falseを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'error' })))
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('claude_api_error:500')
  })

  it('レスポンスにJSONが含まれない場合はok:falseを返す', async () => {
    mockClaudeResponse('JSONではないテキストです')
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_json_in_response')
  })

  it('fetchが例外を投げた場合はok:falseを返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('analysis_exception')
  })

  it('不正なseverity値はMEDIUMにフォールバックする', async () => {
    mockClaudeResponse(JSON.stringify({
      ...JSON.parse(VALID_JSON),
      contraindications: [{ title: '敏感肌', description: '刺激に弱い', severity: 'UNKNOWN' }],
    }))
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.extracted.contraindications[0].severity).toBe('MEDIUM')
    }
  })

  it('titleが無い禁忌候補は除外する', async () => {
    mockClaudeResponse(JSON.stringify({
      ...JSON.parse(VALID_JSON),
      contraindications: [{ description: 'タイトル無し', severity: 'LOW' }],
    }))
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.extracted.contraindications).toHaveLength(0)
  })

  it('空文字のcontentは候補から除外する', async () => {
    mockClaudeResponse(JSON.stringify({
      ...JSON.parse(VALID_JSON),
      treatments: [{ content: '' }, { content: '  ' }, { content: '有効な内容' }],
    }))
    const result = await analyzeKarteText('カルテ原文サンプル')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.extracted.treatments).toEqual([{ content: '有効な内容' }])
  })
})
