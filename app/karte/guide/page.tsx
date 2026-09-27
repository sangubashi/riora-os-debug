'use client'
/**
 * /karte/guide — iPadカルテ画面(/karte)専用の使い方ガイド(2026-09-27ユーザー承認・第一弾)。
 *
 * app/menu/guide/page.tsx(スマホアプリ5タブ用)と同じ方針: 静的JSXにハードコード
 * (DB・APIなし)、実装されている事実のみを記載する。対象コードを直接読んで確認した
 * 内容のみを書き、未実装・一時停止中の機能(今回のホームケア・次回の目安カード。
 * IpadStaffKarteView.tsx/CustomerModeView.tsxのSHOW_HOMECARE/SHOW_NEXT_VISIT_ESTIMATEが
 * 共にfalseのため現在は非表示)・削除済みの導線(「接客ログ/AI Timeline」ボタン、
 * IpadStaffKarteView.tsxの写真カルテセクション)は載せない。
 *
 * 今後機能を追加・変更した場合は、この画面の記載も一緒に更新すること
 * (app/menu/guide/page.tsxと同じ運用ルール)。
 */
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

interface CardProps {
  emoji: string
  title: string
  children: React.ReactNode
}

/** カード(絵文字付きヘッダー+区切り線+本文)。/karte側のPALETTEに合わせた配色。 */
function Card({ emoji, title, children }: CardProps) {
  return (
    <div
      style={{
        background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '18px',
        overflow: 'hidden', boxShadow: PALETTE.shadow,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 20px',
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <span style={{ fontSize: '18px', flexShrink: 0 }}>{emoji}</span>
        <span
          style={{
            fontSize: '15px', fontWeight: 700, color: PALETTE.text, lineHeight: 1.5,
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {children}
      </div>
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: PALETTE.text, lineHeight: 1.8 }}>
      {children}
    </p>
  )
}

function T({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: '13px', color: PALETTE.text, lineHeight: 1.8 }}>
      {children}
    </p>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.7 }}>
      {children}
    </p>
  )
}

