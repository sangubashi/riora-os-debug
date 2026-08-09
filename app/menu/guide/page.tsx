'use client'
/**
 * /menu/guide — Riora OS スタッフ向け利用ガイド
 *
 * PHASE GUIDE-REFRESH-1(2026-08-09): 実装とのズレを解消するため全面更新。
 * 6並列調査(今日タブ/通知・顧客タブ/CustomerBottomSheet・メモタブ/音声パイプライン・
 * AI提案・LINE・マイページ「そろそろ」判定/設定タブ)でコードを直接確認した内容のみを
 * 記載する。未実装・検討中の機能、実装と異なる文言(「今週の予約スケジュール」
 * 「来店サイクル予測」「AIが正確に文字起こし」「自動で算出」「会話履歴検索(実装後)」等)は
 * 含めない。/lineチャット画面(モックデータのまま)はスタッフが実際に使える機能ではないため
 * 本ガイドには記載しない。
 */
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface CardProps {
  emoji: string
  title: string
  color: string
  children: React.ReactNode
}

/** カード(アイコン付きヘッダー+区切り線+本文)。 */
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

/** カード内の小見出し(太字)。 */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold" style={{ color: '#4A2C2A', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
      {children}
    </p>
  )
}

/** 本文行。 */
function T({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px]" style={{ color: '#4A2C2A', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>
      {children}
    </p>
  )
}

