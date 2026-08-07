/**
 * karteImport.ts — Salon Boardカルテ貼り付け機能 (Phase1) の型定義
 *
 * 設計: docs/CALTE_IMPORT_MVP_DESIGN.md
 * 抽出はAI解析API(analyze)、保存は別API(commit)で行う。analyzeはDB非接触。
 */
import type { ContraindicationSeverity } from '@/types'

/** カテゴリ別のテキスト候補（施術内容/肌状態/悩み/注意事項/次回提案候補） */
export interface KarteTextCandidate {
  content: string
}

/** 禁忌事項の候補。severityはcontraindications.severityのCHECK制約と同じ4値 */
export interface KarteContraindicationCandidate {
  title:       string
  description: string
  severity:    ContraindicationSeverity
}

/** POST /karte-import/analyze のレスポンス（DB書込みなし・候補提示のみ） */
export interface KarteExtractionResult {
  treatments:              KarteTextCandidate[]
  skinCondition:           KarteTextCandidate[]
  concerns:                KarteTextCandidate[]
  precautions:             KarteTextCandidate[]
  contraindications:       KarteContraindicationCandidate[]
  nextProposalCandidates:  KarteTextCandidate[]
  visitDateGuess:          string | null
}

/** POST /karte-import/commit のリクエスト。スタッフが選択したものだけを渡す */
export interface KarteImportCommitRequest {
  rawText:                    string
  selectedNotes:               KarteTextCandidate[]
  selectedContraindications:   KarteContraindicationCandidate[]
}

export interface KarteImportCommitResult {
  karteImportId:        string
  noteIds:               string[]
  contraindicationIds:   string[]
}
