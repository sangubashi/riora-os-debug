'use client'
/**
 * IPhoneDiagPanel.tsx
 * iPhone Safari 実機診断パネル。大きく・コピーしやすいレイアウト。
 */
import { useState, useEffect, useCallback } from 'react'

interface DiagRow { label: string; value: string; status: 'ok' | 'warn' | 'info' }

function getSafeArea(): { top: string; bottom: string; left: string; right: string } {
  const tmp = document.createElement('div')
  tmp.style.cssText = [
    'position:fixed;opacity:0;pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'width:0;height:0',
  ].join(';')
  document.body.appendChild(tmp)
  const cs = getComputedStyle(tmp)
  const result = {
    top:    cs.paddingTop    || '0px',
    bottom: cs.paddingBottom || '0px',
    left:   cs.paddingLeft   || '0px',
    right:  cs.paddingRight  || '0px',
  }
  document.body.removeChild(tmp)
  return result
}

export default function IPhoneDiagPanel() {
  const [rows, setRows]       = useState<DiagRow[]>([])
  const [copied, setCopied]   = useState(false)
  const [ts, setTs]           = useState('')

  const collect = useCallback(() => {
    const vvH  = window.visualViewport?.height  ?? 0
    const vvW  = window.visualViewport?.width   ?? 0
    const vvOT = window.visualViewport?.offsetTop ?? 0
    const iH   = window.innerHeight
    const iW   = window.innerWidth
    const cH   = document.documentElement.clientHeight
    const sa   = getSafeArea()
    const sabPx = parseFloat(sa.bottom) || 0

    const next: DiagRow[] = [
      // ── 画面サイズ ──
      { label: 'window.innerHeight',              value: `${iH}px`,  status: 'info' },
      { label: 'window.innerWidth',               value: `${iW}px`,  status: 'info' },
      { label: 'clientHeight (de)',               value: `${cH}px`,  status: 'info' },
      { label: 'visualViewport.height',           value: vvH  ? `${Math.round(vvH)}px`  : 'N/A', status: vvH && vvH < iH - 10 ? 'warn' : 'ok' },
      { label: 'visualViewport.width',            value: vvW  ? `${Math.round(vvW)}px`  : 'N/A', status: 'info' },
      { label: 'visualViewport.offsetTop',        value: vvOT ? `${Math.round(vvOT)}px` : '0px', status: vvOT > 0 ? 'warn' : 'ok' },
      { label: 'devicePixelRatio',                value: String(window.devicePixelRatio), status: 'info' },
      // ── safe-area ──
      { label: 'safe-area-inset-top',             value: sa.top,    status: sa.top    === '0px' ? 'warn' : 'ok' },
      { label: 'safe-area-inset-bottom ★',        value: sa.bottom, status: sabPx > 0 ? 'ok' : 'warn' },
      { label: 'safe-area-inset-left',            value: sa.left,   status: 'info' },
      { label: 'safe-area-inset-right',           value: sa.right,  status: 'info' },
      // ── BottomSheet 計算値 ──
      { label: 'BottomSheet 88% (--vh計算)',       value: `${Math.round((vvH || iH) * 0.88 - sabPx)}px`, status: 'info' },
      { label: 'BottomSheet 88dvh',               value: `${Math.round(iH * 0.88)}px`,  status: 'info' },
      // ── UA ──
      { label: 'User Agent',                      value: navigator.userAgent.slice(0, 60), status: 'info' },
    ]
    setRows(next)
    setTs(new Date().toLocaleTimeString('ja-JP'))
  }, [])

  useEffect(() => {
    collect()
    window.addEventListener('resize', collect)
    window.visualViewport?.addEventListener('resize', collect)
    window.visualViewport?.addEventListener('scroll', collect)
    return () => {
      window.removeEventListener('resize', collect)
      window.visualViewport?.removeEventListener('resize', collect)
      window.visualViewport?.removeEventListener('scroll', collect)
    }
  }, [collect])

  const copyAll = useCallback(() => {
    const text = `Riora iPhone診断 ${ts}\n` + rows.map(r => `${r.label}: ${r.value}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }, [rows, ts])

  const STATUS_COLOR = { ok: '#15803d', warn: '#b91c1c', info: '#4878A8' }
  const STATUS_BG    = { ok: '#F0FFF4', warn: '#FFF0F0', info: '#F0F8FF' }

  return (
    <div style={{ marginTop: '16px' }}>
      {/* タイトルバー */}
      <div style={{
        background: '#1a1a2e', color: '#fff',
        borderRadius: '14px 14px 0 0', padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 700 }}>📱 iPhone 実機診断</p>
          <p style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>更新: {ts}</p>
        </div>
        <button onClick={copyAll} style={{
          fontSize: '11px', padding: '6px 14px', borderRadius: '999px',
          border: '1px solid #F56E8B',
          background: copied ? '#F56E8B' : 'transparent',
          color: copied ? '#fff' : '#F56E8B', cursor: 'pointer', fontWeight: 600,
        }}>
          {copied ? '✓ コピー済み' : '全コピー'}
        </button>
      </div>

      {/* 診断行 */}
      <div style={{ border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 12px',
            background: i % 2 === 0 ? '#fff' : '#FAFAFA',
            borderBottom: i < rows.length - 1 ? '1px solid #f0f0f0' : 'none',
          }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, padding: '2px 6px',
              borderRadius: '4px', flexShrink: 0,
              background: STATUS_BG[r.status],
              color: STATUS_COLOR[r.status],
            }}>
              {r.status === 'warn' ? '⚠' : r.status === 'ok' ? '✓' : 'i'}
            </span>
            <span style={{ fontSize: '11px', color: '#666', flex: 1 }}>{r.label}</span>
            <span style={{
              fontSize: '12px', fontWeight: 700,
              color: STATUS_COLOR[r.status],
              fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right',
            }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: '9px', color: '#C8A8B0', textAlign: 'center', marginTop: '6px' }}>
        リサイズ・スクロールで自動更新 ／ ⚠ = 要確認
      </p>
    </div>
  )
}
