/**
 * /test — Supabase 接続診断ダッシュボード
 *
 * Server Component: サーバーサイドで直接 Supabase に接続して診断する。
 * - クライアント JS 不要（useEffect・タイムアウト問題なし）
 * - Vercel 本番環境で ENV が正しく設定されているか即座に確認できる
 * - iPhone Safari でもシンプルに表示される
 * - 認証・Zustand・ClientShell を一切使わない
 */

import { createClient } from '@supabase/supabase-js'
import IPhoneDiagPanel from '@/components/test/IPhoneDiagPanel'
import LineTestButton from '@/components/test/LineTestButton'

// ─── 型 ──────────────────────────────────────────────────────────────────────

type CheckResult =
  | { status: 'ok';      value: string; detail?: string }
  | { status: 'warn';    value: string; detail?: string }
  | { status: 'error';   value: string; detail?: string }

interface TableResult {
  table:  string
  status: 'ok' | 'error'
  count:  number | null
  sample: string | null
  error:  string | null
  ms:     number
}

// ─── サーバーサイド診断ロジック ─────────────────────────────────────────────

async function runDiagnostics() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  // 1. ENV チェック
  const envChecks: { label: string; result: CheckResult }[] = [
    {
      label: 'NEXT_PUBLIC_SUPABASE_URL',
      result: url.startsWith('https://')
        ? { status: 'ok',   value: maskUrl(url) }
        : url === ''
          ? { status: 'error', value: '未設定 — Vercel の Environment Variables を確認してください' }
          : { status: 'error', value: `不正な形式: ${url.slice(0, 30)}...` },
    },
    {
      label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      result: key.startsWith('eyJ')
        ? { status: 'ok',   value: `✅ JWT形式 (${key.slice(0, 20)}...)` }
        : key.startsWith('sb_publishable')
          ? { status: 'error', value: '❌ 古い形式 (sb_publishable_...) — Supabase Dashboard > Settings > API > anon public から JWT キーを再取得してください' }
          : key === ''
            ? { status: 'error', value: '❌ 未設定' }
            : { status: 'error', value: `❌ 不正な形式: ${key.slice(0, 20)}...` },
    },
  ]

  const envOk = envChecks.every(c => c.result.status === 'ok')

  // 2. テーブル接続チェック
  const tableResults: TableResult[] = []

  if (envOk) {
    const sb = createClient(url, key)

    const tables: Array<{
      name: string
      columns: string
      sampleCols?: string[]
    }> = [
      { name: 'reservations', columns: 'id, menu, scheduled_at, status', sampleCols: ['menu', 'scheduled_at', 'status'] },
      { name: 'customers',    columns: 'id, name, customer_type, is_vip', sampleCols: ['name', 'customer_type'] },
      { name: 'profiles',     columns: 'id, role', sampleCols: ['role'] },
    ]

    for (const t of tables) {
      const t0 = Date.now()
      try {
        const { data, error, count } = await sb
          .from(t.name)
          .select(t.columns, { count: 'exact' })
          .limit(1)

        const ms = Date.now() - t0

        if (error) {
          tableResults.push({
            table:  t.name,
            status: 'error',
            count:  null,
            sample: null,
            error:  `${error.code}: ${error.message}`,
            ms,
          })
        } else {
          const sampleRow = data?.[0]
            ? Object.fromEntries(
                Object.entries(data[0])
                  .filter(([k]) => (t.sampleCols ?? []).includes(k))
              )
            : null

          tableResults.push({
            table:  t.name,
            status: 'ok',
            count:  count ?? data?.length ?? 0,
            sample: sampleRow ? JSON.stringify(sampleRow) : null,
            error:  null,
            ms,
          })
        }
      } catch (e) {
        tableResults.push({
          table:  t.name,
          status: 'error',
          count:  null,
          sample: null,
          error:  String(e),
          ms:     Date.now() - t0,
        })
      }
    }
  }

  return { envChecks, envOk, tableResults, url, key, now }
}

// ─── URL マスク ──────────────────────────────────────────────────────────────

