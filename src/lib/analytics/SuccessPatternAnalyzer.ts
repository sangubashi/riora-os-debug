/**
 * SuccessPatternAnalyzer.ts  — Phase 2.5
 *
 * 実際のサロンデータから「売上上位スタッフの行動パターン」を抽出し
 * 他スタッフへの改善提案として返す。
 *
 * データソース（新規 DB 追加なし）:
 *   customers   — staffName / visitCount / totalSpent / hasNextRebook /
 *                 lineResponseRate / isVip / treatments / churnRisk
 *   staffRanking — StaffRankItem（useKpiStore）
 *   voice_notes  — Supabase（DEMO_MODE 時はスキップ）
 *
 * 設計方針:
 *   - 純粋関数 + DEMO_MODE 対応
 *   - ルールベース（外部 API 不使用）
 *   - 既存 ImprovementAnalyzer / ImpactCalculator と連携可能
 */

import type { CustomerRow }   from '@/store/useCustomerStore'
import type { StaffRankItem } from '@/store/useKpiStore'

// ─── 型定義 ──────────────────────────────────────────────────────────────────

/** スタッフごとの集計行動指標 */
export interface StaffBehaviorMetrics {
  staffName:       string
  totalSales:      number    // 担当顧客の累計売上合計
  nextReserveRate: number    // 次回予約取得率 (0〜100)
  repeatRate:      number    // リピーター比率 (visitCount >= 3)
  vipRate:         number    // VIP顧客比率
  lineResponseAvg: number    // 担当顧客の平均 LINE 返信率
  churnRiskAvg:    number    // 担当顧客の平均離脱リスク
  customerCount:   number    // 担当顧客数
  treatmentVariety: number   // 扱い施術種類数
}

/** 成功スタッフの行動パターン */
export interface SuccessPattern {
  title:          string
  metric:         string        // 対象指標名
  score:          number        // パターン強度 0〜100
  topStaff:       string        // 高成績スタッフ名
  topValue:       number        // トップの指標値
  bottomStaff:    string        // 改善余地スタッフ名
  bottomValue:    number        // 改善余地スタッフの指標値
  diffValue:      number        // 差分
  evidence:       string[]      // 根拠リスト
  action:         string        // 推奨アクション
  expectedImpact: number        // 月次期待インパクト（円）
}

export interface SuccessPatternResult {
  patterns:       SuccessPattern[]
  topStaff:       StaffBehaviorMetrics | null
  staffMetrics:   StaffBehaviorMetrics[]
  generatedAt:    string
}

// ─── DEMO 用モックパターン ────────────────────────────────────────────────────

const DEMO_PATTERNS: SuccessPattern[] = [
  {
    title:          '次回予約取得パターン',
    metric:         'nextReserveRate',
    score:          88,
    topStaff:       '鈴木',
    topValue:       92,
    bottomStaff:    '外舘',
    bottomValue:    62,
    diffValue:      30,
    evidence:       [
      '鈴木担当顧客の次回予約率 92%（全体平均 72%）',
      '高LTV顧客比率が他スタッフの1.4倍',
      '担当顧客の平均来店回数が高い',
    ],
    action:         '施術終了10分前に「次回はいつ頃にしましょうか」と自然に提案する。',
    expectedImpact: 43000,
  },
  {
    title:          'VIP化育成パターン',
    metric:         'vipRate',
    score:          76,
    topStaff:       '亀山',
    topValue:       38,
    bottomStaff:    '外舘',
    bottomValue:    14,
    diffValue:      24,
    evidence:       [
      '亀山担当顧客の VIP 比率 38%（全体平均 23%）',
      '担当顧客の平均 LINE 返信率が高い',
      '施術種類の多様性が高い',
    ],
    action:         'リピーター顧客に対して上位コースやオプションを段階的に提案する。',
    expectedImpact: 28000,
  },
]

// ─── スタッフ別行動指標を customers から集計 ─────────────────────────────────

