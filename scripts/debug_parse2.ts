import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { parseSalonBoardDetailCsv } from '../src/lib/import/salonBoardDetailParser'
import { sanitizeResidualPii } from '../src/lib/import/piiSanitizer'

async function main() {
  const buf = readFileSync('C:/Users/user/Desktop/サロンボード/売上明細_20260619145911.csv')
  const csvText = decodeCsvBuffer(buf)
  const parsed = parseSalonBoardDetailCsv(csvText)
  const rows = parsed.rows.map(r => sanitizeResidualPii(r).clean)

  const targets = ['RB000550427520', 'RB000550587383']
  for (const id of targets) {
    console.log(`\n=== checkout ${id} ===`)
    rows.filter(r => r.checkoutId === id).forEach(r => {
      console.log(JSON.stringify({
        category: r.category,
        itemName: r.itemName,
        staffNameRaw: r.staffNameRaw,
        amount: r.amount,
        quantity: r.quantity,
      }))
    })
  }

  const categoryCounts = new Map<string, number>()
  rows.forEach(r => categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1))
  console.log('\n=== 区分(category)の出現分布 ===')
  console.log(JSON.stringify(Object.fromEntries(categoryCounts), null, 2))
}

main()
