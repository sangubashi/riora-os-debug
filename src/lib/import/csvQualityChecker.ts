/**
 * csvQualityChecker.ts  — CSV品質チェック
 *
 * 取込前に品質スコア(0〜100)と警告を生成する。
 */

import type { SalonBoardRawRow } from '@/types'
import {
  detectDuplicateCustomers,
  detectTreatmentVariants,
  normalizeCustomerName,
  normalizeTreatmentName,
} from './normalizer'

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export type QualityLevel = 'excellent' | 'good' | 'fair' | 'poor'

export interface QualityWarning {
  type:     'duplicate_customer' | 'treatment_variant' | 'missing_field'
           | 'date_format' | 'zero_sales' | 'staff_variant'
  message:  string
  count:    number
  severity: 'error' | 'warn' | 'info'
}

export interface CsvQualityResult {
  score:       number          // 0〜100
  level:       QualityLevel
  totalRows:   number
  warnings:    QualityWarning[]
  summary:     string          // 1行コメント
}

// ─── 品質スコア算出 ───────────────────────────────────────────────────────────

export function checkCsvQuality(rows: SalonBoardRawRow[]): CsvQualityResult {
  if (rows.length === 0) {
    return { score: 0, level: 'poor', totalRows: 0,
      warnings: [{ type: 'missing_field', message: 'データが0件です', count: 0, severity: 'error' }],
      summary: 'データが空です' }
  }

  const warnings: QualityWarning[] = []
  let   deduction = 0

  // ① 重複顧客チェック
  const names      = rows.map(r => r.customerName)
  const duplicates = detectDuplicateCustomers(names)
  if (duplicates.length > 0) {
    deduction += Math.min(20, duplicates.length * 5)
    warnings.push({
      type:     'duplicate_customer',
      message:  `同姓同名の可能性があります: ${duplicates.map(d => d.names[0]).slice(0, 3).join('・')}`,
      count:    duplicates.length,
      severity: 'warn',
    })
  }

  // ② 施術名の揺れチェック
  const treatments = rows.map(r => r.treatment).filter(Boolean)
  const variants   = detectTreatmentVariants(treatments)
  if (variants.size > 0) {
    deduction += Math.min(15, variants.size * 5)
    const examples = Array.from(variants.entries()).slice(0, 2)
      .map(([canonical, v]) => `「${v[0]}」→「${canonical}」`)
    warnings.push({
      type:     'treatment_variant',
      message:  `施術名が統一されていません: ${examples.join(' / ')}`,
      count:    variants.size,
      severity: 'warn',
    })
  }

  // ③ 売上0件チェック
  const zeroSales = rows.filter(r => r.sales === 0).length
  if (zeroSales > 0) {
    const rate = zeroSales / rows.length
    deduction += Math.round(rate * 10)
    if (zeroSales >= 3) {
      warnings.push({
        type:     'zero_sales',
        message:  `売上が0円のデータが${zeroSales}件あります`,
        count:    zeroSales,
        severity: 'info',
      })
    }
  }

  // ④ 顧客名の表記揺れチェック（正規化前後が変わる件数）
  const nameVariants = rows.filter(r => normalizeCustomerName(r.customerName) !== r.customerName).length
  if (nameVariants > 0) {
    deduction += Math.min(10, Math.round(nameVariants / rows.length * 10))
    warnings.push({
      type:     'duplicate_customer',
      message:  `顧客名に全角・スペースの揺れがあります（${nameVariants}件を正規化）`,
      count:    nameVariants,
      severity: 'info',
    })
  }

  // ⑤ 施術名の自動正規化件数
  const treatVariants = rows.filter(r =>
    normalizeTreatmentName(r.treatment) !== r.treatment).length
  if (treatVariants > 0) {
    warnings.push({
      type:     'treatment_variant',
      message:  `施術名を${treatVariants}件自動正規化します`,
      count:    treatVariants,
      severity: 'info',
    })
  }

  // スコア計算
  const score = Math.max(0, Math.min(100, 100 - deduction))
  const level: QualityLevel =
    score >= 90 ? 'excellent' :
    score >= 75 ? 'good'      :
    score >= 55 ? 'fair'      : 'poor'

  const levelLabel = { excellent: '優秀', good: '良好', fair: '要確認', poor: '問題あり' }
  const summary = warnings.filter(w => w.severity !== 'info').length === 0
    ? `品質${levelLabel[level]}。取込に問題ありません。`
    : `${warnings.filter(w => w.severity === 'warn').length}件の警告があります。確認してから取込してください。`

  return { score, level, totalRows: rows.length, warnings, summary }
}
