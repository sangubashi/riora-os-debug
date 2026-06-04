'use client'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Send, FileText, Sparkles } from 'lucide-react'
import { useLineCrmStore } from '@/store/useLineStore'
import type { AiReplySuggestion } from '@/store/useLineStore'
import ChatBubble    from './ChatBubble'
import AiReplyBar    from './AiReplyBar'
import TemplateSheet from './TemplateSheet'

// ── 顧客タイプ別フォールバックAI提案 ──────────────────────────────────────────
const TYPE_FALLBACK: Record<string, AiReplySuggestion[]> = {
  'VIP型': [
    { id:'fb-v1', type:'vip',     reason:'VIP様特別案内',    body:'いつもご来店ありがとうございます✨ 新しいプレミアムエイジングケアコースをご用意いたしました。ぜひお試しいただけますと嬉しいです🌸' },
    { id:'fb-v2', type:'revisit', reason:'次回予約のご案内',  body:'先日はご来店いただきありがとうございました。次回のご予約はご都合いかがでしょうか？お気軽にご連絡ください💎' },
  ],
  '慎重・不安型': [
    { id:'fb-c1', type:'follow_up', reason:'安心フォロー',    body:'先日はご来店いただきありがとうございました🌸 施術後のお肌の調子はいかがでしょうか？何かご不安な点があれば、どうぞお気軽にご相談ください。' },
    { id:'fb-c2', type:'revisit',   reason:'やさしい再来促進', body:'○○様のお肌に合わせた保湿ケアのご提案がございます。ご都合の良い日にぜひいらしてください💆‍♀️' },
  ],
  '感情重視型': [
    { id:'fb-e1', type:'follow_up', reason:'共感フォロー',    body:'○○様、いつも温かいお言葉をありがとうございます🌸 先日のご来店、私どもも嬉しかったです。またお会いできる日を楽しみにしております✨' },
    { id:'fb-e2', type:'revisit',   reason:'感情的つながり',  body:'こんにちは💕 お変わりありませんか？○○様のこと、いつも気にかけております。ぜひまたお話しながら施術させてください🌺' },
  ],
  '効果重視型': [
    { id:'fb-k1', type:'revisit',  reason:'効果訴求',         body:'○○様、前回のポアクリーニングの効果はいかがでしたか？毛穴の開きには定期的なケアが効果的です。次回は美白トリートメントも合わせておすすめいたします✨' },
    { id:'fb-k2', type:'follow_up', reason:'数値報告',        body:'○○様の肌状態データを確認したところ、次回のケアは3〜4週間後が最適なタイミングです。ご予約はいかがでしょうか📊' },
  ],
  '信頼構築型': [
    { id:'fb-s1', type:'revisit',   reason:'定期来店促進',    body:'○○様、いつもありがとうございます🌸 定期的なフェイシャルケアで、お肌の状態がとても安定しておりますよ。次回もお待ちしております。' },
    { id:'fb-s2', type:'follow_up', reason:'関係深化',        body:'こんにちは！○○様のご来店をスタッフ一同楽しみにしております💫 次回はデコルテマッサージもおすすめです。ご都合はいかがでしょうか？' },
  ],
}

function getFallbackSuggestions(customerType: string): AiReplySuggestion[] {
  return TYPE_FALLBACK[customerType] ?? TYPE_FALLBACK['信頼構築型']
}

const TYPE_COLOR: Record<string, string> = {
  '慎重・不安型': '#B05070',
  '感情重視型':   '#9A7020',
  '効果重視型':   '#3E7040',
  '信頼構築型':   '#7A5040',
  'VIP型':       '#8B6CC0',
}

function dayLabel(days: number) {
  if (days === 0) return '今日来店'
  if (days === 1) return '昨日来店'
  return `${days}日前来店`
}