export function calcStaffMetrics(
  customers:    CustomerRow[],
  staffRanking: StaffRankItem[],
): StaffBehaviorMetrics[] {
  // staffName ごとにグループ化
  const groups: Record<string, CustomerRow[]> = {}

  for (const c of customers) {
    if (!c.staffName) continue
    const key = c.staffName.trim()
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  }

  // 既知のスタッフ名セット（staffRanking から）
  const knownNames = new Set(staffRanking.map(s => s.name.split(/\s/)[0]))

  const metrics: StaffBehaviorMetrics[] = []

  for (const [staffName, cs] of Object.entries(groups)) {
    if (cs.length === 0) continue

    const totalSales      = cs.reduce((s, c) => s + c.totalSpent, 0)
    const nextReserveRate = Math.round(cs.filter(c => c.hasNextRebook).length / cs.length * 100)
    const repeatRate      = Math.round(cs.filter(c => c.visitCount >= 3).length / cs.length * 100)
    const vipRate         = Math.round(cs.filter(c => c.isVip).length / cs.length * 100)
    const lineResponseAvg = Math.round(cs.reduce((s, c) => s + c.lineResponseRate, 0) / cs.length)
    const churnRiskAvg    = Math.round(cs.reduce((s, c) => s + c.churnRisk, 0) / cs.length)
    const treatmentVariety = new Set(cs.flatMap(c => c.treatments)).size

    metrics.push({
      staffName, totalSales, nextReserveRate, repeatRate,
      vipRate, lineResponseAvg, churnRiskAvg,
      customerCount: cs.length, treatmentVariety,
    })
  }

  // staffRanking から今日の売上で補完（groupsに含まれなかったスタッフ）
  for (const item of staffRanking) {
    const shortName = item.name.split(/\s/)[0]
    if (!metrics.find(m => m.staffName === shortName || item.name.includes(m.staffName))) {
      metrics.push({
        staffName:        shortName,
        totalSales:       item.todaySales,
        nextReserveRate:  Math.round((item.nextReserveCount / Math.max(item.todaySales / 14000, 1)) * 100),
        repeatRate:       60,   // デフォルト
        vipRate:          15,   // デフォルト
        lineResponseAvg:  60,
        churnRiskAvg:     25,
        customerCount:    Math.round(item.todaySales / 14000),
        treatmentVariety: 2,
      })
    }
  }

  // 総売上降順でソート
  return metrics.sort((a, b) => b.totalSales - a.totalSales)
}

// ─── 成功パターン抽出ロジック ─────────────────────────────────────────────────

