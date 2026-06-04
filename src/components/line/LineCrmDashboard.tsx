'use client'
import { useEffect }  from 'react'
import { motion }     from 'framer-motion'
import { MessageSquare, Send, FileText, Plus, Sparkles } from 'lucide-react'
import { useLineStore, type LineCrmTab } from '@/store/useLineStore'
import ChatList       from './ChatList'
import ChatWindow     from './ChatWindow'
import BroadcastSheet from './BroadcastSheet'
import AppBottomNav   from '@/components/phase1/AppBottomNav'

// ─── Broadcast tab ───────────────────────────────────────────────────────────

function BroadcastTabContent() {
  const { todayContacts, threads, openBroadcast, openThread } = useLineStore()

  return (
    <div className="flex flex-col pb-24">
      <div className="mx-4 mt-4 mb-5">
        <div className="flex items-center gap-1.5 mb-3">
          <Sparkles size={13} className="text-[#D98292]" />
          <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">AI推奨アクション</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {todayContacts.map((a, i) => {
            const thread = threads.find(t => t.id === a.threadId)
            return (
              <motion.div
                key={a.customerId}
                initial={{ opacity:0, y:8 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay:i*0.07 }}
                className={`bg-white border rounded-2xl p-4 shadow-card ${a.urgency==='high' ? 'border-rose-200' : 'border-[#F3E3E6]'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background:a.urgency==='high'?'#FFF0F2':'#FFF8DC', color:a.urgency==='high'?'#C05060':'#9A7020' }}>
                        {a.urgency==='high' ? '⚠️ 緊急' : '推奨'}
                      </span>
                      <span className="text-[13px] font-semibold text-[#5C4033]">{a.customerName} 様</span>
                    </div>
                    <p className="text-[11px] text-[#9F7E6C] leading-snug">{a.reason}</p>
                  </div>
                  {thread && (
                    <motion.button whileTap={{ scale:0.94 }} onClick={() => openThread(thread)}
                      className="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium text-white"
                      style={{ background:'linear-gradient(135deg, #D98292, #F2B6C6)' }}>
                      送る
                    </motion.button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      <div className="mx-4 mb-5">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">セグメント別状況</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label:'全顧客',         count:52, sub:'今月来店: 34名' },
            { label:'1ヶ月以上未来店', count:18, sub:'失客リスク高', warn:true },
            { label:'VIP顧客',         count: 8, sub:'次回予約率 88%' },
            { label:'サブスク会員',    count:14, sub:'継続率 91%' },
          ].map((seg, i) => (
            <motion.button key={seg.label}
              initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.06 }}
              whileTap={{ scale:0.96 }} onClick={openBroadcast}
              className={`bg-white border rounded-2xl p-3.5 text-left shadow-card ${seg.warn?'border-rose-200':'border-[#F3E3E6]'}`}>
              <p className={`text-[22px] font-light tabular-nums ${seg.warn?'text-rose-500':'text-[#5C4033]'}`}>
                {seg.count}<span className="text-[12px]">名</span>
              </p>
              <p className="text-[11px] font-medium text-[#5C4033] mt-0.5">{seg.label}</p>
              <p className="text-[10px] text-[#9F7E6C] mt-0.5">{seg.sub}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Template tab ─────────────────────────────────────────────────────────────

function TemplateTabContent() {
  const { templates, fetchTemplates } = useLineStore()

  useEffect(() => { fetchTemplates() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col pb-24">
      <div className="mx-4 mt-4 mb-2">
        <span className="text-[11px] font-semibold text-[#9F7E6C] tracking-wide">
          保存済みテンプレート ({templates.length})
        </span>
      </div>
      {templates.map((tmpl, i) => (
        <motion.div key={tmpl.id}
          initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.05 }}
          className="mx-4 mb-2 bg-white border border-[#F3E3E6] rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-semibold text-[#5C4033]">{tmpl.title}</span>
            <div className="flex gap-1">
              {tmpl.tags.map(tag => (
                <span key={tag} className="text-[9px] bg-[#F5D6DB] text-[#D98292] px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
          <p className="text-[12px] text-[#9F7E6C] leading-relaxed">{tmpl.body}</p>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS: { key: LineCrmTab; label: string; Icon: typeof MessageSquare }[] = [
  { key:'chat',      label:'チャット', Icon:MessageSquare },
  { key:'broadcast', label:'配信',     Icon:Send          },
  { key:'template',  label:'テンプレ', Icon:FileText      },
]

export default function LineCrmDashboard() {
  const {
    activeTab, setTab,
    threads, openBroadcast,
    fetchThreads, isLoading,
  } = useLineStore()

  // ── 初回データ取得 ──────────────────────────────────────────────
  useEffect(() => {
    fetchThreads()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0)
  const urgentCount = threads.filter(t => t.isUrgent).length

  return (
    <div
      className="min-h-dvh max-w-[430px] mx-auto flex flex-col overflow-x-hidden"
      style={{
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        paddingBottom: 'calc(80px + max(12px, env(safe-area-inset-bottom)))',
      }}
    >

      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 border-b border-[#F3E3E6]"
        style={{ background:'rgba(255,255,255,0.88)', backdropFilter:'blur(16px)',
                 paddingTop:'max(48px, calc(env(safe-area-inset-top) + 12px))' }}>

        <div className="flex items-center gap-3 px-4 pb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold text-[#5C4033]">LINE CRM</h1>
              {totalUnread > 0 && (
                <span className="text-[10px] bg-[#F56E8B] text-white px-2 py-0.5 rounded-full font-bold">
                  未読 {totalUnread}
                </span>
              )}
              {urgentCount > 0 && (
                <span className="text-[10px] bg-[#FFF0F2] text-rose-500 border border-rose-200 px-2 py-0.5 rounded-full">
                  要対応 {urgentCount}名
                </span>
              )}
              {isLoading && (
                <motion.span
                  animate={{ opacity:[0.3,1,0.3] }}
                  transition={{ repeat:Infinity, duration:1.2 }}
                  className="text-[9px] text-[#C8A58C]"
                >
                  読込中…
                </motion.span>
              )}
            </div>
            <p className="text-[10px] text-[#9F7E6C]">AI返信支援 · 一括配信 · セグメント分析</p>
          </div>
          <motion.button whileTap={{ scale:0.92 }} onClick={openBroadcast}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white"
            style={{ background:'linear-gradient(135deg, #D98292, #F2B6C6)' }}>
            <Plus size={16} />
          </motion.button>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-[#F3E3E6]">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key
            return (
              <button key={tab.key} onClick={() => setTab(tab.key)}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 relative">
                <tab.Icon size={16} className={isActive ? 'text-[#D98292]' : 'text-[#C0A8A0]'} />
                <span className={`text-[10px] font-medium ${isActive ? 'text-[#D98292]' : 'text-[#C0A8A0]'}`}>
                  {tab.label}
                </span>
                {isActive && (
                  <motion.div layoutId="line-tab-indicator"
                    className="absolute bottom-0 left-4 right-4 h-0.5 bg-[#D98292] rounded-full" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth:'none' }}>
        <motion.div key={activeTab} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.2 }}>
          {activeTab === 'chat'      && <ChatList />}
          {activeTab === 'broadcast' && <BroadcastTabContent />}
          {activeTab === 'template'  && <TemplateTabContent />}
        </motion.div>
      </div>

      {/* ── Overlays ── */}
      <ChatWindow />
      <BroadcastSheet />
      <AppBottomNav />
    </div>
  )
}