export default function KarteGuidePage() {
  const router = useRouter()

  return (
    <div style={{ minHeight: '100dvh', background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ヘッダー */}
      <div
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 28px 16px',
          borderBottom: `1px solid ${PALETTE.border}`, background: PALETTE.bg,
        }}
      >
        <button
          type="button"
          onClick={() => router.push('/karte')}
          aria-label="/karteへ戻る"
          style={{
            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
            background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={18} color={PALETTE.gold} />
        </button>
        <div>
          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.15em', color: PALETTE.muted }}>SALON RIORA</p>
          <p
            style={{
              margin: 0, fontSize: '20px', color: PALETTE.gold, letterSpacing: '0.01em',
              fontFamily: headingFont.style.fontFamily,
            }}
          >
            カルテ画面の使い方
          </p>
        </div>
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 48px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          <Card emoji="🌟" title="このガイドについて">
            <T>iPad専用のカルテ画面(/karte)で使える機能をまとめています。スマートフォンアプリ(顧客タブ等)側の使い方は別ガイド(メニュータブ内)をご覧ください。</T>
            <Note>今ある機能のみを載せています。機能が追加・変更されたら、このページも合わせて更新します。</Note>
          </Card>

          <Card emoji="🔍" title="① 顧客を探す(/karte のトップ画面)">
            <SubHead>本日の予約</SubHead>
            <T>検索欄が空のときは、本日ご来店予定のお客様が時刻順に一覧表示されます。タップすると顧客トップページが開きます。</T>
            <SubHead>顧客検索</SubHead>
            <T>検索欄にお名前を入力すると絞り込まれます。漢字を入力すると氏名への部分一致で検索します。</T>
            <T>ひらがな・カタカナを入力すると、フリガナの「姓」の読みへの前方一致で検索します(例: 「くろだ」「クロダ」→黒田様)。名(下の名前)のフリガナは検索対象外です。</T>
            <Note>フリガナが未登録のお客様は、かな検索ではヒットしません。フリガナはSalonBoard CSV取込(売上明細・予約一覧)で自動的に登録されます。</Note>
          </Card>

          <Card emoji="📇" title="② 顧客トップページ(カルテTOP)">
            <T>本日の予約または検索結果からお客様をタップすると開きます。</T>
            <SubHead>基本情報</SubHead>
            <T>フリガナ・お名前・生年月日(鉛筆アイコンから編集可能)・性別を確認できます。</T>
            <SubHead>初回カウンセリング表</SubHead>
            <T>紙の問診票等をスキャンした画像を1枚だけ登録できます(顧客ごとに1件、常に上書き)。「撮影・登録する」からカメラ撮影または画像選択で登録し、サムネイルをタップすると拡大表示します。</T>
            <SubHead>LINE</SubHead>
            <T>LINEアカウントとの紐付け状況・最新メッセージのプレビューを確認できます。「LINEを開く」でスレッドを表示、鉛筆アイコンで紐付けの変更ができます。</T>
            <SubHead>契約書・その他資料</SubHead>
            <T>資料1〜4の4枠に、契約書等の写真を登録できます。空いている枠をタップすると撮影・選択、登録済みの枠をタップすると拡大表示(拡大表示から差し替えも可能)。</T>
            <SubHead>詳細ページを見る</SubHead>
            <T>ゴールドのボタンをタップすると、来店履歴・写真カルテ等が見られる詳細ページ(/karte/[顧客ID])へ進みます。</T>
          </Card>

          <Card emoji="🔁" title="③ お客様用カルテ ⇔ スタッフ用カルテの切り替え">
            <T>詳細ページを開くと、まず「お客様用カルテ」が表示されます(お客様に画面をお見せしながら操作する前提の画面)。</T>
            <SubHead>スタッフ用への切り替え</SubHead>
            <T>お客様用カルテ右上の「Staff Karte」ボタンをタップ→4桁PINを入力すると、スタッフ専用の内部情報が見られる「スタッフ用カルテ」に切り替わります(PIN: 1234)。</T>
            <SubHead>お客様用への切り替え</SubHead>
            <T>スタッフ用カルテ左上の「お客様用カルテへ戻る」ボタンでいつでも戻れます(PIN不要)。</T>
            <Note>同じお客様を表示している間は画面を切り替えてもデータの再取得が起きないため、行き来しても待ち時間はほぼ発生しません。</Note>
          </Card>

          <Card emoji="🖼" title="④ お客様用カルテ: 過去の写真の比較">
            <T>角度タブ(正面・右斜め・左斜め・額)を切り替えながら、2枚の写真を並べて比較表示します。</T>
            <SubHead>比較の切り替え(3種類)</SubHead>
            <T>・前回↔今回: 直近の来店時の写真と最新の写真を比較</T>
            <T>・初回↔今回: 一番最初の来店時の写真と最新の写真を比較(初回来店から日数が経っている場合のみ表示)</T>
            <T>・🔀自由選択: 来店回・角度を問わず、「過去の写真」一覧から任意の2枚を自分で選んで比較(1枚目→2枚目の順にタップ。3枚目をタップすると1枚目が外れて2枚目が繰り上がります。「選び直す」でクリア)</T>
            <SubHead>スライダーで比較</SubHead>
            <T>写真エリア上部の「スライダーで比較」から、2枚を重ねてスライダーで境目を動かしながら見比べるモーダルを開けます。</T>
            <Note>写真をタップすると拡大表示(ピンチズーム対応)します。</Note>
          </Card>

          <Card emoji="📸" title="⑤ 写真の撮影・追加・削除(お客様用カルテ画面から)">
            <T>比較エリアの下にある「撮影する」「選択して追加」「写真を削除」から操作します(スタッフ用カルテには写真の操作機能はありません)。</T>
            <SubHead>撮影時の流れ</SubHead>
            <T>角度(正面・右斜め・左斜め・額)を選ばないとシャッターは押せません。画面の丸い破線の枠にお顔を収めると案内メッセージが緑色に変わりますが、これは位置合わせの目安表示で、撮影自体は右側のシャッターボタンをタップして行います(自動撮影ではありません)。</T>
            <T>シャッターを押すと1.5秒後に自動的に保存されます(その間に「撮り直す」を選ぶこともできます)。</T>
            <SubHead>ゴースト機能</SubHead>
            <T>前回撮影した写真を薄く重ねて表示し、同じ角度・同じ距離で撮影しやすくする機能です。ON/OFF・重ねる強さを調整できます。</T>
            <SubHead>傾きガイド</SubHead>
            <T>iPadの傾きを検知して水平を案内します(初回のみiOSの許可が必要な場合があります)。</T>
            <Note>「1x」等のズーム表示は目安のみで、実際にズーム倍率が変わるわけではありません。</Note>
          </Card>

          <Card emoji="🖊" title="⑥ 顔シェーマ(スタッフ用カルテ)">
            <T>顔のイラストの上に、ニキビ・赤み・気になる部位などを描き込んで記録できる機能です。「顔シェーマを表示する」をタップすると開きます。</T>
            <SubHead>使い方</SubHead>
            <T>上部の色スウォッチ(8色)から色を選んでそのまま指やApple Pencilで描き込みます。消しゴムアイコンで一部だけ消すこともできます。「元に戻す」「全消去」「保存する」ボタンがあります。</T>
            <SubHead>前回のシェーマ</SubHead>
            <T>前回記録したシェーマがある場合は「前回のシェーマ」から見比べたり、「前回のシェーマを読み込む(コピー)」でそのまま複製して描き直せます。</T>
          </Card>

          <Card emoji="📝" title="⑦ カルテメモ・来店履歴(スタッフ用カルテ)">
            <SubHead>カルテメモ</SubHead>
            <T>当日の施術内容や気づきを自由記述で記録できます。前回の来店日・メニュー・施術メモをワンタップで参照できます。</T>
            <SubHead>来店履歴</SubHead>
            <T>これまでの来店日を一覧表示し、タップするとその日のカルテメモ・顔シェーマを展開して参照できます(閲覧専用)。アプリ導入前の来店で記録が無い日は、「この来店日のメモを追加」からSalonBoard等のメモを貼り付けて日付付きで登録できます。</T>
          </Card>

          <Card emoji="📋" title="⑧ 重要事項・顧客ステータス・サロンボード情報(スタッフ用カルテ)">
            <SubHead>重要事項</SubHead>
            <T>登録されている禁忌事項がある場合のみ、画面上部に表示されます(この画面では表示のみで、登録・編集はできません)。</T>
            <SubHead>顧客ステータス</SubHead>
            <T>最終来店日・来店回数・来店周期の目安・前回来店から経過・次回来店目安・店販購入ステータス(商品ごと、アコーディオンで開閉)を自動集計で表示します。入力不要です。</T>
            <T>「来店周期の目安」は、直近の来店(最大5回)の来店日の間隔の中央値です。来店が2回以上ないと算出できず、その場合は「算出データ不足」と表示されます(来店1回以下の場合、隣の「次回来店目安」だけは施術メニューごとの標準的な目安日数で算出されることがあります)。次回のご予約が既に入っている場合やスタッフが目安日を手動設定している場合は、そちらが優先され「来店周期の目安」欄自体は算出されません。</T>
            <SubHead>サロンボード情報</SubHead>
            <T>電話番号・初回来店日・来店回数・来店きっかけを表示します。「サロンボード情報を取り込む」からSalonBoardのテキストを貼り付けて更新できます。</T>
          </Card>

          <Card emoji="👥" title="⑨ 店舗共通ログイン時の担当者選択">
            <T>iPadを店舗共通アカウントでログインしている場合のみ、初回操作時に「担当スタッフを選択してください」という画面が出ます。選んだ担当者は2時間、他のお客様のカルテを開いても保持されます。</T>
            <T>ヘッダーの「担当: ◯◯」チップをタップすると、2時間待たずにいつでも選び直せます。</T>
            <Note>個人アカウントでログインしている場合は、この画面は表示されません。</Note>
          </Card>

        </div>
      </div>
    </div>
  )
}
