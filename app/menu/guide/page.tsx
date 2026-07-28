'use client'
/**
 * /menu/guide — Riora OS スタッフ向け利用ガイド
 *
 * ユーザーから提供された原文をそのまま表示する(要約・箇条書き化・文章の追加削除は
 * 禁止)。行の区切り・見出し・番号・文言はすべて原文どおり。今回はFeaturesページに
 * 揃えたカードデザインへの変更のみ(アイコン・区切り線・余白は装飾であり原文の
 * 文字ではないため追加している)。
 */
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface CardProps {
  emoji: string
  title: string
  color: string
  children: React.ReactNode
}

/** Featuresページと同じ構成のカード(アイコン付きヘッダー+区切り線+本文)。 */
function Card({ emoji, title, color, children }: CardProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid #F5E6E8',
        boxShadow: '0 2px 10px rgba(245,160,181,0.08)',
      }}
    >
      <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid #F5E6E8' }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[18px]"
          style={{ background: `${color}18` }}
        >
          {emoji}
        </div>
        <span className="text-[15px] font-bold" style={{ color: '#4A2C2A', lineHeight: '1.5' }}>
          {title}
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {children}
      </div>
    </div>
  )
}

/** カード内の小見出し(【来店前】【iPhone】等・太字。文字は変更しない)。 */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold" style={{ color: '#4A2C2A', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
      {children}
    </p>
  )
}

/** 本文行(原文どおり)。 */
function T({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
      {children}
    </p>
  )
}

