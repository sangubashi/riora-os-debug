'use client'
/**
 * /menu/guide — Riora OS スタッフ向け利用ガイド
 *
 * 強調事項: AI 提案は提案であり命令ではない。最終判断はスタッフ。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronDown, ChevronUp, BookOpen, Mic, Brain, Bell, MessageCircle, Star, Shield, Compass, Smartphone, HelpCircle } from 'lucide-react'

interface Section {
  id:      number
  icon:    React.ElementType
  title:   string
  color:   string
  content: React.ReactNode
}

const sections: Section[] = [
  {
    id:    1,
    icon:  Bell,
    title: '今日の予約・通知',
    color: '#F5A0B5',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>予約の一元管理</strong>：今日・今週の予約スケジュールがひと目でわかります。</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>事前アラート</strong>：来店前に「このお客様の注意点」が通知されます。</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>記念日リマインダー</strong>：誕生日など、お祝い対象のお客様を事前にお知らせします。</span></li>
        </ul>
      </div>
    ),
  },
  {
    id:    2,
    icon:  BookOpen,
    title: '顧客情報（Customer Bottom Sheet）',
    color: '#78A8D8',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>お客様の名前をタップするだけで、以下の詳細データがすぐにポップアップで確認できます。</p>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>基本情報 / 来店履歴</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>過去の会話メモ</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>前回の提案内容</span></li>
        </ul>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(217,130,146,0.08)', border: '1px solid rgba(217,130,146,0.2)' }}
        >
          <p className="font-semibold mb-1" style={{ color: '#D98292' }}>禁忌事項・重要フラグ</p>
          <p>トラブル防止のため、<strong>必ず最初にご確認ください</strong>。</p>
        </div>
      </div>
    ),
  },
  {
    id:    3,
    icon:  Brain,
    title: 'AI提案サポート',
    color: '#D98292',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>パーソナライズ提案</strong>：お客様一人ひとりに合ったホームケアや次回の施術プランを自動で算出して表示します。</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>関連ブログ連携</strong>：お客様の悩みに合わせたブログ記事がすぐに見つかります。</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>来店サイクル予測</strong>：「次回はいつ頃のご来店がベストか」の目安を提案します。</span></li>
        </ul>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(217,130,146,0.08)', border: '1px solid rgba(217,130,146,0.2)' }}
        >
          <p className="font-semibold mb-1" style={{ color: '#D98292' }}>AI提案は「アシスト」</p>
          <p>AIの提案はあくまで参考情報です。<strong>最終判断はスタッフの皆様が行ってください</strong>。</p>
        </div>
      </div>
    ),
  },
  {
    id:    4,
    icon:  Mic,
    title: '音声メモ',
    color: '#52C87A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>接客が終わったら、スマホに向かって話すだけで自動でメモが残ります。</p>
        <p>AIが音声を正確に文字起こしするため、カルテ入力の手間が大幅に削減されます。</p>
      </div>
    ),
  },
  {
    id:    5,
    icon:  MessageCircle,
    title: 'LINEメッセージ作成',
    color: '#34A070',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>ホームケアの案内や、心のこもったお礼メッセージをAIが自動で下書きします。</p>
        <p>内容を確認してコピーするだけで、スムーズにLINE送信が可能です。</p>
      </div>
    ),
  },
  {
    id:    6,
    icon:  Star,
    title: 'My Page（マイページ）',
    color: '#D4A96A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>自分の「指名数」「リピート率」「店販実績」を先月と比較してグラフや数字で確認できます。</p>
        <p>日々の頑張りがリアルタイムで可視化されます。</p>
      </div>
    ),
  },
  {
    id:    7,
    icon:  Compass,
    title: 'シーン別・使い方の流儀',
    color: '#6BA88C',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        {[
          { t: '来店前',   d: '通知と顧客情報をチェックし、禁忌・重要フラグや前回までの会話内容を頭に入れておきます。' },
          { t: '接客中',   d: '必要に応じてAI提案を参考にし、お客様に最適なホームケアや次回周期をご案内します。' },
          { t: '接客後',   d: 'すぐに音声メモを残し、次回の提案内容を確定させます。' },
          { t: 'スキマ時間', d: '「My Page」で自分の実績数値をチェックし、モチベーションアップや目標管理に活かします。' },
        ].map(step => (
          <div key={step.t} className="rounded-2xl p-3" style={{ background: 'rgba(107,168,140,0.08)', border: '1px solid rgba(107,168,140,0.2)' }}>
            <p className="font-semibold mb-1" style={{ color: '#6BA88C' }}>【{step.t}】</p>
            <p>{step.d}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id:    8,
    icon:  Shield,
    title: 'ご利用上の大切な注意点',
    color: '#E88C5A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <div className="rounded-2xl p-3" style={{ background: 'rgba(232,140,90,0.08)', border: '1px solid rgba(232,140,90,0.2)' }}>
          <p className="font-semibold mb-1" style={{ color: '#E88C5A' }}>禁忌・重要フラグの徹底</p>
          <p>トラブル防止のため、アレルギーや施術上の注意事項（フラグ）は必ず事前に目を通してください。</p>
        </div>
        <div className="rounded-2xl p-3" style={{ background: 'rgba(232,140,90,0.08)', border: '1px solid rgba(232,140,90,0.2)' }}>
          <p className="font-semibold mb-1" style={{ color: '#E88C5A' }}>AI提案は「アシスト」</p>
          <p>AIの提案はあくまで参考情報です。お客様の表情やその日のコンディションを見ながら、最終的な判断はスタッフの皆様が行ってください。</p>
        </div>
        <div className="rounded-2xl p-3" style={{ background: 'rgba(232,140,90,0.08)', border: '1px solid rgba(232,140,90,0.2)' }}>
          <p className="font-semibold mb-1" style={{ color: '#E88C5A' }}>情報管理の厳守</p>
          <p>お客様の個人情報やアプリ内のデータを外部に持ち出したり、SNS等へ掲載したりしないよう徹底をお願いします。</p>
        </div>
      </div>
    ),
  },
  {
    id:    9,
    icon:  Smartphone,
    title: 'ホーム画面への追加方法',
    color: '#F5A0B5',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(245,160,181,0.08)', border: '1px solid rgba(245,160,181,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1.5" style={{ color: '#D98292' }}>iPhone</p>
          <ol className="space-y-1 pl-1">
            <li>1. SafariでRiora OSを開く</li>
            <li>2. 共有ボタンを押す</li>
            <li>3. 「ホーム画面に追加」を選択</li>
            <li>4. 「追加」を押して完了</li>
          </ol>
        </div>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(120,168,216,0.08)', border: '1px solid rgba(120,168,216,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1.5" style={{ color: '#78A8D8' }}>Android</p>
          <ol className="space-y-1 pl-1">
            <li>1. ChromeでRiora OSを開く</li>
            <li>2. メニュー（︙）を押す</li>
            <li>3. 「ホーム画面に追加」を選択</li>
            <li>4. 「追加」を押して完了</li>
          </ol>
        </div>
      </div>
    ),
  },
  {
    id:    10,
    icon:  HelpCircle,
    title: 'FAQ',
    color: '#9E8090',
    content: (
      <div className="space-y-4 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <div>
          <p className="font-semibold mb-1">Q. ログインできません</p>
          <p style={{ color: '#6B4C4C' }}>A. メールアドレス・パスワードを確認してください。</p>
        </div>
        <div>
          <p className="font-semibold mb-1">Q. パスワードを忘れました</p>
          <p style={{ color: '#6B4C4C' }}>A. 設定 → パスワード変更、または管理者へお問い合わせください。</p>
        </div>
        <div>
          <p className="font-semibold mb-1">Q. 音声メモが保存されません</p>
          <p style={{ color: '#6B4C4C' }}>A. マイク権限が有効になっているか確認してください。</p>
        </div>
        <div>
          <p className="font-semibold mb-1">Q. AI提案は必ず使わないといけませんか？</p>
          <p style={{ color: '#6B4C4C' }}>A. AIは接客を補助するための機能です。最終判断はスタッフが行ってください。</p>
        </div>
      </div>
    ),
  },
]

export default function GuidePage() {
  const router  = useRouter()
  const [open, setOpen] = useState<Set<number>>(new Set([1]))

  function toggle(id: number) {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div
      className="min-h-dvh max-w-[430px] mx-auto flex flex-col"
      style={{
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* ヘッダー */}
      <div
        className="px-5 pb-4 flex-shrink-0"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 16px))',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#FFFFFF', border: '1px solid #F5E6E8' }}
          >
            <ChevronLeft size={18} style={{ color: '#D98292' }} />
          </button>
          <div>
            <p className="text-[9px] tracking-[0.35em]" style={{ color: '#C8B0B8' }}>SALON RIORA</p>
            <h1
              className="text-[22px] font-light leading-tight"
              style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}
            >
              Guide
            </h1>
            <p className="text-[10px] tracking-widest" style={{ color: '#9E8090' }}>使い方ガイド</p>
          </div>
        </div>
      </div>

      {/* コンテンツ */}
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{
          paddingBottom: 'calc(32px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        <div className="px-4 pt-4 space-y-3">
          {/* イントロ（常時表示・折りたたみ不可） */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid #F5E6E8',
              boxShadow: '0 2px 10px rgba(245,160,181,0.08)',
            }}
          >
            <p className="text-[13px] font-semibold mb-1.5" style={{ color: '#4A2C2A' }}>
              🌟 Riora OS（リオラ オーエス）とは？
            </p>
            <p className="text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
              スタッフの皆様の日々の接客を強力にサポートする専用アプリです。
              「お客様の情報をすぐに確認できる」「次に何を提案すればいいかが一目でわかる」
              「うっかりミスや忘れ物を防いでくれる」— そんな、接客に集中するためのパートナーツールです。
            </p>
          </div>

          <p className="text-[11px] font-semibold tracking-[0.1em] px-1" style={{ color: '#C8A8B0' }}>
            📱 毎日使う6つの主要機能
          </p>

          {sections.map((sec, i) => {
            const isOpen = open.has(sec.id)
            return (
              <motion.div
                key={sec.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  border: '1px solid #F5E6E8',
                  boxShadow: '0 2px 10px rgba(245,160,181,0.08)',
                }}
              >
                <button
                  onClick={() => toggle(sec.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${sec.color}18` }}
                  >
                    <sec.icon size={18} style={{ color: sec.color }} strokeWidth={1.8} />
                  </div>
                  <span
                    className="flex-1 text-left text-[13px] font-semibold"
                    style={{ color: '#4A2C2A' }}
                  >
                    {sec.title}
                  </span>
                  {isOpen
                    ? <ChevronUp size={16} style={{ color: '#C8A8B0' }} />
                    : <ChevronDown size={16} style={{ color: '#C8A8B0' }} />
                  }
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        className="px-4 pb-4"
                        style={{ borderTop: '1px solid #F5E6E8' }}
                      >
                        <div className="pt-3">{sec.content}</div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
