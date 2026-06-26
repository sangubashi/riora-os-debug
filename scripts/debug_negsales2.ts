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

  const targets = ['RB000553802997', 'RB000554487003']
  for (const id of targets) {
    console.log(`\n=== ${id} ===`)
    rows.filter(r => r.checkoutId === id).forEach(r => {
      console.log(JSON.stringify({ category: r.category, itemName: r.itemName, amount: r.amount }))
    })
  }
}
main()
