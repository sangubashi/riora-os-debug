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

  const byCheckout = new Map<string, typeof rows>()
  rows.forEach(r => {
    const g = byCheckout.get(r.checkoutId) ?? []
    g.push(r)
    byCheckout.set(r.checkoutId, g)
  })

  let zeroShijutsu = 0
  let multiStaffAfterBlankIgnore = 0
  byCheckout.forEach((lines, id) => {
    const shijutsuCount = lines.filter(l => l.category === '施術').length
    if (shijutsuCount === 0) {
      zeroShijutsu += 1
      console.log('ZERO 施術:', id, JSON.stringify(lines.map(l => ({ category: l.category, amount: l.amount }))))
    }
    const nonBlankStaffs = new Set(lines.map(l => l.staffNameRaw).filter(s => s !== ''))
    if (nonBlankStaffs.size > 1) {
      multiStaffAfterBlankIgnore += 1
      console.log('MULTI non-blank staff:', id, Array.from(nonBlankStaffs))
    }
  })
  console.log(`\n総checkout数: ${byCheckout.size}`)
  console.log(`施術行が0件のcheckout数: ${zeroShijutsu}`)
  console.log(`空欄除外後も複数staffのcheckout数: ${multiStaffAfterBlankIgnore}`)
}

main()
