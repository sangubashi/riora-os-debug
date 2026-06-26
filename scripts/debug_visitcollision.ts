import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { parseSalonBoardDetailCsv, aggregateCheckouts } from '../src/lib/import/salonBoardDetailParser'
import { sanitizeResidualPii } from '../src/lib/import/piiSanitizer'
import { normalizeCustomerName } from '../src/lib/import/normalizer'

async function main() {
  const buf = readFileSync('C:/Users/user/Desktop/サロンボード/売上明細_20260619145911.csv')
  const csvText = decodeCsvBuffer(buf)
  const parsed = parseSalonBoardDetailCsv(csvText)
  const rows = parsed.rows.map(r => sanitizeResidualPii(r).clean)
  const { aggregates } = aggregateCheckouts(rows)

  console.log('total aggregates:', aggregates.length)
  const byName = new Map<string, number>()
  aggregates.forEach(a => byName.set(a.customerName, (byName.get(a.customerName) ?? 0) + 1))
  console.log('distinct customerName count:', byName.size)

  const byNameDate = new Map<string, string[]>()
  aggregates.forEach(a => {
    const date = a.visitDateTime.slice(0, 10)
    const key = `${a.customerName}__${date}`
    const arr = byNameDate.get(key) ?? []
    arr.push(a.checkoutId)
    byNameDate.set(key, arr)
  })
  let collisions = 0
  byNameDate.forEach((ids, key) => {
    if (ids.length > 1) {
      collisions += 1
      console.log('COLLISION', key, ids)
    }
  })
  console.log('distinct (name,date) pairs:', byNameDate.size, 'collisions:', collisions)
}
main()
