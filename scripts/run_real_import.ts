import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { runImportPipeline } from '../src/lib/import/csvImportPipeline'
import { getRepos } from '../app/lib/repos'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const FILE_PATH = 'C:/Users/user/Desktop/サロンボード/売上明細_20260619145911.csv'

async function main() {
  const buf = readFileSync(FILE_PATH)
  const csvText = decodeCsvBuffer(buf)
  const repos = getRepos()

  const result = await runImportPipeline({ storeId: STORE_ID, csvText, reviewDecisions: {} }, repos)

  if (!result.ok) {
    console.log('IMPORT FAILED:', result.code, result.message)
    process.exit(1)
  }

  console.log('=== 本番Import結果 ===')
  console.log(JSON.stringify(result.report, null, 2))
}

main()