export default function GuidePage() {
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
              Guide
            </h1>
            <p className="text-[10px] tracking-widest" style={{ color: '#9E8090' }}>使い方ガイド</p>
          </div>
        </div>
      </div>

      {/* コンテンツ(原文そのまま・カードデザインのみ変更) */}
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{
          paddingBottom: 'calc(32px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        <div className="px-4 pt-4 space-y-5">
          <p className="text-[20px] font-bold text-center px-1" style={{ color: '#4A2C2A' }}>
            Riora OS スタッフ向け利用ガイド
          </p>

          <Card emoji="🌟" title="Riora OS（リオラ オーエス）とは？" color="#D98292">
            <T>スタッフの皆様の日々の接客を強力にサポートする専用アプリです。</T>
            <T>「お客様の情報をすぐに確認できる」「次に何を提案すればいいかが一目でわかる」「うっかりミスや忘れ物を防いでくれる」—そんな、接客に集中するためのパートナーツールです。</T>
          </Card>

          <p className="text-[12px] font-semibold tracking-[0.1em] px-1" style={{ color: '#C8A8B0' }}>
            📱 毎日使う6つの主要機能
          </p>

          <Card emoji="📅" title="1. 今日の予約・通知" color="#F5A0B5">
            <T>予約の一元管理： 今日・今週の予約スケジュールがひと目でわかります。</T>
            <T>事前アラート： 来店前に「このお客様の注意点」が通知されます。</T>
            <T>記念日リマインダー： 誕生日など、お祝い対象のお客様を事前にお知らせします。</T>
          </Card>

          <Card emoji="👤" title="2. 顧客情報（Customer Bottom Sheet）" color="#78A8D8">
            <T>お客様の名前をタップするだけで、以下の詳細データがすぐにポップアップで確認できます。</T>
            <T>基本情報 / 来店履歴</T>
            <T>過去の会話メモ</T>
            <T>禁忌事項・重要フラグ（※必ず最初にご確認ください）</T>
            <T>前回の提案内容</T>
          </Card>

          <Card emoji="🤖" title="3. AI提案サポート" color="#D98292">
            <T>パーソナライズ提案： お客様一人ひとりに合ったホームケアや次回の施術プランを自動で算出して表示します。</T>
            <T>関連ブログ連携： お客様の悩みに合わせたブログ記事がすぐに見つかります。</T>
            <T>来店サイクル予測： 「次回はいつ頃のご来店がベストか」の目安を提案します。</T>
          </Card>

          <Card emoji="🎤" title="4. 音声メモ" color="#52C87A">
            <T>接客が終わったら、スマホに向かって話すだけで自動でメモが残ります。</T>
            <T>AIが音声を正確に文字起こしするため、カルテ入力の手間が大幅に削減されます。</T>
          </Card>

          <Card emoji="💬" title="5. LINEメッセージ作成" color="#34A070">
            <T>ホームケアの案内や、心のこもったお礼メッセージをAIが自動で下書きします。</T>
            <T>内容を確認してコピーするだけで、スムーズにLINE送信が可能です。</T>
          </Card>

          <Card emoji="📈" title="6. My Page（マイページ）" color="#D4A96A">
            <T>自分の「指名数」「リピート率」「店販実績」を先月と比較してグラフや数字で確認できます。</T>
            <T>日々の頑張りがリアルタイムで可視化されます。</T>
          </Card>

          <Card emoji="⏰" title="シーン別・使い方の流儀" color="#6BA88C">
            <SubHead>【来店前】</SubHead>
            <T>通知と顧客情報をチェックし、禁忌・重要フラグや前回までの会話内容を頭に入れておきます。</T>
            <SubHead>【接客中】</SubHead>
            <T>必要に応じてAI提案を参考にし、お客様に最適なホームケアや次回周期をご案内します。</T>
            <SubHead>【接客後】</SubHead>
            <T>すぐに音声メモを残し、次回の提案内容を確定させます。</T>
            <SubHead>【スキマ時間】</SubHead>
            <T>「My Page」で自分の実績数値をチェックし、モチベーションアップや目標管理に活かします。</T>
          </Card>

          <Card emoji="⚠️" title="ご利用上の大切な注意点" color="#E88C5A">
            <T>禁忌・重要フラグの徹底： トラブル防止のため、アレルギーや施術上の注意事項（フラグ）は必ず事前に目を通してください。</T>
            <T>AI提案は「アシスト」： AIの提案はあくまで参考情報です。お客様の表情やその日のコンディションを見ながら、最終的な判断はスタッフの皆様が行ってください。</T>
            <T>情報管理の厳守： お客様の個人情報やアプリ内のデータを外部に持ち出したり、SNS等へ掲載したりしないよう徹底をお願いします。</T>
          </Card>

          <Card emoji="📲" title="ホーム画面への追加方法" color="#F5A0B5">
            <T>━━━━━━━━━━━━━━━━━━</T>
            <SubHead>【iPhone】</SubHead>
            <T>1. SafariでRiora OSを開く</T>
            <T>2. 共有ボタンを押す</T>
            <T>3. 「ホーム画面に追加」を選択</T>
            <T>4. 「追加」を押して完了</T>
            <SubHead>【Android】</SubHead>
            <T>1. ChromeでRiora OSを開く</T>
            <T>2. メニュー（︙）を押す</T>
            <T>3. 「ホーム画面に追加」を選択</T>
            <T>4. 「追加」を押して完了</T>
            <T>━━━━━━━━━━━━━━━━━━</T>
          </Card>

          <Card emoji="❓" title="FAQ" color="#9E8090">
            <T>━━━━━━━━━━━━━━━━━━</T>
            <T>Q. ログインできません</T>
            <T>A. メールアドレス・パスワードを確認してください。</T>
            <T>Q. パスワードを忘れました</T>
            <T>A. 設定 → パスワード変更、または管理者へお問い合わせください。</T>
            <T>Q. 音声メモが保存されません</T>
            <T>A. マイク権限が有効になっているか確認してください。</T>
            <T>Q. AI提案は必ず使わないといけませんか？</T>
            <T>A. AIは接客を補助するための機能です。最終判断はスタッフが行ってください。</T>
            <T>━━━━━━━━━━━━━━━━━━</T>
          </Card>
        </div>
      </div>
    </div>
  )
}