const METRIC_CONFIGS: Array<{
  key:       keyof StaffBehaviorMetrics
  label:     string
  threshold: number    // トップ vs ボトムの差がこれ以上なら pattern 生成
  impactFn:  (diff: number, avgSpend: number, visits: number) => number
  actionFn:  (topName: string, metric: number) => string
  evidenceFn:(top: StaffBehaviorMetrics, bot: StaffBehaviorMetrics) => string[]
}> = [
  {
    key: 'nextReserveRate', label: '次回予約取得率', threshold: 15,
    impactFn: (d, spend, v) => Math.round((d / 100) * v * spend),
    actionFn: (n) => `${n}のように施術終了10分前に「次回はいつ頃にしましょうか」と自然に提案する。`,
    evidenceFn: (t, b) => [
      `${t.staffName}担当の次回予約率 ${t.nextReserveRate}%（${b.staffName}より${t.nextReserveRate - b.nextReserveRate}%高い）`,
      `${t.staffName}担当顧客の VIP 比率が${t.vipRate - b.vipRate}%高い`,
      `${t.staffName}の施術種類数が${t.treatmentVariety}種（提案幅が広い）`,
    ],
  },
  {
    key: 'vipRate', label: 'VIP育成率', threshold: 10,
    impactFn: (d, spend, v) => Math.round((d / 100) * v * spend * 1.5),
    actionFn: (n) => `${n}のようにリピーター顧客に上位コースを段階的に提案する。`,
    evidenceFn: (t, b) => [
      `${t.staffName}担当の VIP 比率 ${t.vipRate}%（${b.staffName}より${t.vipRate - b.vipRate}%高い）`,
      `${t.staffName}担当顧客の平均 LINE 返信率 ${t.lineResponseAvg}%`,
      `担当顧客の平均離脱リスクが${b.churnRiskAvg - t.churnRiskAvg}%低い`,
    ],
  },
  {
    key: 'lineResponseAvg', label: 'LINE返信率', threshold: 15,
    impactFn: (d, spend, v) => Math.round((d / 100) * v * spend * 0.6),
    actionFn: (n) => `${n}のようにメッセージをキャンペーン文ではなく美容アドバイス中心に変える。`,
    evidenceFn: (t, b) => [
      `${t.staffName}担当顧客の LINE 返信率 ${t.lineResponseAvg}%（${b.staffName}より${t.lineResponseAvg - b.lineResponseAvg}%高い）`,
      `${t.staffName}担当顧客の来店間隔が安定している`,
    ],
  },
  {
    key: 'repeatRate', label: 'リピート率', threshold: 12,
    impactFn: (d, spend, v) => Math.round((d / 100) * v * spend),
    actionFn: (n) => `${n}のように初回来店後7日以内にフォロー連絡を入れる。`,
    evidenceFn: (t, b) => [
      `${t.staffName}担当のリピート率 ${t.repeatRate}%（${b.staffName}より${t.repeatRate - b.repeatRate}%高い）`,
      `${t.staffName}担当顧客の平均来店回数が多い`,
    ],
  },
]

// ─── メイン分析関数 ───────────────────────────────────────────────────────────

export function analyzeSuccessPatterns(
  customers:    CustomerRow[],
  staffRanking: StaffRankItem[],
  avgSpend     = 14000,
  monthlyVisits = 30,
  demoMode     = false,
): SuccessPatternResult {
  // DEMO_MODE かつ customers にスタッフデータが薄い場合はモックを返す
  if (demoMode || customers.filter(c => c.staffName).length < 2) {
    const metrics = calcStaffMetrics(customers, staffRanking)
    return {
      patterns:     DEMO_PATTERNS,
      topStaff:     metrics[0] ?? null,
      staffMetrics: metrics,
      generatedAt:  new Date().toISOString(),
    }
  }

  const metrics  = calcStaffMetrics(customers, staffRanking)
  if (metrics.length < 2) {
    return { patterns: [], topStaff: metrics[0] ?? null, staffMetrics: metrics, generatedAt: new Date().toISOString() }
  }

  const patterns: SuccessPattern[] = []

  for (const cfg of METRIC_CONFIGS) {
    const sorted = [...metrics].sort((a, b) => {
      const av = a[cfg.key] as number
      const bv = b[cfg.key] as number
      return bv - av
    })
    const top = sorted[0]
    const bot = sorted[sorted.length - 1]
    const diff = (top[cfg.key] as number) - (bot[cfg.key] as number)

    if (diff < cfg.threshold) continue

    const score  = Math.min(100, Math.round((diff / cfg.threshold) * 50))
    const impact = cfg.impactFn(diff, avgSpend, monthlyVisits)

    patterns.push({
      title:          `${cfg.label}の差分（${top.staffName} vs ${bot.staffName}）`,
      metric:         String(cfg.key),
      score,
      topStaff:       top.staffName,
      topValue:       top[cfg.key] as number,
      bottomStaff:    bot.staffName,
      bottomValue:    bot[cfg.key] as number,
      diffValue:      diff,
      evidence:       cfg.evidenceFn(top, bot),
      action:         cfg.actionFn(top.staffName, top[cfg.key] as number),
      expectedImpact: impact,
    })
  }

  // スコア降順でソート
  patterns.sort((a, b) => b.score - a.score)

  return {
    patterns,
    topStaff:     metrics[0] ?? null,
    staffMetrics: metrics,
    generatedAt:  new Date().toISOString(),
  }
}