function maskUrl(url: string): string {
  // https://abcdefghij.supabase.co → https://abc***hij.supabase.co
  try {
    const u = new URL(url)
    const host = u.hostname // abcdefghij.supabase.co
    const parts = host.split('.')
    const proj = parts[0]
    const masked = proj.length > 6
      ? proj.slice(0, 3) + '***' + proj.slice(-3)
      : proj.slice(0, 2) + '***'
    return `${u.protocol}//${masked}.${parts.slice(1).join('.')}`
  } catch {
    return url.slice(0, 20) + '...'
  }
}

// ─── UI コンポーネント ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const map = {
    ok:    { bg: '#dcfce7', color: '#15803d', text: '✅ OK' },
    warn:  { bg: '#fef9c3', color: '#854d0e', text: '⚠️ 注意' },
    error: { bg: '#fee2e2', color: '#b91c1c', text: '❌ エラー' },
  }
  const s = map[status]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '999px',
      background: s.bg,
      color: s.color,
      fontSize: '11px',
      fontWeight: 600,
    }}>
      {s.text}
    </span>
  )
}

// ─── メインコンポーネント（Server Component） ────────────────────────────────

export default async function TestPage() {
  const { envChecks, envOk, tableResults, now } = await runDiagnostics()

  const allOk = envOk && tableResults.every(r => r.status === 'ok')

  return (
    <div style={{
      fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      background: '#FBF3F5',
      minHeight: '100dvh',
      padding: '0 0 60px',
    }}>

      {/* ヘッダー */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #F0E4E8',
        padding: '20px 20px 16px',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <p style={{ fontSize: '10px', letterSpacing: '0.25em', color: '#C8A8B0', marginBottom: '4px' }}>
          SALON RIORA
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#3d2218' }}>
            接続診断
          </h1>
          <StatusBadge status={allOk ? 'ok' : 'error'} />
        </div>
        <p style={{ fontSize: '11px', color: '#9E8090', marginTop: '4px' }}>
          {now} 時点
        </p>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* ─── ENV セクション ─── */}
        <Card title="🔑 環境変数" status={envOk ? 'ok' : 'error'}>
          {envChecks.map(({ label, result }) => (
            <EnvRow key={label} label={label} result={result} />
          ))}
          {!envOk && (
            <div style={{
              marginTop: '12px',
              padding: '10px 12px',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              borderRadius: '10px',
              fontSize: '12px',
              color: '#9a3412',
              lineHeight: 1.7,
            }}>
              <strong>修正手順:</strong><br />
              1. Vercel Dashboard → プロジェクト → Settings → Environment Variables<br />
              2. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定<br />
              3. Supabase: Settings → API → anon public の <code>eyJ...</code> キーを使用<br />
              4. 設定後に Redeploy
            </div>
          )}
        </Card>

        {/* ─── DB テーブルセクション ─── */}
        <Card
          title="🗄️ Supabase テーブル接続"
          status={!envOk ? 'warn' : tableResults.every(r => r.status === 'ok') ? 'ok' : 'error'}
        >
          {!envOk ? (
            <p style={{ fontSize: '12px', color: '#9E8090' }}>
              ⚠️ ENV が正しく設定されていないため接続テストをスキップしました
            </p>
          ) : (
            tableResults.map(r => (
              <TableRow key={r.table} result={r} />
            ))
          )}
        </Card>

        {/* ─── 総合判定 ─── */}
        <Card title="📋 総合診断" status={allOk ? 'ok' : 'error'}>
          {allOk ? (
            <div style={{ fontSize: '14px', color: '#15803d', fontWeight: 600, lineHeight: 2 }}>
              ✅ Supabase への接続は正常です。<br />
              <span style={{ fontSize: '12px', fontWeight: 400, color: '#3d2218' }}>
                /phase1 にアクセスして本番動作を確認してください。
              </span>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#b91c1c', lineHeight: 2 }}>
              ❌ 問題が検出されました。<br />
              <span style={{ color: '#3d2218' }}>
                上記のエラー内容を確認し、Vercel の Environment Variables を修正してください。
              </span>
            </div>
          )}
        </Card>

        {/* ─── 次のアクション ─── */}
        <div style={{
          background: '#F8F1F3',
          borderRadius: '14px',
          padding: '14px 16px',
          fontSize: '12px',
          color: '#5C4033',
          lineHeight: 1.9,
        }}>
          <p style={{ fontWeight: 600, marginBottom: '6px', color: '#3d2218' }}>📌 次のアクション</p>
          <p>✅ このページが全 OK → <strong>/login</strong> でログインして <strong>/phase1</strong> へ</p>
          <p>❌ ENV エラー → Vercel Dashboard で環境変数を再設定して Redeploy</p>
          <p>❌ テーブルエラー → Supabase SQL Editor で migration SQL を実行</p>
        </div>

        {/* ─── LINE 送信テスト ─── */}
        <Card title="📨 LINE 送信テスト" status="ok">
          <p style={{ fontSize: '12px', color: '#9E8090', marginBottom: '4px' }}>
            ENV の LINE_TEST_USER_ID 宛にテストメッセージを送信し、line_send_logs に記録します。
          </p>
          <LineTestButton />
        </Card>

        {/* ─── iPhone 実機診断（Client Component） ─── */}
        <IPhoneDiagPanel />

      </div>
    </div>
  )
}

