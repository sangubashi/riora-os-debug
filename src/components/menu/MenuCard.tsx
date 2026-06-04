'use client'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, Pencil, Tag } from 'lucide-react'
import { useMenuStore, type SalonMenuItem } from '@/store/useMenuStore'
import KpiBadge          from './KpiBadge'
import SubscriptionToggle from './SubscriptionToggle'

const CATEGORY_LABEL: Record<string, string> = {
  facial:       'FACIAL',
  option:       'OPTION',
  subscription: 'SUBSCRIPTION',
}

const TrendIcon = ({ trend }: { trend: SalonMenuItem['trend'] }) => {
  if (trend === 'up')   return <TrendingUp   size={11} className="text-emerald-500" />
  if (trend === 'down') return <TrendingDown  size={11} className="text-rose-400"   />
  return                       <Minus         size={11} style={{ color: '#C8A8B0' }} />
}

interface Props {
  menu:  SalonMenuItem
  index: number
}

export default function MenuCard({ menu, index }: Props) {
  const { openEdit, toggleActive, options } = useMenuStore()

  const linkedOpts = options.filter(o => menu.linkedOptionIds.includes(o.id))

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.055, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className={`mx-4 mb-3 rounded-3xl overflow-hidden ${!menu.isActive ? 'opacity-55' : ''}`}
      style={{
        background: 'rgba(255,255,255,0.68)',
        border: '1px solid rgba(255,255,255,0.7)',
        boxShadow: '0 10px 30px rgba(232,145,166,0.12)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* ── Top: category + status + trend ── */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] tracking-[0.2em] font-medium" style={{ color: '#C8A8B0' }}>
            {CATEGORY_LABEL[menu.category]}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${menu.isActive ? 'bg-emerald-400' : 'bg-[#E8D5D9]'}`} />
          <span
            className="text-[10px] font-medium"
            style={{ color: menu.isActive ? '#34D399' : '#C8A8B0' }}
          >
            {menu.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendIcon trend={menu.trend} />
          {menu.rank > 0 && (
            <span className="text-[10px] tabular-nums" style={{ color: '#9A7E74' }}>#{menu.rank}</span>
          )}
        </div>
      </div>

      {/* ── Name + price ── */}
      <div className="px-4 pb-3">
        <h3
          className="text-[16px] font-light leading-tight"
          style={{ color: menu.isActive ? '#5C4033' : '#9A7E74' }}
        >
          {menu.name}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span
            className="text-[13px] tabular-nums font-medium"
            style={{ color: '#EA91A6' }}
          >
            ¥{menu.price.toLocaleString('ja-JP')}
          </span>
          <span style={{ color: '#E8D5D9', fontSize: '10px' }}>·</span>
          <span className="text-[12px]" style={{ color: '#9A7E74' }}>{menu.duration}分</span>
        </div>
      </div>

      {/* ── KPI 4-column grid ── */}
      {menu.isActive && (
        <div className="grid grid-cols-4 gap-1.5 px-4 pb-3">
          <KpiBadge label="リピート率"  value={menu.repeatRate}        color="pink"    delay={index * 0.055 + 0.1} />
          <KpiBadge label="利益率"      value={menu.profitMargin}      color="gold"    delay={index * 0.055 + 0.14} />
          <KpiBadge label="AI推奨"      value={menu.aiRecommendRate}   color="purple"  delay={index * 0.055 + 0.18} />
          <KpiBadge label="VIP移行"     value={menu.vipConversionRate} color="emerald" delay={index * 0.055 + 0.22} />
        </div>
      )}

      {/* ── Secondary KPIs ── */}
      {menu.isActive && (
        <div className="flex items-center gap-3 px-4 pb-3">
          <div className="flex items-center gap-1">
            <span className="text-[9px] tracking-wide" style={{ color: '#C8A8B0' }}>次回来店</span>
            <span className="text-[11px] tabular-nums" style={{ color: '#9A7E74' }}>{menu.nextVisitRate}%</span>
          </div>
          <span style={{ color: '#E8D5D9', fontSize: '8px' }}>·</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] tracking-wide" style={{ color: '#C8A8B0' }}>月{menu.monthlyCount}件</span>
          </div>
          <span style={{ color: '#E8D5D9', fontSize: '8px' }}>·</span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] tracking-wide" style={{ color: '#C8A8B0' }}>アップセル</span>
            <span className="text-[11px] tabular-nums" style={{ color: '#9A7E74' }}>{menu.upsellSuccessRate}%</span>
          </div>
        </div>
      )}

      {/* ── Tags row ── */}
      {(menu.isSubscribable || menu.lineTags.length > 0 || linkedOpts.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {menu.isSubscribable && (
            <span
              className="text-[9px] px-2 py-0.5 rounded-full"
              style={{ color: '#C49A6B', background: 'rgba(196,154,107,0.10)', border: '1px solid rgba(196,154,107,0.22)' }}
            >
              🌸 サブスク対象
            </span>
          )}
          {menu.lineTags.map(tag => (
            <span
              key={tag}
              className="text-[9px] px-2 py-0.5 rounded-full"
              style={{ color: '#EA91A6', background: 'rgba(234,145,166,0.08)', border: '1px solid rgba(234,145,166,0.18)' }}
            >
              {tag}
            </span>
          ))}
          {linkedOpts.length > 0 && (
            <span
              className="text-[9px] px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ color: '#9A7E74', background: 'rgba(154,126,116,0.06)', border: '1px solid rgba(154,126,116,0.14)' }}
            >
              <Tag size={8} />
              オプション{linkedOpts.length}件
            </span>
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-t"
        style={{ borderColor: '#F3E3E6' }}
      >
        <SubscriptionToggle
          enabled={menu.isSubscribable}
          compact
          onChange={v => {
            useMenuStore.setState(s => ({
              menus: s.menus.map(m => m.id === menu.id ? { ...m, isSubscribable: v } : m),
            }))
          }}
        />

        <div className="flex items-center gap-2">
          {/* ON/OFF */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => toggleActive(menu.id)}
            className="px-3 py-1.5 rounded-full text-[10px] font-medium border transition-colors"
            style={
              menu.isActive
                ? { background: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.22)', color: '#34D399' }
                : { background: '#FFF5F6', borderColor: '#F3E3E6', color: '#9A7E74' }
            }
          >
            {menu.isActive ? 'ON' : 'OFF'}
          </motion.button>

          {/* Edit */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => openEdit(menu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px]"
            style={{ background: '#FFF0F2', border: '1px solid #F3E3E6', color: '#9A7E74' }}
          >
            <Pencil size={11} />
            編集
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}