/** 補足行(やや小さめ・淡色。注意点や限界の説明に使う)。 */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px]" style={{ color: '#9E8090', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
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

      {/* コンテンツ */}
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
            <T>スタッフの皆様の日々の接客をサポートする専用アプリです。</T>
            <T>「お客様の情報をすぐに確認できる」「AIの提案を参考にできる」「禁忌事項やうっかり忘れを防げる」——そんな、接客に集中するためのツールです。</T>
            <T>AIが自動で判断・実行することはありません。AIの提案・下書きはすべて参考情報で、最終判断は必ずスタッフの皆様が行います。</T>
          </Card>

          <Card emoji="⏰" title="まず覚える「1日の使い方」" color="#6BA88C">
            <SubHead>【来店前】</SubHead>
            <T>今日タブでこれからのご来店を確認し、「今日、気をつけること」(禁忌・触れない話題など)に必ず目を通しておきます。ベルアイコンの通知に来店リマインドが届いていないかもあわせて確認します。</T>
            <SubHead>【接客中】</SubHead>
            <T>必要に応じて顧客タブからお客様の来店履歴・前回の施術内容を確認します。「今日の接客ポイント」などのAI提案は参考にしつつ、お客様の様子を見ながら最終的な判断はご自身で行います。</T>
            <SubHead>【接客後】</SubHead>
            <T>メモタブから音声メモを録音します。保存前に必ず文字起こしの内容を確認し、違っていれば修正します。ホームケア商品をご購入いただいた場合は、LINEメッセージの下書きを作り、内容を確認・編集してからコピーし、LINEアプリから送信します。</T>
            <SubHead>【すきま時間】</SubHead>
            <T>マイページで自分の実績を確認したり、顧客タブの会話メモ検索で過去のやり取りを振り返ったりできます。</T>
          </Card>

          <p className="text-[12px] font-semibold tracking-[0.1em] px-1" style={{ color: '#C8A8B0' }}>
            📱 5つのタブ
          </p>

          <Card emoji="📅" title="1. 今日タブ" color="#F5A0B5">
            <SubHead>今日のブリーフィング</SubHead>
            <T>本日ご来店予定の人数に加え、禁忌事項があるお客様・初めてのご来店のお客様・重要な申し送りがあるお客様・再来推奨日を過ぎたお客様・ホームケアをご案内できそうなお客様・お誕生日のお客様など、今日確認しておきたいお客様の件数がまとまって表示されます。件数をタップすると、該当するお客様の詳細をすぐに開けます。</T>
            <SubHead>来店前30秒ブリーフィング</SubHead>
            <T>「次のお客様まであと◯分」というカードで、お名前・来店回数・タイプ・担当・予約時刻が表示されます。カードを開くと、予約メニュー・前回のご来店日・前回の施術内容・注意事項・引き継ぎメモなども確認できます。</T>
            <SubHead>今日、気をつけること（最大3行）</SubHead>
            <T>禁忌事項・触れない話題・今日意識したいポイントが、優先順に最大3行で表示されます。</T>
            <SubHead>くわしく見る（折りたたみ）</SubHead>
            <T>前回施術の詳細、予約の備考、覚えておくこと、AIによるまとめ、AI Timelineへのリンクを開けます。</T>
            <SubHead>このあとの予約</SubHead>
            <T>本日これからご来店予定のお客様を時刻順に一覧表示します。すでに完了した予約も折りたたみで確認できます。</T>
            <Note>画面上部には本日の予約件数・要注意のお客様の件数・LINEの未返信件数も表示されます。「今週の売上」は店舗全体の数値のため、一般スタッフの画面には表示されません。</Note>
          </Card>

          <Card emoji="👤" title="2. 顧客タブ" color="#78A8D8">
            <SubHead>顧客一覧・検索</SubHead>
            <T>お名前・来店回数・累計売上・最終来店日を一覧で確認できます。名前・タイプ・担当者名・施術名での検索、「私のお客様」「全顧客」の切り替え、来店日順・売上順での並び替えができます。</T>
            <SubHead>会話メモ検索</SubHead>
            <T>検索バーに2文字以上入力すると、過去の会話メモ・カルテメモ・音声メモの文字起こし・AI要約を、お客様をまたいで横断的に検索できます。</T>
            <SubHead>お客様をタップすると開く「顧客情報」</SubHead>
            <T>・基本情報（お名前・来店回数など）</T>
            <T>・禁忌事項：画面の最上部に固定表示されます。過去の会話メモ・音声メモに含まれるキーワードをもとに、システムが自動で検出して表示するものです（AIによる判断ではありません）。内容が正しいか必ず確認し、間違っていれば削除できます。</T>
            <T>・今日気をつけること：アレルギーや触れない話題など。</T>
            <T>・来店履歴・前回施術：来店日・メニュー・金額を確認できます。</T>
            <T>・覚えておくこと（Customer Memory）：家族・記念日・趣味・仕事・ライフイベント・旅行・ペット・その他の8カテゴリで、スタッフが手入力で記録・編集できます（AIによる自動記録ではありません）。</T>
            <T>・肌タグ：肌の状態を表すタグを手動で編集できます。</T>
            <T>・ホームケア商品・LINEメッセージ機能（詳しくは「5. LINE」を参照）</T>
            <T>・カルテ取込：カルテの文章を貼り付けるとAIが項目を抽出しますが、自動保存はされません。抽出候補をチェックボックスで確認し、必要なものだけを選んで保存します。</T>
            <T>・AI Timeline：来店やAI提案などの記録を時系列で確認できるタブです。AIによるまとめ（このお客様はどんな人か／最近の変化／今回意識すること／注意点）や、会話のきっかけ、お祝いカードもここに表示されます。</T>
            <T>・接客の記録：「LINE送信した」「ホームケア説明した」などをワンタップで記録できるボタンと、来店ごとの接客ログ（次回予約の有無・AI提案を使ったか等）を保存できる画面があります。</T>
          </Card>

          <Card emoji="🎤" title="3. メモタブ" color="#52C87A">
            <T>本日ご来店予定のお客様を選んで、音声メモを録音できます（最大30秒）。</T>
            <SubHead>録音してから保存するまで</SubHead>
            <T>録音を止めると確認画面が開きます。音声を再生し、文字起こしの内容を確認できます。文字起こしが間に合っていない場合は「準備中」と表示されることがあります。内容が違う場合や、まだ表示されていない場合は編集欄で修正・入力してから保存してください。保存後は5秒間だけ取り消しができます。</T>
            <SubHead>保存したあと</SubHead>
            <T>保存すると、AIが自動で文字起こし・要約を行い、家族／仕事／体調・肌悩み／趣味・好み／イベントの5カテゴリに整理して保存します。処理には少し時間がかかることがあります。過去メモ一覧で「解析中」「解析完了」「解析失敗」の状態を確認でき、失敗した場合は再解析もできます。</T>
            <Note>音声の文字起こしはAIが自動で行いますが、完璧ではなく聞き間違いが起こることがあります。保存前に必ず内容を確認・修正する運用にしています。</Note>
            <SubHead>その他</SubHead>
            <T>過去メモは直近10件を一覧表示し、再生・削除ができます。メモタブ内の検索は、選択中のお客様1名分の音声メモが対象です。複数のお客様をまたいで検索したいときは、顧客タブの会話メモ検索をご利用ください。保存したメモは、そのお客様のAI Timelineにも反映されます。</T>
          </Card>

          <p className="text-[12px] font-semibold tracking-[0.1em] px-1" style={{ color: '#C8A8B0' }}>
            🤖 AI提案・LINE・通知
          </p>

          <Card emoji="🤖" title="4. AI提案" color="#D98292">
            <T>AI提案はすべて参考情報です。お客様の予約データ・来店データや、記録済みのメモをもとに表示されるもので、内容を採用するかどうかはスタッフが判断します。アプリが自動で予約を変えたり、メッセージを送ったりすることはありません。</T>
            <SubHead>今日の接客ポイント</SubHead>
            <T>顧客情報の画面やAI Timelineに表示される、その日の接客で意識したいポイントです。過去の来店パターンや、記録された重要メモをもとに表示されます。</T>
            <SubHead>次回来店のご提案</SubHead>
            <T>過去の来店データをもとに、次回のご来店タイミングの目安やお声がけの例が表示されます。あくまで目安であり、最終的なご案内はスタッフが判断します。</T>
            <SubHead>ホームケア提案</SubHead>
            <T>お客様の肌質や購入履歴をもとに、ご案内に使えるホームケアの一言が表示されます。</T>
            <SubHead>関連ブログ</SubHead>
            <T>ご購入いただいた商品に関連するブログ記事のタイトルが表示されます。会話のきっかけや、ホームケア説明の補足として使えます。</T>
            <SubHead>会話のきっかけ</SubHead>
            <T>AI Timeline内に表示されます。記録されている家族・趣味・記念日などの情報をもとに、AIが会話の糸口になる一言を作成します。商品や来店を勧める内容にはならない設計です。</T>
            <SubHead>提案履歴</SubHead>
            <T>これまでにAIが表示した提案は、そのお客様のAI Timeline上に記録として残るため、あとから振り返ることができます。</T>
          </Card>

          <Card emoji="💬" title="5. LINE" color="#34A070">
            <T>LINEはこのアプリから自動で送信されることはありません。「AIが文面を作る → 内容を確認・編集する → コピーする → LINEアプリに貼り付けてスタッフご自身が送信する」という流れです。</T>
            <SubHead>メッセージの下書き作成</SubHead>
            <T>顧客情報の画面から、ホームケア商品ごとの使い方メッセージや、来店お礼・ホームケア提案・来店リマインドのメッセージ下書きをAIに作成させることができます。生成された文面は自由に編集できます。</T>
            <SubHead>コピーして送信</SubHead>
            <T>内容を確認したら「コピー」ボタンでコピーし、LINEアプリに貼り付けてご自身で送信してください。</T>
            <SubHead>送信履歴・送信済み表示</SubHead>
            <T>「コピーした」タイミングをもとに、いつどんな種類のメッセージ文面を用意したかが顧客ごとに記録され、「本日送信済み」「7日以内送信済み」といった目印が表示されます。実際にLINEで送信されたかどうかまでは記録されないため、あくまで目安としてご利用ください。</T>
            <SubHead>重複への注意表示</SubHead>
            <T>同じ種類の文面を短時間で続けてコピーしようとすると、注意が表示されます。コピー自体は止まらないため、送るかどうかは最終的にスタッフが判断してください。</T>
          </Card>

          <Card emoji="🔔" title="6. 通知" color="#9EB4D8">
            <SubHead>来店リマインド</SubHead>
            <T>本日・明日にご来店予定のお客様について、禁忌事項・重要なメモ・直近の会話メモをまとめて通知します。「重要」として記録されたメモがある場合は、この通知の中で優先的に表示されます（重要フラグだけの独立した通知ではありません）。</T>
            <SubHead>誕生日・記念日</SubHead>
            <T>お誕生日が近づくと通知します（誕生日として記録されているメモが対象）。来店1周年や、ご結婚の予定日が近いお客様にもお知らせします。</T>
            <SubHead>ホームケア関連</SubHead>
            <T>商品ご購入直後の使い方案内、購入から1週間前後での使い心地確認、そろそろ商品を使い切りそうなタイミングを、来店予定日と重ならないように順番にお知らせします（同じお客様には1日1件まで）。</T>
            <SubHead>しばらくご来店のないお客様・新しいご予約</SubHead>
            <T>最終のご来店から日数が経っているお客様や、新しく入ったご予約もお知らせします。</T>
            <Note>通知は1日あたり最大5件まで、優先度の高いものから表示されます。件数が多い日は、表示されない通知もあります。</Note>
          </Card>

          <p className="text-[12px] font-semibold tracking-[0.1em] px-1" style={{ color: '#C8A8B0' }}>
            📈 自分の実績・設定
          </p>

          <Card emoji="📈" title="7. マイページ" color="#D4A96A">
            <T>先月のご自身の実績（売上・来店人数・客単価・指名率・リピート率・店販売上）や、先月・先週との比較コメントを確認できます。他のスタッフとの比較やランキングは一切行いません。</T>
            <T>「今週の予約」には、今日・明日にご自身が担当されるご予約の件数が表示されます。「明日の担当」では、明日ご来店予定のお客様の注意事項も確認できます。</T>
            <SubHead>そろそろの方</SubHead>
            <T>ホームケア商品をそろそろ使い切りそうなお客様が表示されます。過去のご購入日と、商品カテゴリごとのだいたいの使用目安日数（例：洗顔料や化粧水は1か月弱、日焼け止めは1か月半ほど）をもとに、使い切りに近づいたタイミングで表示する仕組みです。AIによる予測ではなく、購入日からの経過日数で自動的に判定しています。</T>
            <Note>すべての商品が対象ではなく、対象外の商品（マスクやサンプル等）は表示されません。ご来店予定日の前後には表示されず、他の通知が多い日は表示されないこともあります。「そろそろの方」に出ていないからといって、補充のご案内が不要とは限らないため、気になる場合は顧客タブの購入履歴もあわせてご確認ください。タップするとそのお客様の詳細画面が開きます。</Note>
            <SubHead>今月のひとこと</SubHead>
            <T>今月の実績をふまえた、前向きなひとことコメントが表示されます。こちらも他スタッフとの比較は行いません。</T>
            <SubHead>パスワードの変更</SubHead>
            <T>マイページから、ログイン用パスワードを変更できます。</T>
          </Card>

          <Card emoji="⚙️" title="8. 設定タブ" color="#9E8090">
            <T>設定タブの中身は、主に店舗のメニュー実績情報の確認画面です。画面下部から「使い方ガイド」（このページ）を開くことができます。</T>
            <T>ログアウトはこの設定タブから行います。パスワードの変更は設定タブではなく、マイページ側にあります。</T>
            <Note>通知のオン・オフなど、個別の設定を切り替える機能は現在ありません。</Note>
          </Card>

          <Card emoji="🔒" title="9. セキュリティ・情報管理" color="#6B95BE">
            <T>・お客様情報は必要な範囲のみを保存し、安全な環境で管理しています。</T>
            <T>・確認できるお客様の情報は、担当や当日の予約状況などに応じて範囲が決まっています。</T>
            <T>・禁忌事項やお客様の個人的な情報は、業務目的以外に使用しないでください。</T>
            <T>・音声メモやLINE文面の作成などAI機能を使う際は、必要な情報だけが使われます。</T>
            <T>・LINEの送信は必ずスタッフご自身の操作で行われ、アプリから自動送信されることはありません。</T>
            <T>・お客様の情報やアプリ内のデータを、外部やSNS等へ持ち出したり掲載したりしないようお願いします。</T>
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

          <Card emoji="❓" title="よくある質問" color="#9E8090">
            <T>━━━━━━━━━━━━━━━━━━</T>
            <T>Q. ログインできません</T>
            <T>A. メールアドレス・パスワードを確認してください。</T>
            <T>Q. パスワードを忘れました</T>
            <T>A. ログインできる場合はマイページからパスワードを変更してください。ログインできない場合は管理者へお問い合わせください。</T>
            <T>Q. 音声メモが保存されません</T>
            <T>A. マイク権限が有効になっているか確認してください。</T>
            <T>Q. 文字起こしの内容が違います</T>
            <T>A. AIによる自動文字起こしのため、聞き間違いが起こることがあります。保存前に内容を確認し、間違っていれば修正してください。</T>
            <T>Q. AI提案は必ず使わないといけませんか？</T>
            <T>A. AIの提案・下書きはすべて参考情報です。最終判断はスタッフが行ってください。</T>
            <T>Q. LINEは自動で送られますか？</T>
            <T>A. 送られません。文面を確認・編集してコピーし、LINEアプリからご自身で送信してください。</T>
            <T>Q. 「そろそろの方」に表示されないお客様がいます</T>
            <T>A. 対象外の商品があることや、通知の件数上限、他の通知の優先表示により表示されないことがあります。気になる場合は顧客タブの来店・購入履歴もご確認ください。</T>
            <T>━━━━━━━━━━━━━━━━━━</T>
          </Card>
        </div>
      </div>
    </div>
  )
}