// ─── サブコンポーネント ───────────────────────────────────────────────────────

function Card({
  title, status, children,
}: {
  title: string
  status: 'ok' | 'warn' | 'error'
  children: React.ReactNode
}) {
  const borderColor = status === 'ok' ? '#86efac' : status === 'warn' ? '#fde68a' : '#fca5a5'
  return (
    <div style={{
      background: '#fff',
      border: `1px solid #F0E4E8`,
      borderRadius: '18px',
      overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(200,120,140,0.08)',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #F5ECF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderLeft: `4px solid ${borderColor}`,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#3d2218' }}>{title}</span>
        <StatusBadge status={status} />
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {children}
      </div>
    </div>
  )
}

function EnvRow({ label, result }: { label: string; result: CheckResult }) {
  const color = result.status === 'ok' ? '#15803d' : result.status === 'warn' ? '#854d0e' : '#b91c1c'
  const bg    = result.status === 'ok' ? '#f0fdf4' : result.status === 'warn' ? '#fefce8' : '#fef2f2'
  return (
    <div style={{
      background: bg,
      borderRadius: '10px',
      padding: '10px 12px',
    }}>
      <p style={{ fontSize: '10px', color: '#9E8090', letterSpacing: '0.04em', marginBottom: '4px', fontFamily: 'monospace' }}>
        {label}
      </p>
      <p style={{ fontSize: '12px', color, fontWeight: 500, wordBreak: 'break-all', lineHeight: 1.5 }}>
        {result.value}
      </p>
      {result.detail && (
        <p style={{ fontSize: '11px', color: '#9E8090', marginTop: '4px' }}>{result.detail}</p>
      )}
    </div>
  )
}

function TableRow({ result }: { result: TableResult }) {
  const ok = result.status === 'ok'
  return (
    <div style={{
      background: ok ? '#f0fdf4' : '#fef2f2',
      borderRadius: '10px',
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#3d2218', fontFamily: 'monospace' }}>
          {result.table}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#9E8090' }}>{result.ms}ms</span>
          <StatusBadge status={ok ? 'ok' : 'error'} />
        </div>
      </div>
      {ok ? (
        <>
          <p style={{ fontSize: '12px', color: '#15803d' }}>
            {result.count !== null ? `${result.count} 件` : '取得成功'}
          </p>
          {result.sample && (
            <pre style={{
              fontSize: '10px', color: '#5C4033',
              background: 'rgba(0,0,0,0.03)',
              padding: '6px 8px', borderRadius: '6px',
              marginTop: '5px', overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {result.sample}
            </pre>
          )}
          {result.count === 0 && (
            <p style={{ fontSize: '11px', color: '#9E8090', marginTop: '3px' }}>
              ※ テーブルは存在しますがデータが0件です
            </p>
          )}
        </>
      ) : (
        <p style={{ fontSize: '11px', color: '#b91c1c', wordBreak: 'break-all', lineHeight: 1.6 }}>
          {result.error}
        </p>
      )}
    </div>
  )
}