export default function ChatWindow() {
  const {
    isChatOpen, selectedThread, messages, aiSuggestions,
    closeChat, sendMessage, openTemplate,
  } = useLineCrmStore()

  const [text, setText]       = useState('')
  const [showAi, setShowAi]   = useState(false)
  const scrollRef             = useRef<HTMLDivElement>(null)

  // scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isChatOpen])

  // clear text when chat closes
  useEffect(() => { if (!isChatOpen) setText('') }, [isChatOpen])

  const handleSend = () => {
    if (!text.trim()) return
    sendMessage(text)
    setText('')
  }

  const handleAiInsert = (body: string) => setText(body)

  const thread = selectedThread

  // フォールバック含めた提案リスト（thread 宣言後に定義）
  const effectiveSuggestions = aiSuggestions.length > 0
    ? aiSuggestions
    : thread ? getFallbackSuggestions(thread.customerType) : []

  return (
    <AnimatePresence>
      {isChatOpen && thread && (
        <>
          {/* Backdrop */}
          <motion.div
            key="chat-bg"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeChat}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(92,64,51,0.12)', backdropFilter: 'blur(6px)' }}
          />

          {/* Window */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="chat-window"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 280 }}
              className="w-full max-w-[430px] pointer-events-auto flex flex-col bg-[#FAF5F6]"
              style={{
                height: '90dvh',
                borderRadius: '28px 28px 0 0',
                boxShadow: '0 -8px 40px rgba(92,64,51,0.14)',
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#E8D5D8]" />
              </div>

              {/* Header */}
              <div
                className="flex items-center gap-3 px-4 pb-3 flex-shrink-0 border-b border-[#F3E3E6]"
                style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
              >
                <button
                  onClick={closeChat}
                  className="w-8 h-8 rounded-full bg-[#F8F1F3] flex items-center justify-center flex-shrink-0"
                >
                  <ChevronLeft size={16} className="text-[#C8A58C]" />
                </button>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[14px] font-medium"
                  style={{ background: 'linear-gradient(135deg, #D98292, #F2B6C6)' }}>
                  {thread.customerName.slice(-1)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-[#5C4033] truncate">{thread.customerName} 様</span>
                    {thread.churnRisk > 70 && (
                      <span className="text-[9px] bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 rounded-full flex-shrink-0">
                        失客注意
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px]" style={{ color: TYPE_COLOR[thread.customerType] ?? '#9F7E6C' }}>
                      {thread.customerType}
                    </span>
                    <span className="text-[10px] text-[#C0A8A0]">{dayLabel(thread.daysSinceVisit)}</span>
                  </div>
                </div>

              </div>

              {/* AI Reply Bar (toggle表示) */}
              {showAi && (
                <AiReplyBar suggestions={effectiveSuggestions} onSelect={(body) => { handleAiInsert(body); setShowAi(false) }} />
              )}

              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4"
                style={{ scrollbarWidth: 'none' }}
              >
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <span className="text-3xl">💬</span>
                    <p className="text-[12px] text-[#C0A8A0]">メッセージはまだありません</p>
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <ChatBubble key={msg.id} {...msg} index={i} />
                  ))
                )}
              </div>

              {/* Compose bar */}
              <div
                className="flex-shrink-0 flex items-end gap-2 px-4 pt-2"
                style={{
                  paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
                  background: 'rgba(255,255,255,0.92)',
                  backdropFilter: 'blur(12px)',
                  borderTop: '1px solid #F3E3E6',
                }}
              >
                {/* テンプレートボタン */}
                <button
                  onClick={openTemplate}
                  className="w-9 h-9 rounded-full bg-[#F5D6DB] flex items-center justify-center flex-shrink-0 mb-0.5"
                  title="テンプレート"
                >
                  <FileText size={15} className="text-[#D98292]" />
                </button>

                <div className="flex-1 min-h-[40px] max-h-[100px] bg-[#F8F1F3] rounded-2xl px-3 py-2 flex items-end">
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    placeholder="メッセージを入力…"
                    rows={1}
                    className="w-full resize-none bg-transparent text-[#5C4033] placeholder:text-[#C8A58C] outline-none leading-relaxed"
                    style={{ fontSize: 16, maxHeight: '80px', overflow: 'auto', scrollbarWidth: 'none', fontFamily: 'inherit' }}
                  />
                </div>

                {/* AI生成ボタン */}
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowAi(v => !v)}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 transition-all"
                  title="AI生成"
                  style={{
                    background: showAi
                      ? 'linear-gradient(135deg, #F5A0B5, #F0879E)'
                      : '#F5D6DB',
                  }}
                >
                  <Sparkles size={15} className={showAi ? 'text-white' : 'text-[#D98292]'} />
                </motion.button>

                {/* 送信ボタン */}
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSend}
                  disabled={!text.trim()}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 transition-colors"
                  style={{
                    background: text.trim()
                      ? 'linear-gradient(135deg, #D98292, #F2B6C6)'
                      : '#F3E3E6',
                  }}
                >
                  <Send size={15} className={text.trim() ? 'text-white' : 'text-[#C8A58C]'} />
                </motion.button>
              </div>
            </motion.div>
          </div>

          {/* Template sheet (z above chat window) */}
          <TemplateSheet onInsert={handleAiInsert} />
        </>
      )}
    </AnimatePresence>
  )
}
