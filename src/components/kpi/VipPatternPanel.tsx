'use client'
/**
 * VipPatternPanel.tsx  — VIP成功パターン分析パネル
 * KPI画面に差し込む。VIP共通特徴・施術・商品ランキングを表示。
 */
import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useAnalyticsStore } from '@/store/useAnalyticsStore'
import type { VipRankItem } from '@/types'

function formatYen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

const RateBar = memo(function RateBar({ item, maxRate }: { item: VipRankItem; maxRate: number }) {
  const pct = maxRate > 0 ? Math.round(item.rate / maxRate * 100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'5px 0' }}>
      <span style={{ fontSize:'11px', color:'#5C4033', flex:1, fontWeight:500,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {item.name}
      </span>
      <div style={{ width:'80px', background:'#F5EEF0', borderRadius:'3px', height:'5px', overflow:'hidden' }}>
        <div style={{ background:'#FFD166', width:`${pct}%`, height:'100%',
          borderRadius:'3px', transition:'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize:'11px', fontWeight:700, color:'#5C4033', minWidth:'32px',
        textAlign:'right', fontFamily:'Inter, sans-serif' }}>
        {item.rate}%
      </span>
    </div>
  )
})
RateBar.displayName = 'VipRateBar'

function VipPatternPanel() {
  const result = useAnalyticsStore(s => s.vip)
  const { profile, treatmentRanking, productRanking, insights } = result
  const maxTreatRate = treatmentRanking[0]?.rate ?? 1
  const maxProdRate  = productRanking[0]?.rate ?? 1

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>

      {/* タイトル */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', paddingTop:'4px' }}>
        <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, letterSpacing:'0.1em' }}>
          👑 VIP成功パターン
        </p>
        <span style={{ fontSize:'9px', background:'#FFF8E8', color:'#D4A017',
          padding:'1px 6px', borderRadius:'999px', border:'1px solid #FFD166' }}>
          {profile.count}名のVIPを分析
        </span>
      </div>

      {/* VIPプロフィール */}
      <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>
        <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, marginBottom:'12px' }}>
          VIP顧客の平均像
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
          {[
            { label:'平均来店回数',   value:`${profile.avgVisits}回` },
            { label:'平均累計売上',   value: formatYen(profile.avgSales) },
            { label:'LINE返信率',     value:`${profile.avgLineResponse}%` },
            { label:'来店周期',       value:`${profile.avgCycleDays}日` },
            { label:'店販購入率',     value:`${profile.purchaseRate}%` },
          ].map(item => (
            <div key={item.label} style={{ background:'#FFFBF0', borderRadius:'12px',
              padding:'10px 12px', border:'1px solid #FFE8A0' }}>
              <p style={{ fontSize:'10px', color:'#C8A8B0', marginBottom:'3px' }}>{item.label}</p>
              <p style={{ fontSize:'16px', fontWeight:700, color:'#5C4033',
                fontFamily:'Inter, sans-serif' }}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 共通施術 */}
      {treatmentRanking.length > 0 && (
        <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>
          <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, marginBottom:'10px' }}>
            💆 VIPが利用する施術
          </p>
          {treatmentRanking.map((item, i) => (
            <motion.div key={item.name}
              initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }}
              transition={{ delay: i*0.05 }}>
              <RateBar item={item} maxRate={maxTreatRate} />
            </motion.div>
          ))}
        </div>
      )}

      {/* 共通商品 */}
      {productRanking.length > 0 && (
        <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>
          <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, marginBottom:'10px' }}>
            🛍 VIPが購入する商品
          </p>
          {productRanking.map((item, i) => (
            <motion.div key={item.name}
              initial={{ opacity:0, x:-6 }} animate={{ opacity:1, x:0 }}
              transition={{ delay: i*0.05 }}>
              <RateBar item={item} maxRate={maxProdRate} />
            </motion.div>
          ))}
        </div>
      )}

      {/* AIインサイト */}
      <div style={{ background:'#fff', border:'1px solid #F5EEF0', borderRadius:'18px', padding:'16px' }}>
        <p style={{ fontSize:'11px', color:'#C8A58C', fontWeight:600, marginBottom:'10px' }}>
          💡 VIPインサイト
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
          {insights.map((msg, i) => (
            <motion.div key={i}
              initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }}
              transition={{ delay: i*0.06 }}
              style={{ display:'flex', alignItems:'flex-start', gap:'8px',
                padding:'7px 10px', background:'#FFFBF0',
                borderRadius:'10px', border:'1px solid #FFE8A0' }}>
              <span style={{ fontSize:'12px', flexShrink:0 }}>✨</span>
              <p style={{ fontSize:'12px', color:'#5C4033', lineHeight:1.5 }}>{msg}</p>
            </motion.div>
          ))}
        </div>
      </div>

    </div>
  )
}

VipPatternPanel.displayName = 'VipPatternPanel'
export default memo(VipPatternPanel)
