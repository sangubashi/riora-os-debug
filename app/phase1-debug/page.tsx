'use client'
/**
 * /phase1-debug — 完全オフライン検証ページ
 *
 * - Supabase・認証・API通信を全て無効化
 * - ダミーデータのみで全機能を動作させる
 * - phase1 本体・本番コードは一切変更しない
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type {
  Customer, Reservation, SkinTagKey,
  ServicePhase, DisplaySection,
  HomecarePlan, ServiceReplay,
} from '@/types'
import {
  SKIN_TAG_LABELS, SKIN_TAG_KEYS, ACTION_TYPE_LABELS,
} from '@/types'
import { generateHomecarePlan } from '@/lib/homecare/generateHomecarePlan'
import { getReturnTiming } from '@/lib/homecare/generateHomecarePlan'
import { buildServiceReplay } from '@/lib/phase5/serviceReplay'
import { useSectionPriority, isSectionVisible } from '@/lib/phase8/sectionPriority'
import { X, ChevronRight, ChevronLeft, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

// ─── オフライン用ダミーデータ ─────────────────────────────────────────────────

const MOCK_CUSTOMER: Customer = {
  id:                    'debug-001',
  name:                  '田中 美咲',
  visits:                8,
  visit_count:           8,
  total_sales:           120000,
  avg_price:             15000,
  last_visit:            new Date(Date.now() - 14 * 86400000).toISOString().slice(0,10),
  customer_type:         'VIP型',
  vip_rank:              4,
  churn_risk:            22,
  line_response_rate:    72,
  next_visit_prediction: '',
  skin_tags:             ['dry','aging'],
  recommended_cycle_days: 28,
}

const MOCK_RESERVATION: Reservation = {
  id:                    'res-debug-001',
  customer_id:           'debug-001',
  customer_hash_id:      null,
  staff_id:              'staff-debug',
  menu:                  'プレミアムエイジングケア',
  scheduled_at:          new Date().toISOString(),
  status:                'confirmed',
  customer_name:         '田中 美咲',
  is_vip:                true,
  churn_risk:            22,
  days_since_last_visit: 14,
  customer_type:         'VIP型',
}

// ダミータイムライン
const MOCK_TIMELINE = [
  { id:'t1', type:'visit',    label:'来店',       sub:'プレミアムエイジングケア', date:'14日前',  color:'#4878A8' },
  { id:'t2', type:'line',     label:'LINE送信',   sub:'既読・返信あり',           date:'14日前',  color:'#34A070' },
  { id:'t3', type:'voice',    label:'音声メモ',   sub:'乾燥・エイジング言及',     date:'42日前',  color:'#F56E8B' },
  { id:'t4', type:'purchase', label:'商品購入',   sub:'セラミド美容液',           date:'42日前',  color:'#D4A96A' },
  { id:'t5', type:'visit',    label:'来店',       sub:'モイスチャーフェイシャル', date:'42日前',  color:'#4878A8' },
]

// ダミーAI memories
const MOCK_MEMORIES = [
  { id:'m1', category:'lifestyle',   content:'多忙なライフスタイル。時短ケアを好む',         date:'42日前' },
  { id:'m2', category:'skin',        content:'乾燥・エイジングへの強い関心',                date:'42日前' },
  { id:'m3', category:'preference',  content:'上質・特別感のある提案を好む',                date:'14日前' },
]

// ダミー next actions
const MOCK_NEXT_ACTIONS = [
  { id:'a1', priority:'critical', label:'イベント前ケアセットを提案する',    badge:'即刻' },
  { id:'a2', priority:'high',     label:'施術後フォローLINEを送信する',     badge:'今日中' },
  { id:'a3', priority:'medium',   label:'次回予約を提案する',              badge:'今週中' },
]

// ダミー store learnings
const MOCK_STORE_LEARNINGS = [
  { section:'homecare', recommendation:'このタイプのお客様には「時短保湿ルーティン」を提案すると継続率が高い傾向があります', confidence:0.82, reasons:['成功事例 12件','忙しいお客様との相性良好'] },
  { section:'lineDraft', recommendation:'施術後15分以内のフォローLINEが返信率向上につながっています', confidence:0.71, reasons:['LINE返信率 68%','来店直後の温度感維持'] },
]

// ─── LOG ITEMS ────────────────────────────────────────────────────────────────

const LOG_ITEMS = [
  { key:'next_reserved',  emoji:'📅', label:'次回予約が',    onLabel:'予約済み', offLabel:'未予約' },
  { key:'ai_adopted',     emoji:'✨', label:'AI提案活用',    onLabel:'成功した', offLabel:'していない' },
  { key:'retail_sold',    emoji:'🛍', label:'店販購入',      onLabel:'購入あり', offLabel:'購入なし' },
  { key:'option_sold',    emoji:'⭐', label:'オプション成約', onLabel:'成約した', offLabel:'成約なし' },
  { key:'churn_followed', emoji:'💌', label:'離脱フォロー',  onLabel:'した',     offLabel:'していない' },
] as const
type LogKey = typeof LOG_ITEMS[number]['key']

const ACTION_BUTTONS = [
  { action:'line_sent',           emoji:'📱', label:'LINE送信した' },
  { action:'homecare_explained',  emoji:'🧴', label:'ホームケア説明した' },
  { action:'rebook_recommended',  emoji:'🗓️', label:'次回来店を提案した' },
  { action:'product_recommended', emoji:'🛍', label:'商品提案した' },
  { action:'product_purchased',   emoji:'✅', label:'商品を購入した' },
] as const

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function Phase1DebugPage() {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ background:'#FBF3F5', minHeight:'100dvh', fontFamily:"'Noto Sans JP',sans-serif" }}>
      {/* ヘッダー */}
      <div style={{ background:'#fff', borderBottom:'1px solid #F0E4E8',
        padding:'max(20px,env(safe-area-inset-top)) 20px 16px' }}>
        <p style={{ fontSize:'10px', letterSpacing:'0.25em', color:'#C8A8B0', marginBottom:'3px' }}>
          OFFLINE DEBUG MODE
        </p>
        <h1 style={{ fontSize:'20px', fontWeight:700, color:'#3d2218' }}>
          統合版 BottomSheet 検証
        </h1>
        <p style={{ fontSize:'11px', color:'#9E8090', marginTop:'3px' }}>
          Supabase・認証・API通信すべてオフライン
        </p>
      </div>

      <div style={{ padding:'20px 16px', display:'flex', flexDirection:'column', gap:'12px' }}>
        {/* 確認項目 */}
        {[
          '✅ BottomSheet 開閉',
          '✅ フェーズタブ切り替え',
          '✅ AI ADVICE 表示',
          '✅ NextActionPanel（優先度バッジ）',
          '✅ StoreLearningSection',
          '✅ 肌タグ編集',
          '✅ ホームケアプラン',
          '✅ LINE下書き',
          '✅ 実施済みアクション記録',
          '✅ 音声メモ（録音・波形）',
          '✅ タイムライン（履歴・AI記憶タブ）',
          '✅ Sheet B（KPIログ記録）',
          '✅ ServiceReplayCard',
        ].map((item,i) => (
          <div key={i} style={{ fontSize:'12px', color:'#5C4033',
            padding:'6px 12px', background:'#fff',
            borderRadius:'10px', border:'1px solid #F0E4E8' }}>
            {item}
          </div>
        ))}

        <button onClick={() => setOpen(true)} style={{
          width:'100%', padding:'18px', borderRadius:'999px',
          background:'linear-gradient(135deg,#F5A0B5,#F56E8B)',
          border:'none', color:'#fff', fontSize:'15px', fontWeight:700,
          cursor:'pointer', boxShadow:'0 6px 20px rgba(245,110,139,0.35)',
        }}>
          統合版 CustomerBottomSheet を開く
        </button>

        <a href="/phase1" style={{ display:'block', textAlign:'center',
          fontSize:'12px', color:'#9E8090', textDecoration:'none', padding:'8px' }}>
          ← /phase1 に戻る
        </a>
      </div>

      {/* オフライン版 BottomSheet */}
      <AnimatePresence>
        {open && (
          <OfflineBottomSheet
            customer={MOCK_CUSTOMER}
            reservation={MOCK_RESERVATION}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── オフライン版 CustomerBottomSheet ────────────────────────────────────────

function OfflineBottomSheet({
  customer: c,
  reservation: r,
  onClose,
}: {
  customer:    Customer
  reservation: Reservation
  onClose:     () => void
}) {
  const [page,         setPage]         = useState<'overview'|'log'>('overview')
  const [servicePhase, setServicePhase] = useState<ServicePhase>('aftercare')
  const [skinTags,     setSkinTags]     = useState<SkinTagKey[]>(c.skin_tags ?? [])
  const [tagEditing,   setTagEditing]   = useState(false)
  const [editingTags,  setEditingTags]  = useState<SkinTagKey[]>(c.skin_tags ?? [])
  const [homecarePlan, setHomecarePlan] = useState<HomecarePlan | null>(() =>
    generateHomecarePlan({ customerName:c.name, skinTags:c.skin_tags??[], menuName:r.menu, daysAfterVisit:r.days_since_last_visit??0 })
  )
  const [openSecs,     setOpenSecs]     = useState<Set<string>>(new Set())
  const [lineCopied,   setLineCopied]   = useState(false)
  const [doneActions,  setDoneActions]  = useState<Set<string>>(new Set())
  const [allDone,      setAllDone]      = useState(false)
  const [logSelected,  setLogSelected]  = useState<Set<LogKey>>(new Set())
  const [logSaved,     setLogSaved]     = useState(false)
  const [memo,         setMemo]         = useState('')
  const [serviceReplay,setServiceReplay]= useState<ServiceReplay|null>(null)
  const [timelineTab,  setTimelineTab]  = useState<'history'|'memory'>('history')
  // 録音 state（オフラインで波形アニメのみ）
  const [recStatus, setRecStatus] = useState<'idle'|'recording'|'stopped'>('idle')
  const [recSec,    setRecSec]    = useState(0)
  const recTimer = useRef<ReturnType<typeof setInterval>|null>(null)
  const [partialTxt, setPartialTxt] = useState('')

  // body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function toggleSec(k:string){
    setOpenSecs(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  }

  function startRec(){
    setRecStatus('recording'); setRecSec(0); setPartialTxt('')
    recTimer.current = setInterval(()=> setRecSec(s=>s+1), 1000)
    // 2秒後に partial transcript をシミュレート
    setTimeout(()=>setPartialTxt('乾燥が気になると…'), 2000)
    setTimeout(()=>setPartialTxt('乾燥が気になるとおっしゃっていました。ホームケアの相談も。'), 4000)
  }
  function stopRec(){
    if(recTimer.current) clearInterval(recTimer.current)
    setRecStatus('stopped')
  }

  function doAction(action:string){
    setDoneActions(p=>{ const n=new Set(p); n.add(action); if(n.size>=ACTION_BUTTONS.length) setAllDone(true); return n })
    toast.success('記録しました', { duration:1500 })
  }

  function saveLog(){
    setLogSaved(true)
    setServiceReplay(buildServiceReplay({
      reservationId:    r.id,
      customerId:       c.id,
      actionsDoneToday: Array.from(doneActions),
      logsDoneToday:    Array.from(logSelected),
      menuName:         r.menu,
      churnRisk:        c.churn_risk,
      daysSinceLastVisit: r.days_since_last_visit??0,
    }))
    toast.success('接客ログを保存しました 🌸', { duration:2000 })
  }

  function copyLine(){
    if(!homecarePlan?.lineDraft) return
    navigator.clipboard.writeText(homecarePlan.lineDraft).catch(()=>{})
    setLineCopied(true); toast.success('コピーしました',{duration:1500})
    setTimeout(()=>setLineCopied(false),2500)
  }

  const formatSec = (s:number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`
  const isDanger  = c.churn_risk > 70 || (r.days_since_last_visit??0) >= 60
  const returnInfo = getReturnTiming(r.menu, r.days_since_last_visit??0)

  return (
    <>
      {/* オーバーレイ */}
      <motion.div
        key="overlay"
        initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
        transition={{duration:0.2}}
        onClick={onClose}
        style={{ position:'fixed', inset:0, zIndex:40,
          background:'rgba(92,64,51,0.18)', backdropFilter:'blur(6px)',
          touchAction:'none' }}
      />

      {/* シート */}
      <div style={{ position:'fixed', inset:'0 0 0 0', zIndex:50,
        display:'flex', justifyContent:'center', alignItems:'flex-end',
        pointerEvents:'none' }}>
        <motion.div
          key="sheet"
          initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}
          drag="y" dragConstraints={{top:0}} dragElastic={{top:0,bottom:0.3}}
          onDragEnd={(_,info)=>{ if(info.offset.y>120||info.velocity.y>500) onClose() }}
          transition={{type:'spring',damping:32,stiffness:260}}
          style={{ width:'100%', maxWidth:'430px', pointerEvents:'auto',
            background:'#fff', borderRadius:'36px 36px 0 0',
            height:'88dvh', maxHeight:'88dvh', display:'flex', flexDirection:'column',
            boxShadow:'0 -8px 40px rgba(92,64,51,0.14)',
            overscrollBehavior:'contain', willChange:'transform' }}
        >
          {/* ハンドル */}
          <div style={{flexShrink:0,display:'flex',justifyContent:'center',paddingTop:12,paddingBottom:6}}>
            <div style={{width:48,height:5,borderRadius:3,background:'#E8D5D8'}}/>
          </div>

          {/* フェーズタブ */}
          {page==='overview' && (
            <div style={{flexShrink:0,display:'flex',gap:6,padding:'0 16px 10px',overflowX:'auto',scrollbarWidth:'none'}}>
              {(['counseling','treatment','aftercare','checkout'] as ServicePhase[]).map(ph=>{
                const labels:{[k:string]:string}={counseling:'🗣 カウンセリング',treatment:'💆 施術中',aftercare:'✨ アフター',checkout:'👋 退店'}
                const on=servicePhase===ph
                return(
                  <button key={ph} onClick={()=>setServicePhase(ph)}
                    style={{flexShrink:0,fontSize:10,padding:'5px 12px',borderRadius:999,
                      border:`1px solid ${on?'#F56E8B':'#F0E8E8'}`,
                      background:on?'rgba(245,110,139,0.08)':'transparent',
                      color:on?'#F56E8B':'#C8A8B0',fontWeight:on?600:400,
                      whiteSpace:'nowrap',cursor:'pointer'}}>
                    {labels[ph]}
                  </button>
                )
              })}
            </div>
          )}

          <AnimatePresence mode="wait">
            {page==='overview' ? (

              /* ════ SHEET A ════ */
              <motion.div key="overview"
                initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}}
                exit={{opacity:0,x:-12}} transition={{duration:0.18}}
                style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

                <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14,
                  padding:`8px 20px env(safe-area-inset-bottom,80px)`,
                  WebkitOverflowScrolling:'touch'}}>

                  {/* 顧客ヘッダー */}
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <img src="/riora-os/rio-kuma.png" alt=""
                      style={{width:44,height:44,borderRadius:'50%',objectFit:'cover',flexShrink:0,
                        border:'2px solid #F0D8DC'}} />
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        <span style={{fontSize:20,fontWeight:700,color:'#5C4033'}}>{c.name} 様</span>
                        {c.vip_rank>=3&&<span style={{fontSize:10,color:'#D4A96A',background:'rgba(212,169,106,0.12)',border:'1px solid rgba(212,169,106,0.3)',borderRadius:5,padding:'1px 7px',fontWeight:600}}>★ VIP</span>}
                        {isDanger&&<span style={{fontSize:10,color:'#C05060',background:'#FFF0F2',border:'1px solid rgba(192,80,96,0.2)',borderRadius:5,padding:'1px 7px',fontWeight:600}}>失客注意</span>}
                      </div>
                      <p style={{fontSize:12,color:'#C8A58C',marginTop:2}}>{r.menu}　来店 {c.visits}回</p>
                    </div>
                    <button onClick={onClose}
                      style={{width:32,height:32,borderRadius:'50%',background:'#F8F1F3',
                        border:'none',display:'flex',alignItems:'center',justifyContent:'center',
                        cursor:'pointer',flexShrink:0}}>
                      <X size={14} color="#C8A58C" strokeWidth={2.5}/>
                    </button>
                  </div>

                  {/* KPI 3列 */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                    {[{l:'累計売上',v:`¥${(c.total_sales/10000).toFixed(1)}万`},{l:'来店回数',v:`${c.visits}回`},{l:'LINE反応率',v:`${c.line_response_rate}%`}].map(({l,v})=>(
                      <div key={l} style={{background:'#F8F1F3',borderRadius:18,padding:'10px 6px',textAlign:'center'}}>
                        <p style={{fontSize:15,fontWeight:700,color:'#5C4033',fontFamily:'Inter,sans-serif'}}>{v}</p>
                        <p style={{fontSize:10,color:'#9F7E6C'}}>{l}</p>
                      </div>
                    ))}
                  </div>

                  {/* AI ADVICE */}
                  <div style={{background:'#FFF8F7',border:'1px solid #F5E6E8',borderRadius:22,padding:16}}>
                    <p style={{fontSize:11,letterSpacing:'0.2em',color:'#C8A58C',fontWeight:600,marginBottom:8}}>✨ 今日の接客ポイント</p>
                    <p style={{fontSize:13,color:'#5C4033',lineHeight:1.75}}>特別感を演出し、他では得られない体験を提供しましょう。VIP様には長くご愛顧いただいていることへの感謝を伝えながら、プレミアムな提案を心がけてください。</p>
                  </div>

                  {/* NextAction（オフライン） */}
                  <div style={{background:'#F8F1F3',borderRadius:22,padding:16}}>
                    <p style={{fontSize:11,letterSpacing:'0.18em',color:'#C8A58C',fontWeight:600,marginBottom:10}}>🔥 次にやるべきこと</p>
                    {MOCK_NEXT_ACTIONS.map(a=>{
                      const cols:{[k:string]:[string,string,string]}={
                        critical:['#C05060','#FFF0F2','rgba(192,80,96,0.2)'],
                        high:    ['#F56E8B','#FFF8FA','rgba(245,110,139,0.2)'],
                        medium:  ['#D4A96A','#FFFBF0','rgba(212,169,106,0.2)'],
                      }
                      const [col,bg,border]=cols[a.priority]
                      return(
                        <div key={a.id} style={{display:'flex',alignItems:'center',gap:10,
                          padding:'8px 0',borderBottom:'1px solid #F0E8E8'}}>
                          <div style={{width:7,height:7,borderRadius:'50%',background:col,flexShrink:0}}/>
                          <p style={{flex:1,fontSize:12,color:'#5C4033',lineHeight:1.4}}>{a.label}</p>
                          <span style={{fontSize:9,padding:'2px 8px',borderRadius:999,
                            background:bg,color:col,border:`1px solid ${border}`,fontWeight:600,flexShrink:0}}>
                            {a.badge}
                          </span>
                        </div>
                      )
                    })}
                  </div>

                  {/* StoreLearning（オフライン） */}
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <p style={{fontSize:11,letterSpacing:'0.18em',color:'#C8A58C',fontWeight:600}}>🧠 店舗学習AIの知見</p>
                    {MOCK_STORE_LEARNINGS.map((l,i)=>(
                      <div key={i} style={{background:'#fff',border:'1px solid #F0E8E8',borderRadius:16,padding:'12px 14px'}}>
                        <p style={{fontSize:12,color:'#5C4033',lineHeight:1.7,marginBottom:8}}>{l.recommendation}</p>
                        <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
                          <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,
                            background:'rgba(52,160,112,0.08)',color:'#207850',
                            border:'1px solid rgba(52,160,112,0.25)',fontWeight:600}}>
                            信頼度 {Math.round(l.confidence*100)}%
                          </span>
                          {l.reasons.map((r,ri)=>(
                            <span key={ri} style={{fontSize:10,color:'#C8A8B0'}}>• {r}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 肌タグ */}
                  <div style={{background:'#F8F1F3',borderRadius:22,padding:16}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <p style={{fontSize:11,letterSpacing:'0.18em',color:'#C8A58C',fontWeight:600}}>🏷️ 肌タグ</p>
                      <button onClick={()=>{setTagEditing(!tagEditing);setEditingTags(skinTags)}}
                        style={{fontSize:11,color:'#C8A58C',background:'#fff',
                          border:'1px solid #F5E6E8',borderRadius:999,padding:'2px 10px',cursor:'pointer'}}>
                        {tagEditing?'キャンセル':'編集'}
                      </button>
                    </div>
                    {tagEditing?(
                      <>
                        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                          {SKIN_TAG_KEYS.map(k=>{
                            const sel=editingTags.includes(k)
                            return(
                              <button key={k}
                                onClick={()=>setEditingTags(p=>sel?p.filter(t=>t!==k):[...p,k])}
                                style={{padding:'5px 12px',borderRadius:999,fontSize:11,cursor:'pointer',
                                  border:`1.5px solid ${sel?'#F56E8B':'#E8D5D8'}`,
                                  background:sel?'#FFF0F3':'#fff',color:sel?'#F56E8B':'#9F7E6C'}}>
                                {SKIN_TAG_LABELS[k]}
                              </button>
                            )
                          })}
                        </div>
                        <button onClick={()=>{setSkinTags(editingTags);setTagEditing(false);
                          setHomecarePlan(generateHomecarePlan({customerName:c.name,skinTags:editingTags,menuName:r.menu,daysAfterVisit:r.days_since_last_visit??0}));
                          toast.success('タグを保存しました 🌸',{duration:2000})}}
                          style={{width:'100%',padding:'10px',borderRadius:999,border:'none',
                            background:'#F56E8B',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                          タグを保存
                        </button>
                      </>
                    ):(
                      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                        {skinTags.length===0
                          ?<p style={{fontSize:12,color:'#C8A8B0'}}>タグ未設定</p>
                          :skinTags.map(k=>(
                            <span key={k} style={{padding:'4px 10px',borderRadius:999,fontSize:11,
                              background:'#FFF0F3',color:'#F56E8B',border:'1px solid #F5C6D0',fontWeight:500}}>
                              {SKIN_TAG_LABELS[k]??k}
                            </span>
                          ))
                        }
                      </div>
                    )}
                  </div>

                  {/* ホームケアプラン */}
                  {homecarePlan&&(
                    <div style={{background:'#F8F1F3',borderRadius:22,overflow:'hidden'}}>
                      <button onClick={()=>toggleSec('homecare')}
                        style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                          padding:'12px 16px',background:'transparent',border:'none',cursor:'pointer'}}>
                        <p style={{fontSize:11,letterSpacing:'0.18em',color:'#C8A58C',fontWeight:600}}>🧴 ホームケアプラン</p>
                        <span style={{color:'#C8A58C',transition:'transform .2s',
                          display:'inline-block',transform:openSecs.has('homecare')?'rotate(180deg)':'none'}}>▾</span>
                      </button>
                      {openSecs.has('homecare')&&(
                        <div style={{padding:'0 16px 16px',display:'flex',flexDirection:'column',gap:10}}>
                          {homecarePlan.todayCare.length>0&&(
                            <div style={{background:'#F0FAF7',borderRadius:16,padding:'10px 12px'}}>
                              <p style={{fontSize:10,color:'#34A090',fontWeight:600,letterSpacing:'0.1em',marginBottom:6}}>✅ 今日のケア</p>
                              {homecarePlan.todayCare.map((t,i)=><p key={i} style={{fontSize:12,color:'#5C4033',lineHeight:1.6}}>・{t}</p>)}
                            </div>
                          )}
                          {homecarePlan.products.length>0&&(
                            <div style={{background:'#F5F0FA',borderRadius:16,padding:'10px 12px'}}>
                              <p style={{fontSize:10,color:'#8060B0',fontWeight:600,letterSpacing:'0.1em',marginBottom:6}}>🛍 商品提案</p>
                              {homecarePlan.products.map((t,i)=><p key={i} style={{fontSize:12,color:'#5C4033',lineHeight:1.6}}>・{t}</p>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* LINE下書き */}
                  {homecarePlan?.lineDraft&&(
                    <div style={{background:'#F0FAF5',borderRadius:22,border:'1px solid #D0F0E0',overflow:'hidden'}}>
                      <button onClick={()=>toggleSec('line')}
                        style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                          padding:'12px 16px',background:'transparent',border:'none',cursor:'pointer'}}>
                        <p style={{fontSize:11,letterSpacing:'0.18em',color:'#34A070',fontWeight:600}}>💬 LINE下書き</p>
                        <span style={{color:'#34A070',transition:'transform .2s',
                          display:'inline-block',transform:openSecs.has('line')?'rotate(180deg)':'none'}}>▾</span>
                      </button>
                      {openSecs.has('line')&&(
                        <div style={{padding:'0 16px 14px'}}>
                          <div style={{background:'#fff',borderRadius:16,padding:12,
                            border:'1px solid #C0E8D0',marginBottom:10}}>
                            <p style={{fontSize:13,color:'#3C5C45',lineHeight:1.8,whiteSpace:'pre-wrap'}}>
                              {homecarePlan.lineDraft}
                            </p>
                          </div>
                          <button onClick={copyLine}
                            style={{width:'100%',padding:'10px',borderRadius:999,
                              border:'1px solid rgba(80,200,140,0.3)',
                              background:lineCopied?'#34D399':'rgba(80,200,140,0.08)',
                              color:lineCopied?'#fff':'#2ECC8A',fontSize:12,fontWeight:700,
                              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                            {lineCopied?<><Check size={13}/>コピー済み</>:<><Copy size={13}/>テキストをコピー</>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 実施済み記録 */}
                  <div style={{background:'#F5F0FA',borderRadius:22,padding:16}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <p style={{fontSize:11,letterSpacing:'0.18em',color:'#8060A8',fontWeight:600}}>⚡ 実施済みを記録</p>
                      {allDone&&<span style={{fontSize:10,padding:'2px 10px',borderRadius:999,
                        background:'rgba(128,96,168,0.1)',color:'#8060A8',
                        border:'1px solid rgba(128,96,168,0.25)',fontWeight:600}}>接客フロー完了 ✓</span>}
                    </div>
                    {ACTION_BUTTONS.map(({action,emoji,label})=>{
                      const done=doneActions.has(action)
                      return(
                        <motion.button key={action} whileTap={{scale:0.975}}
                          onClick={()=>!done&&doAction(action)}
                          style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                            padding:'10px 12px',borderRadius:16,marginBottom:8,
                            border:`1.5px solid ${done?'#8060A8':'#DDD0EA'}`,
                            background:done?'#EDE8F5':'#fff',cursor:done?'default':'pointer'}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <span style={{fontSize:18}}>{emoji}</span>
                            <span style={{fontSize:13,fontWeight:500,color:done?'#8060A8':'#5C4033'}}>{label}</span>
                          </div>
                          <div style={{width:20,height:20,borderRadius:'50%',
                            border:`1.5px solid ${done?'#8060A8':'#C8B0D8'}`,
                            background:done?'#8060A8':'transparent',
                            display:'flex',alignItems:'center',justifyContent:'center'}}>
                            {done&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>

                  {/* 音声メモ（オフライン波形） */}
                  <div style={{background:'#F0F5FA',borderRadius:22,overflow:'hidden'}}>
                    <button onClick={()=>toggleSec('voice')}
                      style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',
                        padding:'12px 16px',background:'transparent',border:'none',cursor:'pointer'}}>
                      <p style={{fontSize:11,letterSpacing:'0.18em',color:'#4878A8',fontWeight:600}}>🎙️ 音声メモ</p>
                      <span style={{color:'#4878A8',transition:'transform .2s',
                        display:'inline-block',transform:openSecs.has('voice')?'rotate(180deg)':'none'}}>▾</span>
                    </button>
                    {openSecs.has('voice')&&(
                      <div style={{padding:'0 16px 16px',display:'flex',flexDirection:'column',gap:10}}>
                        {recStatus==='idle'&&(
                          <motion.button whileTap={{scale:0.97}} onClick={startRec}
                            style={{width:'100%',padding:'14px',borderRadius:999,border:'none',
                              background:'#4878A8',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                            🎙️ 録音を開始
                          </motion.button>
                        )}
                        {recStatus==='recording'&&(
                          <>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                              <motion.div animate={{opacity:[1,0.3,1]}}
                                transition={{duration:1.2,repeat:Infinity}}
                                style={{display:'flex',alignItems:'center',gap:6}}>
                                <div style={{width:8,height:8,borderRadius:'50%',background:'#E84050'}}/>
                                <span style={{fontSize:12,color:'#E84050',fontWeight:600}}>録音中</span>
                              </motion.div>
                              <span style={{fontFamily:'Inter',fontSize:14,color:'#4878A8',fontWeight:600}}>
                                {formatSec(recSec)}
                              </span>
                            </div>
                            {/* 波形 */}
                            <div style={{display:'flex',alignItems:'center',gap:2,height:32}}>
                              {Array.from({length:24},(_,i)=>(
                                <motion.div key={i}
                                  animate={{height:[6,Math.random()*22+6,6]}}
                                  transition={{duration:0.6+Math.random()*0.4,repeat:Infinity,delay:i*0.05}}
                                  style={{width:3,borderRadius:2,background:'#4878A8',opacity:0.7}}/>
                              ))}
                            </div>
                            {partialTxt&&(
                              <motion.div initial={{opacity:0}} animate={{opacity:1}}
                                style={{background:'#E8F2FA',borderRadius:10,padding:'8px 10px'}}>
                                <p style={{fontSize:11,color:'#4878A8',lineHeight:1.6}}>{partialTxt}</p>
                              </motion.div>
                            )}
                            <motion.button whileTap={{scale:0.97}} onClick={stopRec}
                              style={{width:'100%',padding:'12px',borderRadius:999,border:'none',
                                background:'#E84050',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                              ■ 録音を停止
                            </motion.button>
                          </>
                        )}
                        {recStatus==='stopped'&&(
                          <>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{fontSize:12,color:'#4878A8',fontWeight:600}}>録音完了</span>
                              <span style={{fontSize:11,color:'#688098',background:'#E0EAF5',
                                padding:'2px 8px',borderRadius:999}}>{formatSec(recSec)}</span>
                            </div>
                            {partialTxt&&(
                              <div style={{background:'#F0F5FA',borderRadius:10,padding:'8px 10px'}}>
                                <p style={{fontSize:10,color:'#8AAAC8',marginBottom:3}}>文字起こし</p>
                                <p style={{fontSize:11,color:'#4878A8',lineHeight:1.6}}>{partialTxt}</p>
                              </div>
                            )}
                            <div style={{display:'flex',gap:8}}>
                              <button onClick={()=>{setRecStatus('idle');setRecSec(0);setPartialTxt('')}}
                                style={{flex:1,padding:'10px',borderRadius:999,
                                  border:'1px solid #D0E0F0',background:'#fff',
                                  color:'#4878A8',fontSize:12,cursor:'pointer'}}>
                                再録音
                              </button>
                              <button onClick={()=>{toast.success('音声メモを保存しました（オフライン）',{duration:2000});setRecStatus('idle');setRecSec(0);setPartialTxt('')}}
                                style={{flex:2,padding:'10px',borderRadius:999,border:'none',
                                  background:'#4878A8',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                                💾 保存（オフライン）
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* タイムライン（オフライン） */}
                  <div style={{background:'#F8F1F3',borderRadius:22,padding:16}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                      <p style={{fontSize:11,letterSpacing:'0.18em',color:'#C8A58C',fontWeight:600}}>📅 タイムライン</p>
                      <div style={{display:'flex',gap:6}}>
                        {(['history','memory'] as const).map(tab=>(
                          <button key={tab} onClick={()=>setTimelineTab(tab)}
                            style={{fontSize:10,padding:'3px 10px',borderRadius:999,cursor:'pointer',
                              border:`1px solid ${timelineTab===tab?'rgba(245,110,139,0.4)':'rgba(200,168,176,0.3)'}`,
                              background:timelineTab===tab?'rgba(245,110,139,0.08)':'transparent',
                              color:timelineTab===tab?'#F56E8B':'#C8A8B0',fontWeight:timelineTab===tab?600:400}}>
                            {tab==='history'?'履歴':'記憶'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {timelineTab==='history'
                      ?MOCK_TIMELINE.map(e=>(
                        <div key={e.id} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'6px 0',borderBottom:'1px solid #F0E8E8'}}>
                          <span style={{fontSize:11,color:'#C8A8B0',width:48,flexShrink:0,paddingTop:2}}>{e.date}</span>
                          <div style={{width:8,height:8,borderRadius:'50%',background:e.color,flexShrink:0,marginTop:3}}/>
                          <div>
                            <p style={{fontSize:12,color:'#5C4033',fontWeight:500}}>{e.label}</p>
                            <p style={{fontSize:11,color:'#C8A8B0'}}>{e.sub}</p>
                          </div>
                        </div>
                      ))
                      :MOCK_MEMORIES.map(m=>(
                        <div key={m.id} style={{padding:'8px 0',borderBottom:'1px solid #F0E8E8'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                            <span style={{fontSize:10,color:'#F56E8B',background:'rgba(245,110,139,0.08)',
                              border:'1px solid rgba(245,110,139,0.2)',borderRadius:6,padding:'1px 7px',fontWeight:600}}>
                              {m.category}
                            </span>
                            <span style={{fontSize:10,color:'#C8A8B0'}}>{m.date}</span>
                          </div>
                          <p style={{fontSize:12,color:'#5C4033',lineHeight:1.6}}>{m.content}</p>
                        </div>
                      ))
                    }
                  </div>

                </div>

                {/* 固定フッター */}
                <div style={{flexShrink:0,padding:'10px 20px',
                  paddingBottom:'max(24px,env(safe-area-inset-bottom))'}}>
                  <motion.button whileTap={{scale:0.97}} onClick={()=>setPage('log')}
                    style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',
                      gap:8,padding:'16px',borderRadius:999,background:'#F56E8B',
                      color:'#fff',fontSize:14,fontWeight:700,border:'none',cursor:'pointer',
                      boxShadow:'0 8px 24px rgba(245,110,139,0.35)'}}>
                    今日の接客を記録する <ChevronRight size={18} strokeWidth={2.5}/>
                  </motion.button>
                </div>
              </motion.div>

            ) : (

              /* ════ SHEET B ════ */
              <motion.div key="log"
                initial={{opacity:0,x:20}} animate={{opacity:1,x:0}}
                exit={{opacity:0,x:20}} transition={{duration:0.2}}
                style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

                {/* ヘッダー */}
                <div style={{flexShrink:0,display:'flex',alignItems:'center',
                  justifyContent:'space-between',padding:'4px 20px 12px'}}>
                  <button onClick={()=>setPage('overview')}
                    style={{display:'flex',alignItems:'center',gap:4,background:'transparent',
                      border:'none',cursor:'pointer',color:'#C8A58C',fontSize:13}}>
                    <ChevronLeft size={16}/>戻る
                  </button>
                  <div style={{textAlign:'center'}}>
                    <p style={{fontSize:11,color:'#F56E8B',fontWeight:500,letterSpacing:'0.12em',marginBottom:2}}>クイック入力</p>
                    <p style={{fontSize:17,fontWeight:700,color:'#3d2218'}}>接客ログ記録</p>
                  </div>
                  <button onClick={onClose}
                    style={{width:32,height:32,borderRadius:'50%',background:'#F8F1F3',
                      border:'none',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                    <X size={14} color="#C8A58C"/>
                  </button>
                </div>

                <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:12,
                  padding:`0 20px env(safe-area-inset-bottom,80px)`,
                  WebkitOverflowScrolling:'touch'}}>

                  {/* 顧客チップ */}
                  <div style={{background:'#F8F1F3',borderRadius:16,padding:'12px 14px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      <span style={{fontSize:14,fontWeight:700,color:'#5C4033'}}>{c.name} 様</span>
                      <span style={{fontSize:9,color:'#D4A96A',background:'rgba(212,169,106,0.12)',
                        border:'1px solid rgba(212,169,106,0.3)',borderRadius:5,padding:'1px 6px',fontWeight:600}}>VIP</span>
                    </div>
                    <p style={{fontSize:11,color:'#9E8090'}}>{r.menu} · 来店 {c.visits}回 · 最終来店 {r.days_since_last_visit}日前</p>
                  </div>

                  {/* KPIログ */}
                  <div style={{background:'#fff',border:'1px solid #F0E4E8',borderRadius:18,display:'flex',flexDirection:'column',flexShrink:0}}>
                    <div style={{padding:'10px 14px 8px',borderBottom:'1px solid #F5EEF0',background:'#FFF8FA'}}>
                      <p style={{fontSize:11,color:'#F56E8B',fontWeight:600,letterSpacing:'0.08em'}}>
                        ✓ KPI・接客ログ（ワンタップ記録）
                      </p>
                    </div>
                    <div style={{padding:'0 14px'}}>
                      {LOG_ITEMS.map(({key,emoji,label,onLabel,offLabel})=>{
                        const isOn=logSelected.has(key)
                        return(
                          <div key={key} style={{display:'flex',alignItems:'center',
                            padding:'11px 0',borderBottom:'1px solid #F5EEF0',gap:10}}>
                            <span style={{fontSize:20,flexShrink:0}}>{emoji}</span>
                            <span style={{flex:1,fontSize:13,fontWeight:500,color:'#5C4033'}}>{label}</span>
                            <div style={{display:'flex',gap:6,flexShrink:0}}>
                              <motion.button whileTap={{scale:0.96}}
                                disabled={logSaved}
                                onClick={()=>!logSaved&&setLogSelected(p=>{const n=new Set(p);n.add(key);return n})}
                                style={{padding:'6px 14px',borderRadius:999,fontSize:12,fontWeight:isOn?600:400,
                                  border:`1.5px solid ${isOn?'#F56E8B':'#F0E0E4'}`,
                                  background:isOn?'#F56E8B':'#fff',color:isOn?'#fff':'#A07080',cursor:'pointer'}}>
                                {onLabel}
                              </motion.button>
                              <motion.button whileTap={{scale:0.96}}
                                disabled={logSaved}
                                onClick={()=>!logSaved&&setLogSelected(p=>{const n=new Set(p);n.delete(key);return n})}
                                style={{padding:'6px 14px',borderRadius:999,fontSize:12,
                                  border:`1.5px solid ${!isOn?'#C8A8B0':'#F0E0E4'}`,
                                  background:!isOn?'#F8F0F2':'#fff',color:!isOn?'#7A5060':'#C8A8B0',
                                  fontWeight:!isOn?600:400,cursor:'pointer'}}>
                                {offLabel}
                              </motion.button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* メモ */}
                  <div style={{background:'#F8F1F3',borderRadius:16,padding:'12px 14px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                      <p style={{fontSize:12,fontWeight:500,color:'#3d2218'}}>📝 接客メモ（自由入力）</p>
                      <span style={{fontSize:11,color:'#C8A8B0'}}>{memo.length}/200文字</span>
                    </div>
                    <textarea
                      value={memo} onChange={e=>setMemo(e.target.value.slice(0,200))}
                      placeholder={`${c.name}様の接客メモを入力…`}
                      rows={3}
                      style={{width:'100%',resize:'none',fontSize:12,color:'#5C4033',
                        background:'#fff',borderRadius:12,padding:'10px 12px',
                        border:'1px solid #F5E6E8',outline:'none',lineHeight:1.7,
                        fontFamily:"'Noto Sans JP',sans-serif",boxSizing:'border-box'}}
                    />
                  </div>

                  {/* ServiceReplay */}
                  {logSaved&&serviceReplay&&(
                    <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
                      style={{background:'linear-gradient(135deg,rgba(128,96,168,0.06),rgba(245,110,139,0.04))',
                        border:'1px solid rgba(128,96,168,0.2)',borderRadius:18,padding:16}}>
                      <p style={{fontSize:11,letterSpacing:'0.15em',color:'#8060A8',fontWeight:600,marginBottom:12}}>
                        ✨ 今日の接客リプレイ
                      </p>
                      {(serviceReplay.strengths??[]).map((h:string,i:number)=>(
                        <div key={i} style={{display:'flex',gap:8,padding:'6px 0',
                          borderBottom:'1px solid rgba(128,96,168,0.1)'}}>
                          <span style={{fontSize:14,flexShrink:0}}>💪</span>
                          <p style={{fontSize:12,color:'#5C4033',lineHeight:1.5}}>{h}</p>
                        </div>
                      ))}
                      {(serviceReplay.suggestions??[]).map((h:string,i:number)=>(
                        <div key={i} style={{display:'flex',gap:8,padding:'6px 0',
                          borderBottom:'1px solid rgba(128,96,168,0.1)'}}>
                          <span style={{fontSize:14,flexShrink:0}}>🔧</span>
                          <p style={{fontSize:12,color:'#5C4033',lineHeight:1.5}}>{h}</p>
                        </div>
                      ))}
                    </motion.div>
                  )}

                </div>

                {/* 保存ボタン */}
                <div style={{flexShrink:0,padding:'10px 20px',
                  paddingBottom:'max(24px,env(safe-area-inset-bottom))'}}>
                  <motion.button whileTap={{scale:0.97}}
                    onClick={saveLog} disabled={logSaved}
                    style={{width:'100%',padding:'16px',borderRadius:999,
                      background:logSaved?'#34D399':'#F56E8B',
                      color:'#fff',fontSize:14,fontWeight:700,border:'none',
                      cursor:logSaved?'default':'pointer',
                      boxShadow:logSaved?'0 8px 24px rgba(52,211,153,0.3)':'0 8px 24px rgba(245,110,139,0.35)'}}>
                    {logSaved?'✓ 保存しました':'🌸 ログを保存する'}
                  </motion.button>
                  {!logSaved&&(
                    <p style={{textAlign:'center',fontSize:11,color:'#C8A8B0',marginTop:8}}>
                      保存された内容はスタッフとAIが確認できます
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  )
}
