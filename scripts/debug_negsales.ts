import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { parseSalonBoardDetailCsv, aggregateCheckouts } from '../src/lib/import/salonBoardDetailParser'
import { sanitizeResidualPii } from '../src/lib/import/piiSanitizer'

async function main() {
  const buf = readFileSync('C:/Users/user/Desktop/サロンボード/売上明細_20260619145911.csv')
  const csvText = decodeCsvBuffer(buf)
  const parsed = parseSalonBoardDetailCsv(csvText)
  const rows = parsed.rows.map(r => sanitizeResidualPii(r).clean)
  const { aggregates } = aggregateCheckouts(rows)

  let negCount = 0
  aggregates.forEach(a => {
    if (a.netServiceSales < 0) {
      negCount += 1
      console.log(a.checkoutId, 'netServiceSales=', a.netServiceSales, 'retailSales=', a.retailSales, 'discountTotal=', a.discountTotal)
    }
  })
  console.log('total aggregates:', aggregates.length, 'negative netServiceSales count:', negCount)
}
main()
