'use client'
/**
 * /menu/features — 全機能紹介
 */
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Home, Users, Mic, User, Settings, Brain, Bell } from 'lucide-react'

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
      { title: 'ホームケアLINEメッセージ生成', desc: '購入いただいたホームケア商品ごとに、AIがお客様専用のメッセージを自動生成します。文章を一から考える手間がなく、お客様一人ひとりに合わせた丁寧なフォローがすぐに行えます' },
      { title: '購入当日の使い方カード生成',   desc: '商品の使用頻度・使うタイミング・注意点をカード形式でその場に表示します。購入直後のご案内がスムーズになり、「使い方を聞き忘れた」を防げます。専用メッセージもワンタップで用意できます' },
      { title: '7日後フォローメッセージ生成',  desc: 'ホームケア商品の購入から約1週間で「使い心地確認」のタイミングを通知でお知らせします。お客様の状態に合わせてAIにメッセージ下書きを作らせられるので、忘れずに、かつ負担なくフォローできます' },
      { title: 'お礼メッセージ生成',          desc: 'ご来店・ご購入の直後にも、AIがお客様の肌の状態や施術内容をふまえたお礼メッセージの下書きを作成します。感謝の気持ちを、毎回言葉に迷わず伝えられます' },
      { title: 'ワンタップコピーでLINE送信',   desc: '生成した文面は内容を確認・編集した上でワンタップでコピーできます。LINEアプリに貼り付けるだけで送信完了。アプリから自動送信されることはないため、安心して使えます' },
    ],
  },
  {
    icon:  Mic,
    title: 'メモタブ',
    color: '#52C87A',
    features: [
      { title: '音声メモ',   desc: '施術中に気づいたことをその場で録音するだけで記録が完了します。手書きでカルテを書く時間を大きく短縮できます' },
      { title: 'AI要約',     desc: '録音した内容からAIが自動で要点を抽出し、5つのカテゴリに整理して保存します。次回ご来店時のブリーフィングにも反映されるため、担当が変わってもスムーズに接客を引き継げます' },
      { title: '会話履歴検索(実装後)', desc: '過去のメモをキーワードで検索できるようになります' },
    ],
  },
  {
    icon:  Brain,
    title: 'AI提案',
    color: '#D98292',
    features: [
      { title: '次回来店のご提案', desc: 'AIが参考情報として次回のご提案を用意します。最終判断はスタッフが行います' },
      { title: 'ホームケア提案',   desc: 'お客様の肌質・購入履歴から、AIが次にご案内したいホームケア商品や使い方のヒントを提案します。押し売り感のない自然なご案内ができます' },
      { title: '関連ブログ提案',   desc: 'お客様の肌の悩みに関連する記事を自動でピックアップします。会話のきっかけや、ホームケア説明の補足として使えます' },
      { title: '提案履歴',        desc: '過去にAIが提案した内容は、お客様ごとのタイムラインで振り返ることができます。前回どんな提案をしたか思い出せるので、一貫性のある接客につながります' },
    ],
  },
  {
    icon:  Bell,
    title: '通知',
    color: '#9EB4D8',
    features: [
      { title: '今日の予約',   desc: '本日ご来店予定のお客様を通知でお知らせします。抜け漏れなく当日の準備ができます' },
      { title: '明日の予約',   desc: '前日の時点で明日のご来店予定をお知らせします。事前の準備時間を確保できます' },
      { title: '誕生日',      desc: 'お客様の誕生日が近づくと通知でお知らせします。お声がけのきっかけ作りに使えます' },
      { title: '重要フラグ',   desc: 'スタッフが「重要」として記録したメモがある場合、来店リマインドの中で優先的に表示されます。禁忌情報とあわせて必ず確認できます' },
      { title: '来店リマインド', desc: '予約の前日〜当日に、禁忌情報・重要メモ・直近の会話メモをまとめて通知します。接客前の最終確認がこの1つで完結します' },
    ],
  },
  {
    icon:  User,
    title: 'マイページ',
    color: '#D4A96A',
    features: [
      { title: '自分の実績確認',   desc: '退勤前に、ご自身の実績を振り返ることができます' },
      { title: '今週予約サマリー', desc: '今日・明日のご自身の予約を確認できます。退勤前や出勤直後に、今後の流れをすぐに把握できます' },
      { title: '今月のひとこと',   desc: '今月の接客を踏まえた、前向きなひとことコメントが表示されます。他のスタッフとの比較やランキングは一切行いません' },
      { title: '先月比',         desc: '指名率・リピート率・店販売上について、ご自身の先月との比較を確認できます。他スタッフとの比較は行わず、自分自身の変化だけを振り返れます' },
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
