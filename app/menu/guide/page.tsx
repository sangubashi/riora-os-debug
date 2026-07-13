'use client'
/**
 * /menu/guide — Riora AI アシスタント 使い方ガイド（7セクション）
 *
 * 強調事項: AI 提案は提案であり命令ではない。最終判断はスタッフ。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronDown, ChevronUp, BookOpen, Mic, Brain, Calendar, Star, Shield, HelpCircle, Smartphone } from 'lucide-react'

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
    icon:  Brain,
    title: 'AI 提案は「参考情報」です',
    color: '#D98292',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>
          Riora の AI は来店履歴・顧客の好み・過去の記録をもとに接客のヒントを提案します。
        </p>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(217,130,146,0.08)', border: '1px solid rgba(217,130,146,0.2)' }}
        >
          <p className="font-semibold mb-1" style={{ color: '#D98292' }}>重要</p>
          <p>
            AI の提案はあくまで参考情報です。施術内容や接客方針の<strong>最終判断はスタッフが行ってください</strong>。
            「AI がそう言ったから」という理由だけで施術を変更しないでください。
          </p>
        </div>
        <p>
          お客様の体調・当日の状態・ご要望を直接確認した上で、スタッフの専門的判断を最優先してください。
        </p>
      </div>
    ),
  },
  {
    id:    2,
    icon:  Calendar,
    title: '予約管理の使い方',
    color: '#78A8D8',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>予約一覧画面では本日の来店予定を確認できます。</p>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>予約カードをタップすると AI 接客提案が表示されます</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>提案内容は来店前のブリーフィングとしてご活用ください</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>来店済みの予約は自動的に「完了」マークが付きます</span></li>
        </ul>
        <p className="text-[11px]" style={{ color: '#9E8090' }}>
          ※ 予約データは外部予約システムと連携しています。変更は元のシステム上で行ってください。
        </p>
      </div>
    ),
  },
  {
    id:    3,
    icon:  Star,
    title: 'VIP 顧客管理',
    color: '#D4A96A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>VIP 管理では担当顧客の情報を閲覧できます。</p>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>自分が担当する顧客と「店舗共有顧客」が表示されます</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>他のスタッフの専任顧客は表示されません（プライバシー保護）</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>チャーンリスクが高い顧客には警告インジケーターが表示されます</span></li>
        </ul>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(212,169,106,0.08)', border: '1px solid rgba(212,169,106,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1" style={{ color: '#D4A96A' }}>担当割り当て</p>
          <p>担当顧客の変更が必要な場合は、管理者にご連絡ください。</p>
        </div>
      </div>
    ),
  },
  {
    id:    4,
    icon:  Mic,
    title: 'Voice Memo（音声メモ）',
    color: '#52C87A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>施術中に気づいたことを音声で記録し、AI が自動で要点を抽出します。</p>
        <div className="space-y-2">
          <div className="flex gap-2 items-start">
            <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#52C87A', color: '#fff' }}>1</span>
            <p>マイクボタンを押して録音開始</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#52C87A', color: '#fff' }}>2</span>
            <p>停止後、音声と文字起こしを確認</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#52C87A', color: '#fff' }}>3</span>
            <p>保存したい項目にチェックを入れて保存</p>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#52C87A', color: '#fff' }}>4</span>
            <p>5秒以内なら「元に戻す」で取り消し可能</p>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: '#9E8090' }}>
          ※ チェックしなかった項目は保存されません。個人情報に注意して録音してください。
        </p>
      </div>
    ),
  },
  {
    id:    5,
    icon:  BookOpen,
    title: '覚えておくこと（Customer Memory）',
    color: '#A078D4',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>顧客カルテの「覚えておくこと」欄に大切な情報を記録できます。</p>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>家族・仕事・趣味・健康・ライフイベントの5カテゴリ</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>「センシティブ」フラグを立てると別カードで管理されます</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>次回来店時のブリーフィングに自動で表示されます</span></li>
        </ul>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(160,120,212,0.08)', border: '1px solid rgba(160,120,212,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1" style={{ color: '#A078D4' }}>AI への渡し禁止</p>
          <p>
            Customer Memory の内容は LINE 提案・接客 AI（ProposalOrchestrator）には渡されません。
            スタッフが直接活用するための情報です。
          </p>
        </div>
      </div>
    ),
  },
  {
    id:    6,
    icon:  Shield,
    title: 'セキュリティと権限',
    color: '#E88C5A',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>スタッフごとにアクセスできる顧客情報が制限されています。</p>
        <ul className="space-y-2 pl-1">
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>担当顧客</strong>: 常時閲覧・編集可能</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>当日予約顧客</strong>: 当日のみ閲覧可能</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span><strong>共有顧客</strong>（担当未設定）: 全スタッフ閲覧可能</span></li>
          <li className="flex gap-2"><span style={{ color: '#D98292' }}>•</span><span>他スタッフ専任顧客のデータは見えません</span></li>
        </ul>
        <p className="text-[11px]" style={{ color: '#9E8090' }}>
          ログアウト後は顧客情報へのアクセスが遮断されます。共有端末では必ずログアウトしてください。
        </p>
      </div>
    ),
  },
  {
    id:    7,
    icon:  HelpCircle,
    title: 'よくある質問',
    color: '#9E8090',
    content: (
      <div className="space-y-4 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <div>
          <p className="font-semibold mb-1">Q. AI の提案が実際の顧客の状況と違う</p>
          <p style={{ color: '#6B4C4C' }}>
            A. AI は過去データをもとに生成しています。お客様の当日の状況を直接確認し、
            スタッフの判断を優先してください。フィードバックは管理者にご連絡ください。
          </p>
        </div>
        <div>
          <p className="font-semibold mb-1">Q. 音声メモが文字起こしされない</p>
          <p style={{ color: '#6B4C4C' }}>
            A. 現在、文字起こし機能はベータ版です。うまく認識されない場合はテキスト入力で
            直接修正してから保存してください。
          </p>
        </div>
        <div>
          <p className="font-semibold mb-1">Q. データが更新されない</p>
          <p style={{ color: '#6B4C4C' }}>
            A. 画面を下にスワイプして更新するか、一度ログアウトして再ログインしてください。
          </p>
        </div>
      </div>
    ),
  },
  {
    id:    8,
    icon:  Smartphone,
    title: 'ホーム画面に追加する方法',
    color: '#F5A0B5',
    content: (
      <div className="space-y-3 text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.7' }}>
        <p>ホーム画面に追加すると、アイコンからすぐにRiora OSを開けます。</p>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(245,160,181,0.08)', border: '1px solid rgba(245,160,181,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1" style={{ color: '#D98292' }}>iPhone(Safari)の場合</p>
          <p>共有ボタン(□に↑)をタップ →「ホーム画面に追加」を選択 →「追加」をタップ</p>
        </div>
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(120,168,216,0.08)', border: '1px solid rgba(120,168,216,0.2)' }}
        >
          <p className="font-semibold text-[12px] mb-1" style={{ color: '#78A8D8' }}>Android(Chrome)の場合</p>
          <p>右上のメニュー(︙)をタップ →「アプリをインストール」を選択</p>
        </div>
        <p className="text-[11px]" style={{ color: '#9E8090' }}>
          ※ LINEやInstagramなどアプリ内のブラウザで開いている場合は追加できません。
          「Safariで開く」または「ブラウザで開く」を選んでからお試しください。
        </p>
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
