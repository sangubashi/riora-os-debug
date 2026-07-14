'use client'
/**
 * /menu/features — 全機能紹介
 */
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Home, Users, Mic, User, Settings, Brain } from 'lucide-react'

interface Feature {
  title: string
  desc:  string
}

interface Category {
  icon:     React.ElementType
  title:    string
  color:    string
  features: Feature[]
}

const CATEGORIES: Category[] = [
  {
    icon:  Home,
    title: '今日タブ',
    color: '#F5A0B5',
    features: [
      { title: 'AIブリーフィング', desc: '来店予定のお客様の要点を自動で表示します' },
      { title: '注意事項',         desc: '禁忌事項などを3行にまとめて確認できます' },
      { title: 'このあとの予約',    desc: '本日これから来店予定のお客様を一覧で確認できます' },
    ],
  },
  {
    icon:  Users,
    title: '顧客タブ',
    color: '#78A8D8',
    features: [
      { title: '顧客情報',                  desc: '来店履歴・前回の施術内容を確認できます' },
      { title: '禁忌事項確認',               desc: '安全に施術するための注意点を確認できます' },
      { title: '覚えておくこと(Customer Memory)', desc: '家族・仕事・趣味・健康・ライフイベントの5カテゴリで記録できます' },
    ],
  },
  {
    icon:  Mic,
    title: 'メモタブ',
    color: '#52C87A',
    features: [
      { title: '音声メモ',   desc: '施術中に気づいたことを録音して記録できます' },
      { title: 'AI要約',     desc: '録音した内容からAIが自動で要点を抽出します' },
      { title: '会話履歴検索(実装後)', desc: '過去のメモをキーワードで検索できるようになります' },
    ],
  },
  {
    icon:  Brain,
    title: 'AI提案',
    color: '#D98292',
    features: [
      { title: '次回来店のご提案', desc: 'AIが参考情報として次回のご提案を用意します。最終判断はスタッフが行います' },
    ],
  },
  {
    icon:  User,
    title: 'マイページ',
    color: '#D4A96A',
    features: [
      { title: '自分の実績確認', desc: '退勤前に、ご自身の実績を振り返ることができます' },
    ],
  },
  {
    icon:  Settings,
    title: '設定タブ',
    color: '#9E8090',
    features: [
      { title: '予約管理',      desc: '本日の来店予定を確認できます' },
      { title: 'メッセージ',    desc: 'LINE経由のお客様対応ができます' },
      { title: '使い方ガイド',  desc: '1日の流れや各機能の使い方を確認できます' },
      { title: 'ホーム画面に追加', desc: 'アプリのようにアイコンからすぐ開けるようになります' },
    ],
  },
]

export default function FeaturesPage() {
  const router = useRouter()

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
              Features
            </h1>
            <p className="text-[10px] tracking-widest" style={{ color: '#9E8090' }}>全機能紹介</p>
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
          {CATEGORIES.map((cat, i) => (
            <motion.div
              key={cat.title}
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
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid #F5E6E8' }}>
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${cat.color}18` }}
                >
                  <cat.icon size={18} style={{ color: cat.color }} strokeWidth={1.8} />
                </div>
                <span className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>
                  {cat.title}
                </span>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                {cat.features.map(f => (
                  <div key={f.title}>
                    <p className="text-[12px] font-semibold" style={{ color: '#4A2C2A' }}>{f.title}</p>
                    <p className="text-[12px]" style={{ color: '#9E8090', lineHeight: '1.6' }}>{f.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
