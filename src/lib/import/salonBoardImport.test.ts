/**
 * salonBoardImport.test.ts  — 動作確認用テスト
 *
 * npm run dev 環境で手動実行可能。
 * Jest は不要 — 純粋に関数をインポートして確認する。
 */

import { runSalonBoardImport, summarizeImport } from './SalonBoardImportEngine'

// ─── ダミー CSV ───────────────────────────────────────────────────────────────

export const DEMO_SALONBOARD_CSV = `顧客名,来店日,売上,施術,店販,担当,次回予約,指名,年齢,電話番号,メールアドレス
田中 美咲,2025/05/19,18000,プレミアムエイジングケア,3000,鈴木,あり,あり,30代,090-XXXX-XXXX,xxx@example.com
田中 美咲,2025/04/21,18000,プレミアムエイジングケア,0,鈴木,あり,あり,30代,,
高橋 ゆり,2025/05/15,15000,ハーブピーリング,0,亀山,なし,なし,40代,,
高橋 ゆり,2025/04/18,15000,ハーブピーリング,0,亀山,あり,なし,40代,,
佐藤 花子,2025/05/20,12000,モイスチャーフェイシャル,2500,外舘,あり,なし,20代,,
佐藤 花子,2025/03/10,12000,モイスチャーフェイシャル,0,外舘,なし,なし,20代,,
山田 幸子,2025/05/08,20000,プレミアムエイジングケア,5000,鈴木,あり,あり,50代,,
`

// ─── 確認関数（手動実行用） ───────────────────────────────────────────────────

export function runDemoImport() {
  console.log('=== SalonBoard CSV 取込テスト ===')

  const result  = runSalonBoardImport(DEMO_SALONBOARD_CSV)
  const summary = summarizeImport(result)

  console.log(`\n取込結果: ${result.customers.length}名 / ${result.totalRows}行`)
  console.log(`スキップ: ${result.skippedRows}行`)
  console.log(`エラー:   ${result.errors.join(' | ')}`)
  console.log(`\n--- 顧客一覧 ---`)
  result.customers.forEach(c => {
    console.log(`  ${c.displayName}  来店${c.visits}回  ¥${c.totalSales.toLocaleString()}  Phase:${c.phase}  Score:${c.score}`)
  })

  console.log(`\n--- KPI サマリ ---`)
  console.log(`  総顧客数:     ${summary.totalCustomers}名`)
  console.log(`  総売上:       ¥${summary.totalSales.toLocaleString()}`)
  console.log(`  平均売上/人:  ¥${summary.avgSalesPerCustomer.toLocaleString()}`)
  console.log(`  VIP:          ${summary.vipCount}名`)
  console.log(`  離脱危険:     ${summary.riskCount}名`)
  console.log(`  次回予約率:   ${summary.rebookRate}%`)
  console.log(`  人気施術:     ${summary.topTreatments.join(' / ')}`)
  console.log(`  フェーズ内訳: `, summary.phaseBreakdown)

  return result
}
