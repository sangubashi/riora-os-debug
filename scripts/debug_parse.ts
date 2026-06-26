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
  console.log('parsed.issues count:', parsed.issues.length)
  console.log('parsed.issues sample:', JSON.stringify(parsed.issues.slice(0, 10), null, 2))
  console.log('parsed.rows count:', parsed.rows.length)
  console.log('parsed.totalLines:', parsed.totalLines)

  const sanitizedRows = parsed.rows.map(r => sanitizeResidualPii(r).clean)
  const { aggregates, issues } = aggregateCheckouts(sanitizedRows)
  console.log('aggregates.length:', aggregates.length)
  console.log('agg issues count:', issues.length)
  console.log('agg issues sample:', JSON.stringify(issues.slice(0, 10), null, 2))
}

main()
