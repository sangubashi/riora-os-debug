'use client'
/**
 * ProductAnalyticsPanel.tsx  — 成功商品分析パネル
 * KPI画面に差し込む。商品ごとの売上・VIP率・次回予約率をランキング表示。
 */
import { memo, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { calcProductAnalytics, DEMO_PRODUCT_ROWS } from '@/lib/analytics/productAnalytics'
import type { ProductStats } from '@/types'

type TabKey = 'sales' | 'vip' | 'rebook'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'sales',  label: '売上'      },
  { key: 'vip',    label: 'VIP率'     },
  { key: 'rebook', label: '次回予約率' },
]

function formatYen(n: number): string {
  if (n >= 10000) return `¥${Math.round(n / 10000)}万`
  return `¥${n.toLocaleString()}`
}

function ProductRankingRowInner({ item, rank, valueKey, maxValue }: {
  item: ProductStats
  rank: number
  valueKey: 'totalRevenue' | 'vipRate' | 'rebookRate'
  maxValue: number
}) {
  const raw     = item[valueKey] as number
  const display = valueKey === 'totalRevenue' ? formatYen(raw) : `${raw}%`
  const pct     = maxValue > 0 ? Math.round(raw / maxValue * 100) : 0
  const barColor = rank === 1 ? '#F56E8B' : rank === 2 ? '#FF8FA3' : '#C8A8B0'

  return (
    <div style={{ display:'flex', alignItems:'center', gap:'10px',
      padding:'8px 0', borderBottom:'1px solid #F5EEF0' }}>
      <span style={{ fontSize:'12px', fontWeight:700, minWidth:'18px',
        color: rank<=3 ? ['#FFD166','#C8C8C8','#CD7F32'][rank-1] : '#E8D8D0',
        fontFamily:'Inter, sans-serif', textAlign:'center' }}>
        {rank}
      </span>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:'11px', color:'#5C4033', fontWeight:600,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {item.name}
        </p>
        <div style={{ background:'#F5EEF0', borderRadius:'3px', height:'4px',
          overflow:'hidden', marginTop:'4px' }}>
          <div style={{ background: barColor, width:`${pct}%`, height:'100%',
            borderRadius:'3px', transition:'width 0.5s ease' }} />
        </div>
      </div>
      <span style={{ fontSize:'12px', fontWeight:700, color:'#5C4033',
        minWidth:'52px', textAlign:'right', fontFamily:'Inter, sans-serif' }}>
        {display}
      </span>
      <span style={{ fontSize:'10px', color:'#C8A8B0', minWidth:'24px' }}>
        {item.buyerCount}名
      </span>
    </div>
  )
}

const RankingRow = memo(ProductRankingRowInner)
RankingRow.displayName = 'ProductRankingRow'

function ProductAnalyticsPanel() {
  const [tab, setTab] = useState<TabKey>('sales')
  const result = useMemo(() => calcProductAnalytics(DEMO_PRODUCT_ROWS), [])

  type RankKey = 'totalRevenue' | 'vipRate' | 'rebookRate'
  const rankingMap: Record<TabKey, { list: ProductStats[]; key: RankKey }> = {
    sales:  { list: result.salesRanking,  key: 'totalRevenue' },
    vip:    { list: result.vipRanking,    key: 'vipRate'      },
    rebook: { list: result.rebookRanking, key: 'rebookRate'   },
  }
  const current  = rankingMap[tab]
  const maxValue = current.list.length > 0 ? current.list[0][current.key] as number : 1

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>

      {/* タイトル */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'4px' }}>
        <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, letterSpacing:'0.1em' }}>
          🛍 商品別分析
        </p>
        <span style={{ fontSize:'9px', background:'#FFF0F4', color:'#F56E8B',
          padding:'1px 6px', borderRadius:'999px', border:'1px solid #FCCDD8' }}>
          {result.totalBuyers}名分析
        </span>
      </div>

      {/* ランキングカード */}
      <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>

        {/* タブ */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'12px' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                fontSize:'11px', padding:'4px 12px', borderRadius:'999px',
                border:`1px solid ${tab===t.key ? '#F56E8B' : '#F0E8E8'}`,
                background: tab===t.key ? 'rgba(245,110,139,0.08)' : 'transparent',
                color: tab===t.key ? '#F56E8B' : '#C8A8B0',
                fontWeight: tab===t.key ? 600 : 400,
                cursor:'pointer', transition:'all 0.15s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, y:-4 }} transition={{ duration:0.15 }}>
            {current.list.map((item, i) => (
              <RankingRow key={item.name} item={item} rank={i+1}
                valueKey={current.key} maxValue={maxValue} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* AIインサイト */}
      {result.insights.length > 0 && (
        <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>
          <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, marginBottom:'10px' }}>
            💡 商品インサイト
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
            {result.insights.map((msg, i) => (
              <motion.div key={i}
                initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
                transition={{ delay: i * 0.06 }}
                style={{ display:'flex', alignItems:'flex-start', gap:'8px',
                  padding:'7px 10px', background:'#FFF8F7',
                  borderRadius:'10px', border:'1px solid #F5EEF0' }}>
                <span style={{ fontSize:'12px', flexShrink:0 }}>✨</span>
                <p style={{ fontSize:'12px', color:'#5C4033', lineHeight:1.5 }}>{msg}</p>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

ProductAnalyticsPanel.displayName = 'ProductAnalyticsPanel'
export default memo(ProductAnalyticsPanel)
