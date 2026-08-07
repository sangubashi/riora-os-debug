'use client';

/**
 * CustomerBottomSheet.tsx  — 統合版
 *
 * ベース: あなたの PHASE 9 版（Tailwind + { customer } Props）
 * 統合:  dev 版のロジック層（Adaptive Priority / Voice / Store Learning 等）
 *
 * 設計:
 *   - Props: customer + reservation を受け取る（あなたのスタイル）
 *   - Zustand: useStaffStore からも補完（aiSuggestion / currentStaffId）
 *   - スタイル: Tailwind className を基本、motion 系は inline style 許容
 *   - 新コンポーネントは ErrorBoundary(silentFail) でラップして安全に差し込む
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X, Copy, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// ── Zustand ──────────────────────────────────────────────────────────────────
import { useStaffStore } from '@/store/useStaffStore';
import { useNewCustomerSheetStore } from '@/store/useNewCustomerSheetStore';
import { useAuthStore } from '@/store/useAuthStore';

// ── Supabase ─────────────────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/api/authedFetch';

// ── 型 ────────────────────────────────────────────────────────────────────────
import type {
  Customer,
  Reservation,
  SkinTagKey,
  ActionType,
  ServicePhase,
  DisplaySection,
  CustomerNote,
} from '@/types';
import {
  SKIN_TAG_LABELS,
  SKIN_TAG_KEYS,
  ACTION_TYPE_LABELS,
  CONTRAINDICATION_SEVERITY_ORDER,
} from '@/types';
import type { HomecarePlan, ServiceReplay } from '@/types';

// ── ロジック層 ────────────────────────────────────────────────────────────────
import {
  generateHomecarePlan,
  getReturnTiming,
  type HomecarePlanInput,
} from '@/lib/homecare/generateHomecarePlan';
import { getHomecareUsageGuide } from '@/lib/homecare/homecareUsageGuide';
import { getConversationHints } from '@/lib/homecare/homecareConversationHints';
import { buildCustomerTagVocabulary, buildProductCategoryVocabulary, deriveHintsFromMatchedKeywords, buildMatchReasons, GENERAL_HINTS, type MatchReason } from '@/lib/nextAction/knowledgeMatch';
import { fetchKnowledgeMatch } from '@/lib/nextAction/fetchKnowledgeMatch';
import { logAction, fetchRecentActions, type ActionLogRow } from '@/lib/actionLog';
import { buildServiceReplay } from '@/lib/phase5/serviceReplay';
import { Mutex, prodLog } from '@/lib/stability';
import { useSectionPriority, isSectionVisible } from '@/lib/phase8/sectionPriority';
import {
  calculateSectionPriorities,
  type AdaptivePriorityInput,
} from '@/lib/adaptivePriority';
import {
  fetchBookingPrompt,
  generateAndSave,
  type BookingPrompt,
} from '@/lib/bookingPrompt'
import {
  fetchHandover,
  generateAndSaveHandover,
  type HandoverNote,
} from '@/lib/handover'
import {
  fetchContraindications,
  generateAndSaveContraindications,
  deleteContraindication,
  type Contraindication,
} from '@/lib/contraindication';

// ── コンポーネント層 ──────────────────────────────────────────────────────────
import { ErrorBoundary } from '@/components/ErrorBoundary';
import CustomerInsightPanel from '@/components/customer/CustomerInsightPanel';
import NextActionPanel from '@/components/customer/NextActionPanel';
import AIProposalCard from '@/components/customer/AIProposalCard';
import CustomerRiskCard from '@/components/customer/CustomerRiskCard';
import ServiceReplayCard from '@/components/customer/ServiceReplayCard';
import VoiceMemoSection from '@/components/customer/VoiceMemoSection';
import CustomerNotesSection from '@/components/customer/CustomerNotesSection';
import BookingPromptSection from '@/components/customer/BookingPromptSection';
import HandoverSection from '@/components/customer/HandoverSection';
import ContraindicationSection from '@/components/customer/ContraindicationSection';
import CustomerMemorySection from '@/components/customer/CustomerMemorySection';
import CustomerMemoryTab from '@/components/customer/CustomerMemoryTab'
import CustomerAITimelineTab from '@/components/customer/CustomerAITimelineTab';

// ─── 定数 ────────────────────────────────────────────────────────────────────

/** 顧客タイプ別: 接客ゴール + NG表現 */
const TYPE_COPY: Record<string, { goal: string; ng: string }> = {
  '慎重・不安型': { goal: '安心感を優先。強い提案は控えて信頼を積み上げる', ng: '「絶対に効果があります」などの断言表現' },
  '感情重視型':   { goal: '感情的なつながりを強化。共感と温かい言葉を大切に', ng: '「データ上は〜」などの事務的・数値的な表現' },
  '効果重視型':   { goal: '具体的な変化・数値を見せて次回予約につなげる', ng: '「効果には個人差があります」の多用' },
  '信頼構築型':   { goal: '定期来店の習慣化を促進。焦らず丁寧に', ng: '「今日だけの特別価格」などの圧力表現' },
  'VIP型':       { goal: '特別感を最大演出。他のお客様より一歩先のご案内', ng: '「他のお客様も使っています」などの一般化' },
};

/**
 * ホームケア使い方カードの customer_type別ワンポイント見出し（PHASE HOMECARE-V12-MVP-1）。
 * brain_customers.customer_type（'A_acne'|'B_pore'|'C_sensitive'|'D_aging'|'E_bridal'）の
 * 文字列をそのままキーに使う。TYPE_COPY（接客スタイル型）とは別軸の値のため衝突しない。
 */
const CUSTOMER_TYPE_HINT_LABEL: Record<string, string> = {
  A_acne:      'ニキビが気になる方へ',
  B_pore:      '毛穴が気になる方へ',
  C_sensitive: '敏感肌の方へ',
  D_aging:     'エイジングケアを意識される方へ',
};

/** KPIログ項目（ワンタップ記録） */
const LOG_ITEMS: Array<{
  key: 'next_reserved' | 'ai_adopted' | 'retail_sold' | 'option_sold' | 'churn_followed';
  emoji: string;
  label: string;
  onLabel: string;
  offLabel: string;
}> = [
  { key: 'next_reserved',  emoji: '📅', label: '次回予約が',    onLabel: '予約済み', offLabel: '未予約' },
  { key: 'ai_adopted',     emoji: '✨', label: 'AI提案活用',    onLabel: '成功した', offLabel: 'していない' },
  { key: 'retail_sold',    emoji: '🛍', label: '店販購入',      onLabel: '購入あり', offLabel: '購入なし' },
  { key: 'option_sold',    emoji: '⭐', label: 'オプション成約', onLabel: '成約した', offLabel: '成約なし' },
  { key: 'churn_followed', emoji: '💌', label: '離脱フォロー',  onLabel: 'した',     offLabel: 'していない' },
];
type LogKey = (typeof LOG_ITEMS)[number]['key'];

/** 実施済みアクションボタン */
const ACTION_BUTTONS: Array<{ action: ActionType; emoji: string; label: string }> = [
  { action: 'line_sent',           emoji: '📱', label: 'LINE送信した' },
  { action: 'homecare_explained',  emoji: '🧴', label: 'ホームケア説明した' },
  { action: 'rebook_recommended',  emoji: '🗓️', label: '次回来店を提案した' },
  { action: 'product_recommended', emoji: '🛍', label: '商品提案した' },
  { action: 'product_purchased',   emoji: '✅', label: '商品を購入した' },
];

type SectionKey = 'homecare' | 'line' | 'voice' | 'lineSendLog';

/** 来店履歴1件（Phase UX-1・/api/customers/[id]/visit-history のレスポンス型） */
interface VisitHistoryEntry {
  id:        string;
  visitDate: string;
  menuName:  string | null;
  /** brain_visits.menu_id（PHASE MENU-AI-3・line-messageのMenu AI Context組み立てに使う）。 */
  menuId:    string | null;
  amount:    number;
  staffName: string | null;
}

/** ホームケア使用商品1件（PHASE HC-2B・/api/customers/[id]/homecare-products のレスポンス型） */
interface HomecareProductEntry {
  productName:     string;
  purchaseCount:   number;
  lastPurchasedAt: string;
}

/**
 * LINE送信履歴1件（PHASE LINE-LOG-1・/api/customers/[id]/line-send-log のレスポンス型）。
 * 「送信」はLINE Messaging APIの実送信ではなく、コピー操作を送信とみなした近似ログ
 * (アプリからLINEを直接送信しない設計のため)。
 */
interface LineSendLogEntry {
  kind:       'homecare' | 'usage_card' | 'thanks' | 'follow' | 'reminder';
  title:      string;
  occurredAt: string;
}

const LINE_SEND_KIND_LABEL: Record<LineSendLogEntry['kind'], string> = {
  homecare:   'ホームケア',
  usage_card: '使い方カード',
  thanks:     'お礼',
  follow:     'フォロー',
  reminder:   'リマインド',
};

/**
 * 直近の送信済みラベル(本日/7日以内)。無ければnull(PHASE LINE-LOG-1)。
 * title指定時は同じ商品名(使い方カード等)のログのみに絞る。
 */
function sentStatusLabel(logs: LineSendLogEntry[], kind: LineSendLogEntry['kind'], title?: string): string | null {
  const latest = logs.find(l => l.kind === kind && (title === undefined || l.title === title));
  if (!latest) return null;
  const diffDays = (Date.now() - new Date(latest.occurredAt).getTime()) / 86_400_000;
  if (diffDays < 1) return '本日送信済み';
  if (diffDays < 7) return '7日以内送信済み';
  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomerBottomSheetProps {
  /** あなたの PHASE 9 スタイル: 外から customer / reservation を渡す */
  customer?:    Customer;
  reservation?: Reservation;
  /** シートを閉じる（外から制御する場合） */
  onClose?:     () => void;
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export default function CustomerBottomSheet({
  customer:    propCustomer,
  reservation: propReservation,
  onClose,
}: CustomerBottomSheetProps = {}) {

  // ── Zustand（Props がなければ store から取得） ──────────────────────────────
  const {
    selectedCustomer:    storeCustomer,
    selectedReservation: storeReservation,
    aiSuggestion,
    currentStaffId: currentStaffIdFromStore,
    setSelectedCustomer,
    setSelectedReservation,
  } = useStaffStore();

  // セッション uid を staffId として使用（useStaffStore.currentStaffId は未設定のため）
  const { session } = useAuthStore();
  const currentStaffId = currentStaffIdFromStore ?? session?.user?.id ?? null;

  // PHASE10: 隔離された専用 store から activeSession を取得
  // useStaffStore の activeSession とは完全に独立
  const {
    activeSession,
    isRecording:         isVoiceRecording,
    setServicePhase:    storeSetServicePhase,
    setTimePressure:    storeSetTimePressure,
    resetActiveSession: resetActiveSession,
    setIsRecording:     storeSetIsRecording,
  } = useNewCustomerSheetStore();

  // Props 優先、なければ store から取得
  const c = propCustomer    ?? storeCustomer;
  const r = propReservation ?? storeReservation;
  const { servicePhase, timePressure } = activeSession;

  const isOpen = !!c && !!r;

  // ── Mutex（連打防止） ────────────────────────────────────────────────────────
  const actionMutexRef = useRef(new Mutex());
  // PHASE10: 接客開始時刻（elapsedTime 計算用）
  const sessionStartRef = useRef<number | null>(null);




  // ── アンマウント時クリーンアップ ─────────────────────────────────────────────
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  }, []);

  // ── iOS キーボード対策: visualViewport.height → CSS --vh ──────────────────
  useEffect(() => {
    const update = () => {
      const vvh = window.visualViewport?.height ?? window.innerHeight
      // safe-area-inset-bottom を除いた実効高さを --vh に設定
      const tmp = document.createElement('div')
      tmp.style.cssText = 'position:fixed;opacity:0;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);width:0;height:0'
      document.body.appendChild(tmp)
      const sab = parseFloat(getComputedStyle(tmp).paddingBottom) || 0
      document.body.removeChild(tmp)
      // 1% 単位で設定（calc(var(--vh) * 88) で使用）
      document.documentElement.style.setProperty('--vh', `${(vvh - sab) * 0.01}px`)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, []);

  // ── ページ ──────────────────────────────────────────────────────────────────
  const [page, setPage] = useState<'overview' | 'log' | 'memory' | 'timeline'>('overview');

  // ── 接客ログ ────────────────────────────────────────────────────────────────
  const [logSelected,   setLogSelected]   = useState<Set<LogKey>>(new Set());
  const [logSaving,     setLogSaving]     = useState(false);
  const [logSaved,      setLogSaved]      = useState(false);
  const [serviceReplay, setServiceReplay] = useState<ServiceReplay | null>(null);

  // ── メモ ────────────────────────────────────────────────────────────────────
  const [memo,          setMemo]          = useState('');
  const [memoSaving,    setMemoSaving]    = useState(false);
  const [savedMemoText, setSavedMemoText] = useState('');
  const [memoEditing,   setMemoEditing]   = useState(false);

  // ── customer_notes 最新分（CUSTOMER_MEMORY_OPTIMIZE_1: プリフィル用 + 最近の会話用を統合取得） ──
  const [recentNotes, setRecentNotes] = useState<CustomerNote[]>([]);

  // ── 肌タグ ──────────────────────────────────────────────────────────────────
  const [skinTags,    setSkinTags]    = useState<SkinTagKey[]>([]);
  const [tagSaving,   setTagSaving]   = useState(false);
  const [tagEditing,  setTagEditing]  = useState(false);
  const [editingTags, setEditingTags] = useState<SkinTagKey[]>([]);

  // ── AIタグ（voice_notes.insight_tags・接客ヒントのナレッジ一致語彙補強用） ──────
  const [insightTags, setInsightTags] = useState<string[]>([]);

  // ── ホームケア ──────────────────────────────────────────────────────────────
  const [homecarePlan, setHomecarePlan] = useState<HomecarePlan | null>(null);
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(new Set(['voice'] as SectionKey[]));

  // ── LINE下書き ──────────────────────────────────────────────────────────────
  const [lineCopied, setLineCopied] = useState(false);

  // ── 実施済みアクション ────────────────────────────────────────────────────────
  const [doneActions,    setDoneActions]    = useState<Set<ActionType>>(new Set());
  const [savingAction,   setSavingAction]   = useState<ActionType | null>(null);
  const [allDone,        setAllDone]        = useState(false);
  const [recentActions,  setRecentActions]  = useState<ActionLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 来店履歴（Phase UX-1） ────────────────────────────────────────────────────
  const [visitHistory,        setVisitHistory]        = useState<VisitHistoryEntry[]>([]);
  const [visitHistoryLoading, setVisitHistoryLoading] = useState(false);

  // ── 今日気をつけること（PHASE UX-1: Focus / 触れない話題） ─────────────────────
  const [todayFocus, setTodayFocus] = useState<string | null>(null);
  const [ngTopics,   setNgTopics]   = useState<string[]>([]);

  // ── ホームケア使用商品（PHASE HC-2B） ────────────────────────────────────────
  const [homecareProducts,        setHomecareProducts]        = useState<HomecareProductEntry[]>([]);
  const [homecareProductsLoading, setHomecareProductsLoading] = useState(false);

  // ── 関連記事（BLOG_CONTENT_PHASE2・ホームケア使用商品の下に表示。タイトルのみ） ──
  const [relatedArticles,        setRelatedArticles]        = useState<{ id: string; title: string }[]>([]);
  const [relatedArticlesLoading, setRelatedArticlesLoading] = useState(false);

  // ── 接客ヒント（PHASE2-C-3・ブログ×肌タグのキーワード一致で生成。固定文言は廃止） ──
  const [knowledgeHints,        setKnowledgeHints]        = useState<string[]>(GENERAL_HINTS);
  const [knowledgeHintsLoading, setKnowledgeHintsLoading] = useState(false);
  // 生成理由（PHASE2-C追加確認）。タグ名・カテゴリ名のみ。記事タイトル・summaryは含めない。
  const [knowledgeReasons,      setKnowledgeReasons]      = useState<MatchReason[]>([]);

  // ── LINEメッセージ生成（PHASE2-C-4・生成→編集→コピーのみ。送信APIは呼ばない） ──
  const [lineMessageDraft,      setLineMessageDraft]      = useState('');
  const [lineMessageGenerating, setLineMessageGenerating] = useState(false);
  const [lineMessageCopied,     setLineMessageCopied]     = useState(false);
  // 生成理由（PHASE2-C追加確認）。タグ名・カテゴリ名のみ。記事タイトル・summaryは含めない。
  const [lineMessageReasons,    setLineMessageReasons]    = useState<MatchReason[]>([]);
  // PHASE LINE-AI-1: 直近に生成した種別（来店お礼/ホームケア提案/来店リマインド）。
  // コピー時の送信ログkindに使う。
  const [lineMessageType,       setLineMessageType]       = useState<'thanks' | 'homecare' | 'reminder' | null>(null);
  // LINE UX改善: 通常版/簡易版の切り替え。永続化はせずこの画面を開いている間のみ保持。
  const [lineMessageVariant,    setLineMessageVariant]    = useState<'normal' | 'short'>('normal');

  // ── ホームケア使い方カード（PHASE HC-4） ────────────────────────────────────────
  const [expandedUsageCards, setExpandedUsageCards] = useState<Set<string>>(new Set());
  const [copiedUsageProduct, setCopiedUsageProduct] = useState<string | null>(null);

  // ── ホームケアAIメッセージ生成（PHASE HC-6） ─────────────────────────────────
  const [aiHomecareMessages, setAiHomecareMessages] = useState<Record<string, string>>({});
  const [aiGeneratingProduct, setAiGeneratingProduct] = useState<string | null>(null);

  // ── LINE送信履歴（PHASE LINE-LOG-1・コピー操作を送信とみなして記録） ─────────────
  const [lineSendLogs,        setLineSendLogs]        = useState<LineSendLogEntry[]>([]);
  const [lineSendLogsLoading, setLineSendLogsLoading] = useState(false);

  // ── Priority / Timeline refresh ─────────────────────────────────────────────
  const [insightRefreshKey,  setInsightRefreshKey]  = useState(0);
  const [notesRefreshKey,    setNotesRefreshKey]    = useState(0);
  const [memoryRefreshKey,   setMemoryRefreshKey]   = useState(0);

  // ── Booking Prompt ───────────────────────────────────────────────────────────
  const [bookingPrompt,         setBookingPrompt]         = useState<BookingPrompt | null>(null);
  const [bookingPromptLoading,  setBookingPromptLoading]  = useState(false);
  const [bookingPromptCollapsed, setBookingPromptCollapsed] = useState(false);

  // ── AI Handover ──────────────────────────────────────────────────────────────
  const [handover,          setHandover]          = useState<HandoverNote | null>(null);
  const [handoverLoading,   setHandoverLoading]   = useState(false);
  const [handoverCollapsed, setHandoverCollapsed] = useState(false);

  // ── Contraindications ────────────────────────────────────────────────────────
  const [contraindications,         setContraindications]         = useState<Contraindication[]>([]);
  const [contraindicationsLoading,  setContraindicationsLoading]  = useState(false);

  // ── Smart Completion Hint ─────────────────────────────────────────────────────
  const [completionHint, setCompletionHint] = useState<string | null>(null);

  // ─── 顧客切り替え時リセット ────────────────────────────────────────────────────
  useEffect(() => {
    if (!c?.id) return;

    setPage('overview');
    setLogSelected(new Set());
    setLogSaved(false);
    setSavedMemoText('');
    setMemo('');
    setMemoEditing(false);
    setTagEditing(false);
    setLineCopied(false);
    setOpenSections(new Set(['voice'] as SectionKey[]));  // voice はデフォルト展開
    setHomecarePlan(null);
    setDoneActions(new Set());
    setRecentActions([]);
    setRecentNotes([]);
    setInsightRefreshKey(0);
    setNotesRefreshKey(0);
    setMemoryRefreshKey(0);
    setBookingPrompt(null);
    setBookingPromptCollapsed(false);
    setHandover(null);
    setHandoverCollapsed(false);
    setContraindications([]);
    setVisitHistory([]);
    setTodayFocus(null);
    setNgTopics([]);
    setInsightTags([]);
    setHomecareProducts([]);
    setExpandedUsageCards(new Set());
    setAiHomecareMessages({});
    setLineMessageDraft('');
    setLineMessageCopied(false);
    setLineMessageReasons([]);
    setLineMessageType(null);
    setLineMessageVariant('normal');
    setLineSendLogs([]);
    setAllDone(false);
    setServiceReplay(null);
    resetActiveSession();
    sessionStartRef.current = Date.now();
    setCompletionHint(null);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);

    // customer_notes 最新分を1回だけ取得し、①メモ欄プリフィル ②「最近の会話」の両方に使う
    // （CUSTOMER_MEMORY_OPTIMIZE_1: 従来は limit(1) のプリフィル用取得と
    //   CustomerMemorySection 側の別クエリ(limit 3)が並走していたのを統合）
    void loadRecentNotes(c.id).then(rows => {
      if (rows[0]?.note) { setSavedMemoText(rows[0].note); setMemo(rows[0].note); }
    });

      {
        const tags = (c.skin_tags ?? []) as SkinTagKey[];
        setSkinTags(tags);
        setEditingTags(tags);
        if (r) {
          setHomecarePlan(generateHomecarePlan({
            customerName:   c.name,
            skinTags:       tags,
            menuName:       r.menu,
            daysAfterVisit: r.days_since_last_visit ?? 0,
          }));
        }
      }

    loadRecentActions(c.id);

    // Booking Prompt 自動取得・未生成なら生成
    void (async () => {
      setBookingPromptLoading(true);
      const existing = await fetchBookingPrompt(c.id, r?.id ?? null);
      if (existing) {
        setBookingPrompt(existing);
        setBookingPromptLoading(false);
      } else {
        const generated = await generateAndSave(c.id, r?.id ?? null);
        setBookingPrompt(generated);
        setBookingPromptLoading(false);
      }
    })();

    // AI Handover 自動取得・未生成なら生成
    void (async () => {
      setHandoverLoading(true);
      const existing = await fetchHandover(c.id, r?.id ?? null);
      if (existing) {
        setHandover(existing);
        setHandoverLoading(false);
      } else {
        const generated = await generateAndSaveHandover(c.id, r?.id ?? null);
        setHandover(generated);
        setHandoverLoading(false);
      }
    })();

    // Contraindications 自動取得・未生成なら生成
    void (async () => {
      setContraindicationsLoading(true);
      const existing = await fetchContraindications(c.id);
      if (existing.length > 0) {
        setContraindications(existing);
        setContraindicationsLoading(false);
      } else {
        const generated = await generateAndSaveContraindications(c.id, r?.id ?? null);
        setContraindications(generated);
        setContraindicationsLoading(false);
      }
    })();

    // 来店履歴（Phase UX-1）
    void (async () => {
      setVisitHistoryLoading(true);
      try {
        const res = await authedFetch(`/api/customers/${c.id}/visit-history`);
        if (res.ok) {
          const json = await res.json() as { success: boolean; visits: VisitHistoryEntry[] };
          if (json.success) setVisitHistory(json.visits);
        }
      } finally {
        setVisitHistoryLoading(false);
      }
    })();

    // ホームケア使用商品（PHASE HC-2B）
    void (async () => {
      setHomecareProductsLoading(true);
      try {
        const res = await authedFetch(`/api/customers/${c.id}/homecare-products`);
        if (res.ok) {
          const json = await res.json() as { success: boolean; products: HomecareProductEntry[] };
          if (json.success) setHomecareProducts(json.products);
        }
      } finally {
        setHomecareProductsLoading(false);
      }
    })();

    // LINE送信履歴（PHASE LINE-LOG-1・コピー操作を送信とみなして記録した履歴を取得）
    void (async () => {
      setLineSendLogsLoading(true);
      try {
        const res = await authedFetch(`/api/customers/${c.id}/line-send-log`);
        if (res.ok) {
          const json = await res.json() as { success: boolean; logs: LineSendLogEntry[] };
          if (json.success) setLineSendLogs(json.logs);
        }
      } finally {
        setLineSendLogsLoading(false);
      }
    })();

    // 今日気をつけること — 今日のFocus（timeline_summary_cache、生成済みキャッシュのみ参照）
    void (async () => {
      const { data } = await supabase
        .from('timeline_summary_cache')
        .select('focus')
        .eq('customer_id', c.id)
        .maybeSingle();
      setTodayFocus((data as { focus: string | null } | null)?.focus ?? null);
    })();

    // 今日気をつけること — 触れない話題（voice_notes.ng_topics 最新1件 + customer_memories(is_sensitive=true)）
    void (async () => {
      const [voiceRes, memoryRes] = await Promise.all([
        supabase.from('voice_notes')
          .select('ng_topics')
          .eq('customer_id', c.id)
          .not('ng_topics', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('customer_memories')
          .select('content')
          .eq('customer_id', c.id)
          .eq('is_sensitive', true)
          .order('created_at', { ascending: false }),
      ]);
      const ngFromVoice = Array.isArray(voiceRes.data?.[0]?.ng_topics)
        ? (voiceRes.data![0].ng_topics as string[])
        : [];
      const ngFromMemory = (memoryRes.data ?? []).map((m: { content: string }) => m.content);
      setNgTopics([...ngFromVoice, ...ngFromMemory]);
    })();

    // AIタグ（voice_notes.insight_tags 直近10件のユニーク和・PHASE2-C検証で判明した配線漏れの修正）
    // generateNextActions.ts の fetchInsightTags と同一クエリ。接客ヒントのナレッジ一致語彙
    // (buildCustomerTagVocabulary の第2引数)に使うだけで、画面へ直接表示はしない。
    void (async () => {
      const { data } = await supabase.from('voice_notes')
        .select('insight_tags')
        .eq('customer_id', c.id)
        .not('insight_tags', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      const rows = (data ?? []) as { insight_tags: string[] | null }[];
      setInsightTags(Array.from(new Set(rows.flatMap(r => r.insight_tags ?? []))));
    })();
  }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 関連記事（BLOG_CONTENT_PHASE2） ────────────────────────────────────────
  // homecareProducts(PHASE HC-2B・既存の購入履歴取得)が確定した後にのみ実行する。
  // 既存のHC-2B取得処理・表示ロジックには一切手を加えず、その結果を読むだけ。
  useEffect(() => {
    if (homecareProducts.length === 0) {
      setRelatedArticles([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setRelatedArticlesLoading(true);
      try {
        const params = new URLSearchParams();
        for (const p of homecareProducts) params.append('products', p.productName);
        const res = await authedFetch(`/api/blog-articles/related?${params.toString()}`);
        if (res.ok) {
          const json = await res.json() as { success: boolean; articles: { id: string; title: string }[] };
          if (!cancelled && json.success) setRelatedArticles(json.articles);
        }
      } finally {
        if (!cancelled) setRelatedArticlesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [homecareProducts]);

  // ── 接客ヒント（PHASE2-C-3） ─────────────────────────────────────────────────
  // 肌タグから導出した候補語(vocabulary)と、承認済みブログ記事のkeywordsとの一致を
  // 取得し、一致した語に対応する固定テンプレート文言を選ぶ。一致が無い場合は
  // GENERAL_HINTS(一般的な質問文)にフォールバックする。記事本文・summaryは扱わない。
  useEffect(() => {
    if (homecareProducts.length === 0) {
      setKnowledgeHints(GENERAL_HINTS);
      setKnowledgeReasons([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setKnowledgeHintsLoading(true);
      try {
        const tagVocabulary      = buildCustomerTagVocabulary(skinTags, insightTags);
        const categoryVocabulary = buildProductCategoryVocabulary(homecareProducts.map(p => p.productName));
        const { matchedKeywords, matchedCategories } = await fetchKnowledgeMatch(tagVocabulary, categoryVocabulary);
        if (cancelled) return;
        setKnowledgeHints(deriveHintsFromMatchedKeywords(matchedKeywords));
        setKnowledgeReasons(buildMatchReasons({
          matchedTagKeywords: matchedKeywords,
          matchedCategories,
          hasRelatedArticleByProduct: relatedArticles.length > 0,
          hasHomecareProduct: homecareProducts.length > 0,
          hasRecentVisit: visitHistory.length > 0,
          hasRecentPurchase: homecareProducts.length > 0,
        }));
      } finally {
        if (!cancelled) setKnowledgeHintsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [homecareProducts, skinTags, insightTags, relatedArticles, visitHistory]);

  // ─── ロード ────────────────────────────────────────────────────────────────
  // customer_notes 最新分を1回のクエリで取得（①メモ欄プリフィル ②「最近の会話」表示の両方が使う）
  // CUSTOMER_MEMORY_OPTIMIZE_1: recentNotes state だけ更新。savedMemoText/memo の上書きは
  // 呼び出し元（顧客切替時）でのみ行い、音声メモ保存後の再取得では編集中メモを壊さないようにする
  const loadRecentNotes = useCallback(async (customerId: string): Promise<CustomerNote[]> => {
    const { data } = await supabase
      .from('customer_notes')
      .select('id, customer_id, staff_id, note, category, source, voice_note_id, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(6);
    const rows = (data ?? []) as CustomerNote[];
    setRecentNotes(rows.filter(n => n.note?.trim()).slice(0, 3));
    return rows;
  }, []);

  const loadRecentActions = useCallback(async (customerId: string) => {
    setHistoryLoading(true);
    const rows = await fetchRecentActions(customerId, 15);
    setRecentActions(rows);
    setHistoryLoading(false);
  }, []);

  const regeneratePlan = useCallback((tags: SkinTagKey[]) => {
    if (!c || !r) return;
    setHomecarePlan(generateHomecarePlan({
      customerName: c.name, skinTags: tags, menuName: r.menu,
      daysAfterVisit: r.days_since_last_visit ?? 0,
    }));
  }, [c, r]);

  // ─── クローズ ──────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    onClose?.();
    setSelectedCustomer(null);
    setSelectedReservation(null);
    setPage('overview');
    setLogSelected(new Set());
    setLogSaved(false);
    setMemo('');
    setSavedMemoText('');
    setMemoEditing(false);
    setTagEditing(false);
    setLineCopied(false);
    setOpenSections(new Set(['voice'] as SectionKey[]));  // voice はデフォルト展開
    setHomecarePlan(null);
    setDoneActions(new Set());
    setRecentActions([]);
    setRecentNotes([]);
    setVisitHistory([]);
    setTodayFocus(null);
    setNgTopics([]);
    setInsightTags([]);
    setHomecareProducts([]);
    setExpandedUsageCards(new Set());
    setAiHomecareMessages({});
    setLineMessageDraft('');
    setLineMessageCopied(false);
    setLineMessageReasons([]);
    setLineMessageType(null);
    setLineMessageVariant('normal');
    setLineSendLogs([]);
    setAllDone(false);
    setServiceReplay(null);
    resetActiveSession();
    sessionStartRef.current = Date.now();
    setCompletionHint(null);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  }, [onClose, setSelectedCustomer, setSelectedReservation, resetActiveSession]);

  const toggleSection = (key: SectionKey) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ─── Smart Completion Hint ────────────────────────────────────────────────
  const NEXT_HINT: Partial<Record<ActionType, string>> = {
    line_sent:           '次は「再来提案」がおすすめです',
    homecare_explained:  '次は「音声メモ」で肌状態を記録しましょう',
    rebook_recommended:  '「次回提案」完了 — 次はLINEフォローを',
    product_recommended: '提案完了 — 反応を音声メモで残しておきましょう',
    product_purchased:   '🎉 購入確定！対応履歴に記録されました',
  };

  const showHint = useCallback((hint: string) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setCompletionHint(hint);
    hintTimerRef.current = setTimeout(() => setCompletionHint(null), 4000);
  }, []);

  // ─── アクション記録 ────────────────────────────────────────────────────────
  const handleActionButton = useCallback(async (actionType: ActionType) => {
    if (!c || savingAction !== null || doneActions.has(actionType)) return;
    const release = actionMutexRef.current.tryAcquire();
    if (!release) { prodLog('warn', '[BottomSheet] 連打防止', actionType); return; }
    setSavingAction(actionType);
    const { error } = await logAction({
      customerId:    c.id,
      staffId:       currentStaffId,
      actionType,
      actionPayload: {
        menu:             r?.menu ?? null,
        reservation_id:   r?.id   ?? null,
        days_since_visit: r?.days_since_last_visit ?? 0,
      },
    });
    setSavingAction(null);
    if (error) { toast.error('保存に失敗しました'); release(); return; }
    setDoneActions(prev => {
      const next = new Set(prev).add(actionType);
      if (next.size >= ACTION_BUTTONS.length) setAllDone(true);
      return next;
    });
    toast.success(`${ACTION_TYPE_LABELS[actionType]} を記録しました`, { duration: 1600 });
    const hint = NEXT_HINT[actionType];
    if (hint) showHint(hint);
    loadRecentActions(c.id);
    release();
  }, [c, r, currentStaffId, savingAction, doneActions, loadRecentActions, showHint]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 禁忌事項の削除（PHASE CONTRAINDICATION-DELETE-1） ───────────────────────
  // CustomerMemoryTab.handleDelete()と同じ「即削除+toast」パターン(確認ダイアログ無し)。
  const handleDeleteContraindication = useCallback(async (item: Contraindication) => {
    const { error } = await deleteContraindication(item.id);
    if (error) { toast.error('削除に失敗しました'); return; }
    toast.success('削除しました', { duration: 1500 });
    setContraindications(prev => prev.filter(ci => ci.id !== item.id));
  }, []);

  // ─── 肌タグ保存 ────────────────────────────────────────────────────────────
  const saveSkinTags = useCallback(async () => {
    if (!c || tagSaving) return;
    setTagSaving(true);

    try {
      const res = await authedFetch(`/api/customers/${c.id}/skin-tags`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ skin_tags: editingTags }),
      });
      if (!res.ok) throw new Error();
      setSkinTags(editingTags);
      regeneratePlan(editingTags);
      setTagEditing(false);
      toast.success('肌タグを保存しました 🌸', { duration: 2000 });
    } catch {
      toast.error('肌タグの保存に失敗しました');
    } finally {
      setTagSaving(false);
    }
  }, [c, editingTags, tagSaving, regeneratePlan]);

  // ─── ログ保存 ──────────────────────────────────────────────────────────────
  const saveLog = useCallback(async () => {
    if (logSaving || logSaved || !c) return;
    // staff_logs.staff_idはNOT NULL制約のため、currentStaffId未取得のままINSERTすると
    // DB側のNOT NULL違反で失敗する(docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md §9.1)。
    // セッション未確立・喪失時にDBエラーへ委ねず、ここで理由が分かる形で止める。
    if (!currentStaffId) {
      toast.error('スタッフ情報が取得できないため保存できません。再読み込みしてください。');
      return;
    }
    setLogSaving(true);

    const { error } = await supabase.from('staff_logs').insert({
      reservation_id: r?.id ?? null,
      customer_id:    c.id,
      staff_id:       currentStaffId,
      ai_adopted:     logSelected.has('ai_adopted'),
      next_reserved:  logSelected.has('next_reserved'),
      option_sold:    logSelected.has('option_sold'),
      retail_sold:    logSelected.has('retail_sold'),
      churn_followed: logSelected.has('churn_followed'),
      service_completed: true,
    });
    setLogSaving(false);
    if (error) { toast.error('保存に失敗しました'); return; }

    setLogSaved(true);
    toast.success('接客ログを保存しました 🌸', { duration: 2500 });

    // ── brain_visits.next_booking_made反映(Phase 1-E、非致命的) ──────────────
    // メニュー未解決・当日visit不在等は接客ログ本体(staff_logs)の保存成功に影響させない。
    if (r?.menu) {
      authedFetch('/api/visits/service-complete', {
        method: 'POST',
        body: JSON.stringify({
          customerId: c.id,
          menuName: r.menu,
          nextBookingMade: logSelected.has('next_reserved'),
          homecarePurchased: logSelected.has('retail_sold'),
        }),
      }).catch(() => { /* next_booking_made反映失敗は無視(接客ログ自体は保存済み) */ });
    }

    setServiceReplay(buildServiceReplay({
      reservationId:      r?.id ?? null,
      customerId:         c.id,
      actionsDoneToday:   Array.from(doneActions),
      logsDoneToday:      Array.from(logSelected),
      menuName:           r?.menu ?? '',
      churnRisk:          c.churn_risk,
      daysSinceLastVisit: r?.days_since_last_visit ?? 0,
    }));
  }, [logSaving, logSaved, c, r, currentStaffId, logSelected, doneActions]);

  // ─── メモ保存 ──────────────────────────────────────────────────────────────
  const saveMemo = useCallback(async () => {
    if (!memo.trim() || !c || memoSaving) return;
    setMemoSaving(true);

    const { error } = await supabase.from('customer_notes').insert({
      customer_id: c.id, staff_id: currentStaffId,
      note: memo.trim(), created_at: new Date().toISOString(),
    });
    setMemoSaving(false);
    if (error) { toast.error('メモの保存に失敗しました'); return; }

    setSavedMemoText(memo.trim());
    setMemoEditing(false);
    toast.success('メモを保存しました 🌸', { duration: 2000 });
  }, [memo, c, currentStaffId, memoSaving]);

  // ─── LINE送信履歴（PHASE LINE-LOG-1） ────────────────────────────────────────
  // このアプリはLINEを直接送信しないため、「コピー」操作を送信とみなして記録する。
  // 短時間の重複送信防止(③)は警告表示のみで、コピー自体はブロックしない
  // (最終判断はスタッフが行う、という既存のAI提案等と同じ方針)。
  const DUPLICATE_WARNING_HOURS = 2;
  const warnIfRecentlySent = useCallback((kind: LineSendLogEntry['kind']) => {
    const thresholdMs = DUPLICATE_WARNING_HOURS * 60 * 60 * 1000;
    const recent = lineSendLogs.find(
      l => l.kind === kind && Date.now() - new Date(l.occurredAt).getTime() < thresholdMs
    );
    if (recent) toast.warning(`${LINE_SEND_KIND_LABEL[kind]}メッセージは最近送信済みです`, { duration: 2500 });
  }, [lineSendLogs]);

  const recordLineSend = useCallback(async (kind: LineSendLogEntry['kind'], title: string) => {
    if (!c) return;
    try {
      const res = await authedFetch(`/api/customers/${c.id}/line-send-log`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ kind, title }),
      });
      if (res.ok) {
        const json = await res.json() as { success: boolean; log?: LineSendLogEntry };
        if (json.success && json.log) setLineSendLogs(prev => [json.log!, ...prev]);
      }
    } catch { /* 履歴記録に失敗してもコピー操作自体は既に完了しているため無視する */ }
  }, [c]);

  // ─── LINE コピー ────────────────────────────────────────────────────────────
  const copyLineDraft = useCallback(async () => {
    if (!homecarePlan?.lineDraft) return;
    warnIfRecentlySent('homecare');
    try {
      await navigator.clipboard.writeText(homecarePlan.lineDraft);
      setLineCopied(true);
      toast.success('コピーしました', { duration: 1500 });
      setTimeout(() => setLineCopied(false), 2500);
      void recordLineSend('homecare', 'ホームケアプランのご案内');
    } catch { toast.error('コピーに失敗しました'); }
  }, [homecarePlan, warnIfRecentlySent, recordLineSend]);

  // ─── ホームケア使い方カード（PHASE HC-4） ───────────────────────────────────
  const toggleUsageCard = useCallback((productName: string) => {
    setExpandedUsageCards(prev => {
      const next = new Set(prev);
      next.has(productName) ? next.delete(productName) : next.add(productName);
      return next;
    });
  }, []);

  const copyUsageMessage = useCallback(async (productName: string, message: string) => {
    warnIfRecentlySent('usage_card');
    try {
      await navigator.clipboard.writeText(message);
      setCopiedUsageProduct(productName);
      toast.success('メッセージをコピーしました', { duration: 1500 });
      setTimeout(() => setCopiedUsageProduct(null), 2500);
      void recordLineSend('usage_card', productName);
    } catch { toast.error('コピーに失敗しました'); }
  }, [warnIfRecentlySent, recordLineSend]);

  // ─── ホームケアAIメッセージ生成（PHASE HC-6・失敗時は辞書メッセージへフォールバック） ──
  const generateAiHomecareMessage = useCallback(async (
    productName:       string,
    lastPurchasedAt:   string,
    daysSincePurchase: number,
  ) => {
    if (!c || aiGeneratingProduct !== null) return;
    setAiGeneratingProduct(productName);
    try {
      const res = await authedFetch(`/api/customers/${c.id}/homecare-message`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          productName, lastPurchasedAt, daysSincePurchase, customerName: c.name,
          // PHASE MENU-AI-4: 直近来店(visitHistory[0]。visit_date降順)のmenu_idを渡す。
          // 未指定/取得不可時はAPI側が従来どおり生成する(buildMenuAIContext参照)。
          menuId: visitHistory[0]?.menuId ?? undefined,
        }),
      });
      const json = res.ok
        ? await res.json() as { success: boolean; message?: string }
        : { success: false as const };
      if (json.success && json.message) {
        setAiHomecareMessages(prev => ({ ...prev, [productName]: json.message! }));
        toast.success('AIメッセージを生成しました', { duration: 1500 });
      } else {
        toast.error('AI生成に失敗したため既存メッセージのままです');
      }
    } catch {
      toast.error('AI生成に失敗したため既存メッセージのままです');
    } finally {
      setAiGeneratingProduct(null);
    }
  }, [c, aiGeneratingProduct, visitHistory]);

  // ─── LINEメッセージ生成（PHASE2-C-4・PHASE LINE-AI-1でtype対応拡張・生成/編集/コピーのみ。
  //     送信APIは呼ばない）──────
  // type: 'thanks'(来店お礼) | 'homecare'(ホームケア提案) | 'reminder'(来店リマインド)。
  // customer_memories本文・AI Timelineのsummary/recentChange/nextFocusは一切送らない
  // （ユーザー指示・2026-07-31確定。音声メモ由来の文脈はinsightTags(ルールベース抽出済み
  // タグ)のみを使う）。
  // LINE UX改善: variant('normal'|'short')の切り替えと、「別案を生成」(alternate)に対応。
  // alternate=trueのときは直前の下書き文面をpreviousDraftとしてAPIへ渡し、表現を変えた
  // 別パターンを作らせる(DB保存はしない・APIへ渡すだけ)。
  const generateLineMessage = useCallback(async (
    type: 'thanks' | 'homecare' | 'reminder',
    opts?: { variant?: 'normal' | 'short'; alternate?: boolean },
  ) => {
    if (!c || lineMessageGenerating) return;
    const variant = opts?.variant ?? 'normal';
    setLineMessageGenerating(true);
    try {
      const res = await authedFetch(`/api/customers/${c.id}/line-message`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type,
          variant,
          previousDraft: opts?.alternate && lineMessageDraft ? lineMessageDraft : undefined,
          customerName: c.name,
          skinTags:     skinTags.map(t => SKIN_TAG_LABELS[t]).filter(Boolean),
          recentVisits: visitHistory.slice(0, 3).map(v => ({ menuName: v.menuName, visitDate: v.visitDate })),
          homecareProducts: homecareProducts.slice(0, 3).map(p => ({
            productName: p.productName, lastPurchasedAt: p.lastPurchasedAt,
          })),
          recentNoteSummaries: recentNotes.slice(0, 3).map(n => n.note).filter(Boolean),
          insightTags:            insightTags,
          visitCount:             c.visits ?? c.visit_count,
          lastVisitDate:          c.last_visit ?? null,
          recommendedCycleDays:   c.recommended_cycle_days ?? null,
          churnRisk:              c.churn_risk ?? null,
          contraindicationTitles: contraindications.map(ci => ci.title),
          // PHASE MENU-AI-3: 直近来店(visitHistory[0]。visit_date降順)のmenu_idを渡す。
          // API側がmenuId指定時のみMenu AI Context(施術メニューのai_tags/カテゴリ/
          // 価格帯/施術時間/禁忌/おすすめ頻度)をプロンプト末尾に追記する
          // (buildMenuAIContext参照。未指定/取得不可時は従来どおり生成)。
          menuId: visitHistory[0]?.menuId ?? undefined,
        }),
      });
      const json = res.ok
        ? await res.json() as { success: boolean; message?: string; reasons?: MatchReason[] }
        : { success: false as const };
      if (json.success && json.message) {
        setLineMessageDraft(json.message);
        setLineMessageReasons(json.reasons ?? []);
        setLineMessageCopied(false);
        setLineMessageType(type);
        setLineMessageVariant(variant);
        toast.success(opts?.alternate ? '別案を生成しました' : 'LINE文面を生成しました', { duration: 1500 });
      } else {
        setLineMessageReasons([]);
        toast.error('生成に失敗しました。もう一度お試しください');
      }
    } catch {
      setLineMessageReasons([]);
      toast.error('生成に失敗しました。もう一度お試しください');
    } finally {
      setLineMessageGenerating(false);
    }
  }, [c, lineMessageGenerating, lineMessageDraft, skinTags, visitHistory, homecareProducts, recentNotes, insightTags, contraindications]);

  // LINE UX改善: 下書きクリア。ローカルstateのみをリセットし、送信済みログ・送信フローには
  // 一切触れない(APIコールなし)。
  const clearLineMessageDraft = useCallback(() => {
    setLineMessageDraft('');
    setLineMessageCopied(false);
    setLineMessageReasons([]);
    setLineMessageType(null);
    setLineMessageVariant('normal');
  }, []);

  // コピー操作を送信とみなして記録する(PHASE LINE-LOG-1)。kindは直近に生成した種別。
  const copyLineMessageDraft = useCallback(async () => {
    if (!lineMessageDraft || !lineMessageType) return;
    const kind = lineMessageType;
    warnIfRecentlySent(kind);
    try {
      await navigator.clipboard.writeText(lineMessageDraft);
      setLineMessageCopied(true);
      toast.success('コピーしました', { duration: 1500 });
      setTimeout(() => setLineMessageCopied(false), 2500);
      void recordLineSend(kind, `${LINE_SEND_KIND_LABEL[kind]}メッセージ`);
    } catch { toast.error('コピーに失敗しました'); }
  }, [lineMessageDraft, lineMessageType, warnIfRecentlySent, recordLineSend]);

  // ─── Adaptive Priority ────────────────────────────────────────────────────
  const sectionPriority = useSectionPriority(c ?? null, servicePhase, timePressure);

  // PHASE10: doneActions を安定した配列に変換（Set は参照が毎回変わるため）
  const doneActionsArr = useMemo(
    () => Array.from(doneActions),
    [doneActions]
  );

  const adaptivePriorities = useMemo(() => {
    if (!c) return null;
    const relState =
      c.churn_risk >= 70 ? 'at_risk' :
      c.churn_risk >= 45 ? 'cooling' :
      c.visits    <= 3   ? 'forming' :
      c.visits    >= 8   ? 'stable'  : 'growing';
    const input: AdaptivePriorityInput = {
      customer: {
        relationshipState: relState,
        riskLevel: c.churn_risk >= 70 ? 'high' : c.churn_risk >= 40 ? 'medium' : 'low',
        visitCycle:    c.recommended_cycle_days ?? 35,
        customerTags:  [...(c.skin_tags ?? []), c.customer_type],
        lineReplyRate: c.line_response_rate,
        purchaseTrend: undefined,
      },
      activeSession: {
        servicePhase, timePressure,
        elapsedTime: 0, completedActions: Array.from(doneActions),
      },
      currentContext: { role: 'staff', device: 'mobile' },
    };
    return calculateSectionPriorities(input);
  }, [c, servicePhase, timePressure, doneActionsArr]);

  /** セクションを表示するか */
  const visible = (section: DisplaySection) =>
    !sectionPriority || isSectionVisible(sectionPriority[section], timePressure);

  // ── 今日気をつけること: アレルギー表示（PHASE UX-1・contraindicationsから抽出） ──
  const allergyText = useMemo(() => {
    const item = contraindications.find(ci => ci.title.includes('アレルギー'));
    if (!item) return null;
    return item.description || item.title;
  }, [contraindications]);

  // ── Customer Memory サマリー行（CUSTOMER_MEMORY_IMPLEMENT_1）: 既取得データのみ使用 ──
  const topContraindication = useMemo(() => {
    if (contraindications.length === 0) return null;
    const sorted = [...contraindications].sort(
      (a, b) => CONTRAINDICATION_SEVERITY_ORDER.indexOf(a.severity) - CONTRAINDICATION_SEVERITY_ORDER.indexOf(b.severity)
    );
    return { title: sorted[0].title, description: sorted[0].description ?? '' };
  }, [contraindications]);

  const handoverTask = useMemo(() => {
    if (!handover) return null;
    return handover.open_tasks?.[0] ?? handover.summary ?? null;
  }, [handover]);

  const lastVisitForMemory = useMemo(() => {
    const v = visitHistory[0];
    return v ? { date: v.visitDate, menuName: v.menuName } : null;
  }, [visitHistory]);

  // [DEBUG] マウント時: customer.id を確認
  useEffect(() => {
    if (!c) return
    console.group('[BottomSheet] MOUNT')
    console.log('customer.id  :', c.id)
    console.log('customer.name:', c.name)
    console.log('reservation.id:', r?.id ?? 'null')
    console.groupEnd()
  }, [c?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // [DEBUG] フェーズ切替時: 全セクションの visible を出力
  useEffect(() => {
    if (!c) return
    const sections = ['voiceMemo','homeCare','timeline','nextAction','aiInsight','lineDraft','storeLearning'] as const
    console.group(`[BottomSheet] PHASE: ${servicePhase}`)
    console.log('customer.id:', c.id)
    sections.forEach(s => {
      const ap = adaptivePriorities?.[s]
      console.log(`  ${s.padEnd(16)} score=${String(ap?.score??'n/a').padStart(3)}  level=${ap?.level??'n/a'}  visible=${visible(s)}`)
    })
    console.groupEnd()
  }, [servicePhase, timePressure]) // eslint-disable-line react-hooks/exhaustive-deps

  /** compact 表示にするか（PHASE10 Quiet Mode: medium/low + score < 55） */
  const isCompact = (section: DisplaySection): boolean => {
    const ap = adaptivePriorities?.[section];
    if (!ap) return false;
    // timePressure 時はさらに積極的に compact
    if (timePressure) return ap.level !== 'critical';
    return ap.level === 'medium' || ap.level === 'low' || ap.score < 55;
  };

  // ─── 計算値 ────────────────────────────────────────────────────────────────
  const isDanger = !!c && (r?.days_since_last_visit ?? 0) >= 60;
  const fallback = c ? (TYPE_COPY[c.customer_type] ?? TYPE_COPY['慎重・不安型']) : null;
  const aiAdvice = aiSuggestion?.strategy_logic?.adviceMessage
    ?? (c && fallback ? `${c.name}様には「${fallback.goal}」を意識した接客を心がけましょう。` : '');
  const aiNg = fallback?.ng ?? '';
  const returnInfo = r ? getReturnTiming(r.menu, r.days_since_last_visit ?? 0) : null;

  // ─── ─────────────────────────────────────────────────────────────────────────
  //  サブコンポーネント（state 共有のため関数内定義）
  // ─────────────────────────────────────────────────────────────────────────────

  /** 肌タグ表示・編集 */
  const SkinTagSection = () => (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold">🏷️ 肌タグ</p>
        <button
          onClick={() => { setTagEditing(!tagEditing); setEditingTags(skinTags); }}
          className="text-[11px] text-[#C8A58C] bg-white border border-[#F5E6E8] rounded-full px-3 py-0.5 cursor-pointer"
        >
          {tagEditing ? 'キャンセル' : '編集'}
        </button>
      </div>
      {tagEditing ? (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {SKIN_TAG_KEYS.map(key => {
              const sel = editingTags.includes(key);
              return (
                <button key={key}
                  onClick={() => setEditingTags(p => sel ? p.filter(t => t !== key) : [...p, key])}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                    sel
                      ? 'border-[#F56E8B] bg-[#FFF0F3] text-[#F56E8B]'
                      : 'border-[#E8D5D8] bg-white text-[#9F7E6C]'
                  }`}>
                  {SKIN_TAG_LABELS[key]}
                </button>
              );
            })}
          </div>
          <button onClick={saveSkinTags} disabled={tagSaving}
            className={`w-full py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
              tagSaving ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B]'
            }`}>
            {tagSaving ? '保存中…' : 'タグを保存'}
          </button>
        </>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {skinTags.length === 0
            ? <p className="text-xs text-[#C8A8B0]">タグ未設定 — 編集から追加</p>
            : skinTags.map(key => (
                <span key={key}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFF0F3] text-[#F56E8B] border border-[#F5C6D0]">
                  {SKIN_TAG_LABELS[key] ?? key}
                </span>
              ))}
        </div>
      )}
    </div>
  );

  /** 再来推奨タイミングバッジ */
  const ReturnTimingBadge = () => {
    if (!returnInfo) return null;
    const col = returnInfo.isDanger ? '#C05060' : returnInfo.isOverdue ? '#D4A020' : '#34A090';
    const bgCls = returnInfo.isDanger ? 'bg-[#FFF0F2]' : returnInfo.isOverdue ? 'bg-[#FFFBF0]' : 'bg-[#F0FAF7]';
    return (
      <div className={`${bgCls} rounded-2xl px-4 py-2.5 flex items-center gap-2`}
        style={{ border: `1px solid ${col}22` }}>
        <span className="text-base">{returnInfo.isDanger ? '⚠️' : returnInfo.isOverdue ? '🔔' : '📅'}</span>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: col }}>再来推奨タイミング</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: col }}>{returnInfo.label}</p>
          <p className="text-[10px] text-[#9F7E6C] mt-0.5">推奨サイクル {returnInfo.cycleDays}日 / {r?.menu}</p>
        </div>
      </div>
    );
  };

  /** 実施済みアクション記録（Action Chain UI） */
  const ActionButtonGroup = () => (
    <motion.div
      animate={allDone ? {
        boxShadow: ['0 0 0px rgba(128,96,168,0)', '0 0 20px rgba(128,96,168,0.18)', '0 0 0px rgba(128,96,168,0)']
      } : {}}
      transition={{ duration: 1.6, repeat: allDone ? 2 : 0 }}
      className="bg-[#F5F0FA] rounded-[22px] p-4"
    >
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] tracking-[0.18em] text-[#8060A8] font-semibold">⚡ 実施済みを記録</p>
        <AnimatePresence>
          {allDone && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
              className="text-[10px] px-2.5 py-0.5 rounded-full text-[#8060A8] font-semibold"
              style={{ background: 'rgba(128,96,168,0.1)', border: '1px solid rgba(128,96,168,0.25)' }}
            >
              接客フロー完了 ✓
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Smart Completion Hint */}
      <AnimatePresence>
        {completionHint && (
          <motion.div
            key="hint"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 mb-2.5 text-xs text-[#8060A8]"
            style={{ background: 'rgba(128,96,168,0.07)', border: '1px solid rgba(128,96,168,0.18)' }}
          >
            <span className="text-sm flex-shrink-0">✦</span>
            {completionHint}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        {ACTION_BUTTONS.map(({ action, emoji, label }) => {
          const done   = doneActions.has(action);
          const saving = savingAction === action;
          return (
            <motion.button key={action}
              whileTap={{ scale: 0.975 }} layout
              onClick={() => handleActionButton(action)}
              disabled={done || saving}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl transition-all ${
                done
                  ? 'bg-[#EDE8F5] cursor-default opacity-70'
                  : 'bg-white cursor-pointer'
              }`}
              style={{ border: `1.5px solid ${done ? '#8060A8' : '#DDD0EA'}` }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[17px]">{emoji}</span>
                <span className={`text-sm font-medium ${done ? 'text-[#8060A8]' : 'text-[#5C4033]'}`}>{label}</span>
              </div>
              <motion.div
                animate={done ? { scale: [1.3, 1], backgroundColor: ['#B080D8', '#8060A8'] } : {}}
                transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{
                  border: `1.5px solid ${done ? '#8060A8' : '#C8B0D8'}`,
                  background: done ? '#8060A8' : 'transparent',
                }}
              >
                {done && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.05, duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                    className="text-white text-[10px] font-bold"
                  >✓</motion.span>
                )}
                {saving && <span className="text-white text-[10px] font-bold">…</span>}
              </motion.div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );

  /** ホームケアプランアコーディオン */
  const HomecareAccordion = () => {
    const open = openSections.has('homecare');
    if (!homecarePlan) return null;
    return (
      <div className="bg-[#F8F1F3] rounded-[22px] overflow-hidden">
        <button onClick={() => toggleSection('homecare')}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-transparent border-none cursor-pointer">
          <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold">🧴 ホームケアプラン</p>
          <span className="text-sm text-[#C8A58C] transition-transform duration-200 inline-block"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
        {open && (
          <div className="px-4 pb-4 flex flex-col gap-2.5">
            {([
              { label: '✅ 今日のケア',   items: homecarePlan.todayCare, cls: 'bg-[#F0FAF7] text-[#34A090]' },
              { label: '⛔ NGアクション', items: homecarePlan.ngActions, cls: 'bg-[#FFF0F2] text-[#C05060]' },
              { label: '💡 注意ポイント', items: homecarePlan.cautions,  cls: 'bg-[#FFFBF0] text-[#A07020]' },
              { label: '🛍 商品提案',     items: homecarePlan.products,  cls: 'bg-[#F5F0FA] text-[#8060B0]' },
            ] as const).map(({ label, items, cls }) =>
              items.length > 0 && (
                <div key={label} className={`${cls.split(' ')[0]} rounded-2xl px-3 py-2.5`}>
                  <p className={`text-[10px] font-semibold tracking-[0.1em] mb-1.5 ${cls.split(' ')[1]}`}>{label}</p>
                  {items
                    .filter((item) => item?.trim())
                    .map((item, i) => (
                      <p key={i} className="text-xs text-[#5C4033] leading-relaxed mb-1 last:mb-0">・{item}</p>
                    ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  };

  /** LINE下書きアコーディオン */
  const LineDraftAccordion = () => {
    const open = openSections.has('line');
    if (!homecarePlan?.lineDraft) return null;
    return (
      <div className="bg-[#F0FAF5] rounded-[22px] border border-[#D0F0E0] overflow-hidden">
        <button onClick={() => toggleSection('line')}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-transparent border-none cursor-pointer">
          <p className="text-[11px] tracking-[0.18em] text-[#34A070] font-semibold">💬 LINE下書き</p>
          <span className="text-sm text-[#34A070] transition-transform duration-200 inline-block"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
        {open && (
          <div className="px-4 pb-3.5">
            {/* 送信済み表示（PHASE LINE-LOG-1・コピー操作を送信とみなした近似） */}
            {sentStatusLabel(lineSendLogs, 'homecare') && (
              <span className="inline-block text-[9px] font-semibold text-[#34A070] bg-white rounded-full px-2 py-0.5 border border-[#D0F0E0] mb-1.5">
                {sentStatusLabel(lineSendLogs, 'homecare')}
              </span>
            )}
            <div className="bg-white rounded-2xl p-3 border border-[#C0E8D0] mb-2.5">
              <p className="text-sm text-[#3C5C45] leading-[1.8] whitespace-pre-wrap font-['Noto_Sans_JP']">
                {homecarePlan.lineDraft}
              </p>
            </div>
            <button onClick={copyLineDraft}
              className={`w-full py-2.5 rounded-full text-sm font-bold text-white flex items-center justify-center gap-1.5 transition-colors ${
                lineCopied ? 'bg-[#34D399]' : 'bg-[#2ECC8A]'
              }`}>
              {lineCopied
                ? <><Check size={14} strokeWidth={2.5} /> コピー済み</>
                : <><Copy size={14} strokeWidth={2} /> テキストをコピー</>
              }
            </button>
          </div>
        )}
      </div>
    );
  };

  /** LINE送信履歴アコーディオン（PHASE LINE-LOG-1）。
   *  「送信」はLINE Messaging APIの実送信ではなく、コピー操作を送信とみなした近似ログ。
   *  種類・タイトルのみ表示（本文は表示しない）。 */
  const LineSendLogAccordion = () => {
    const open = openSections.has('lineSendLog');
    if (lineSendLogs.length === 0 && !lineSendLogsLoading) return null;
    return (
      <div className="bg-[#F8F1F3] rounded-[22px] overflow-hidden">
        <button onClick={() => toggleSection('lineSendLog')}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-transparent border-none cursor-pointer">
          <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold">📨 LINE送信履歴</p>
          <span className="text-sm text-[#C8A58C] transition-transform duration-200 inline-block"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
        {open && (
          <div className="px-4 pb-3.5 flex flex-col gap-1.5">
            {lineSendLogsLoading && <p className="text-xs text-[#C8A8B0]">読み込み中…</p>}
            {!lineSendLogsLoading && lineSendLogs.length === 0 && (
              <p className="text-xs text-[#C8A8B0]">送信履歴はまだありません</p>
            )}
            {lineSendLogs.slice(0, 10).map((log, i) => (
              <div key={`${log.occurredAt}-${i}`} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#5C4033] truncate">{log.title}</p>
                  <p className="text-[10px] text-[#C8A58C]">{LINE_SEND_KIND_LABEL[log.kind]}</p>
                </div>
                <p className="text-[10px] text-[#9F7E6C] flex-shrink-0 whitespace-nowrap">
                  {new Date(log.occurredAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}{' '}
                  {new Date(log.occurredAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── レンダー ──────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && c && r && (
        <>
          {/* オーバーレイ */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={close}
            className="fixed inset-0 z-40"
            style={{
              background:          'rgba(92,64,51,0.18)',
              backdropFilter:      'blur(6px)',
              touchAction:         'none',
              WebkitOverflowScrolling: 'touch',
            }}
          />

          {/* シート */}
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="sheet"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 260 }}
              className="w-full max-w-[430px] pointer-events-auto bg-white"
              style={{
                // visualViewport.height を使うことでキーボード表示時にシートが潰れない
                height: 'calc(var(--vh, 1dvh) * 88)',
                maxHeight: 'calc(var(--vh, 1dvh) * 88)',
                borderRadius: '36px 36px 0 0',
                boxShadow: '0 -8px 40px rgba(92,64,51,0.14)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* ドラッグハンドル(表示のみ・スワイプでは閉じない) + 右上Closeボタン(常時固定・44px以上のタップ領域) */}
              <div className="flex-shrink-0 relative" style={{ minHeight: '44px' }}>
                <div className="absolute inset-x-0 flex justify-center" style={{ top: '12px' }}>
                  <div className="w-12 h-[5px] rounded-full bg-[#E8D5D8]" />
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="閉じる"
                  className="absolute rounded-full flex items-center justify-center"
                  style={{
                    top: '2px', right: '8px',
                    width: '44px', height: '44px',
                    background: '#F8F1F3',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <X size={18} color="#9F7E6C" strokeWidth={2.5} />
                </button>
              </div>

              {/* 禁忌事項 — 最重要・常時表示（スクロールで隠れない・折りたたみ不可・全ページ共通固定） */}
              {(contraindicationsLoading || contraindications.length > 0) && (
                <div className="flex-shrink-0 px-5 pb-2">
                  <ErrorBoundary label="ContraindicationSection" silentFail>
                    <ContraindicationSection
                      items={contraindications}
                      loading={contraindicationsLoading}
                      onDelete={handleDeleteContraindication}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {/* SHEET コンテンツ（flex-1 で残り高さを埋める） */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <AnimatePresence mode="wait">

                {/* ════════════════════════════
                    SHEET A — 顧客概要
                ════════════════════════════ */}
                {page === 'overview' && (
                  <motion.div key="overview"
                    initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="flex-1 flex flex-col min-h-0"
                  >
                    {/* スクロール領域 */}
                    <div className="flex-1 min-h-0 overflow-y-auto"
                      style={{
                        padding: '8px 20px 24px',
                        WebkitOverflowScrolling: 'touch',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                      }}>

                      {/* 顧客ヘッダー */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <img src="/riora-os/rio-kuma.png" alt=""
                            className="w-11 h-11 object-contain flex-shrink-0" />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xl font-bold text-[#5C4033] leading-tight">
                                {c.name} 様
                              </span>
                              {isDanger && (
                                <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FFF0F2] text-[#C05060]">
                                  失客注意
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#C8A58C] mt-0.5">
                              {r.menu}　来店 {c.visits}回
                            </p>
                          </div>
                        </div>
                        <button onClick={close}
                          className="w-8 h-8 rounded-full bg-[#F8F1F3] border-none flex items-center justify-center cursor-pointer flex-shrink-0">
                          <X size={14} color="#C8A58C" strokeWidth={2.5} />
                        </button>
                      </div>

                      {/* ════════════════════════════
                          PHASE UX-1: 5秒で接客準備できるブリーフィング
                      ════════════════════════════ */}

                      {/* 今日気をつけること */}
                      <div className="bg-[#FFF0F2] rounded-[22px] p-4 border border-[#F5D0D5]">
                        <p className="text-[11px] tracking-[0.18em] text-[#C05060] font-semibold mb-2.5">
                          ⚠️ 今日気をつけること
                        </p>
                        <div className="flex flex-col gap-2.5">
                          {/* PHASE UX-3C: 今日のFocus(timeline_summary_cache.focus)は構造的に常にnullのため非表示化。
                              取得ロジック自体は変更しない(ロジック変更禁止) */}
                          {([
                            { label: 'アレルギー',    value: allergyText },
                            { label: '触れない話題',   value: ngTopics.length > 0 ? ngTopics.join('、') : null },
                          ] as const).map(({ label, value }) => (
                            <div key={label}>
                              <p className="text-[10px] text-[#C8886E] tracking-[0.08em] mb-0.5">{label}</p>
                              <p className="text-sm text-[#5C4033] leading-relaxed">{value || '登録なし'}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 前回施術 */}
                      {visitHistory[0] && (
                        <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                          <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
                            💆 前回施術
                          </p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-[10px] text-[#9F7E6C] mb-1">来店日</p>
                              <p className="text-sm font-bold text-[#5C4033]">
                                {new Date(visitHistory[0].visitDate).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] text-[#9F7E6C] mb-1">メニュー</p>
                              <p className="text-sm font-bold text-[#5C4033] truncate">
                                {visitHistory[0].menuName ?? '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[#9F7E6C] mb-1">金額</p>
                              <p className="text-sm font-bold text-[#5C4033]">
                                ¥{visitHistory[0].amount.toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 来店履歴（直近4件） */}
                      <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                        <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
                          📅 来店履歴
                        </p>
                        {visitHistoryLoading ? (
                          <p className="text-xs text-[#C8A58C] py-1">読み込み中…</p>
                        ) : visitHistory.length === 0 ? (
                          <p className="text-xs text-[#C8A58C] py-1">来店履歴がありません</p>
                        ) : (
                          <div className="flex flex-col gap-2 mb-1">
                            {visitHistory.slice(0, 4).map(v => (
                              <div key={v.id}
                                className="flex items-center justify-between bg-white rounded-2xl px-3.5 py-2.5">
                                <span className="text-xs font-semibold text-[#5C4033] flex-shrink-0">
                                  {new Date(v.visitDate).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </span>
                                <span className="text-xs text-[#9F7E6C] truncate ml-2">
                                  {v.menuName ?? 'メニュー未登録'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={() => setPage('timeline')}
                          className="w-full text-center text-xs text-[#F56E8B] font-semibold py-2 bg-transparent border-none cursor-pointer">
                          詳しく見る（前回・履歴・AIまとめ）
                        </button>
                      </div>

                      {/* 覚えておくこと — 接客前ブリーフィング（AI提案より上） */}
                      <ErrorBoundary label="CustomerMemorySection" silentFail>
                        <CustomerMemorySection
                          customerId={c.id}
                          onManage={() => setPage('memory')}
                          refreshKey={memoryRefreshKey}
                          topContraindication={topContraindication}
                          handoverTask={handoverTask}
                          lastVisit={lastVisitForMemory}
                          recentNotes={recentNotes}
                        />
                      </ErrorBoundary>

                      {/* Today's AI Brief */}
                      <ErrorBoundary label="BookingPromptSection" silentFail>
                        <BookingPromptSection
                          prompt={bookingPrompt}
                          loading={bookingPromptLoading}
                          collapsed={bookingPromptCollapsed}
                          onToggle={() => setBookingPromptCollapsed(p => !p)}
                        />
                      </ErrorBoundary>

                      {/* AI Handover */}
                      <ErrorBoundary label="HandoverSection" silentFail>
                        <HandoverSection
                          handover={handover}
                          loading={handoverLoading}
                          collapsed={handoverCollapsed}
                          onToggle={() => setHandoverCollapsed(p => !p)}
                        />
                      </ErrorBoundary>

                      {/* KPI(AUTH-2b: 累計売上を削除。金額をスタッフ間の比較材料にしない方針。v1: LINE反応率は非表示) */}
                      <div className="bg-[#F8F1F3] rounded-[18px] py-3 px-2 text-center">
                        <p className="text-base font-bold text-[#5C4033] leading-none mb-1
                          font-['Inter']">{c.visits}回</p>
                        <p className="text-[10px] text-[#9F7E6C]">来店回数</p>
                      </div>

                      {/* AI ノート（Voice Memo → AI解析 → カテゴリ別自動生成） */}
                      <ErrorBoundary label="CustomerNotesSection" silentFail>
                        <CustomerNotesSection
                          customerId={c.id}
                          refreshKey={notesRefreshKey}
                        />
                      </ErrorBoundary>

                      {/* AI インサイト */}
                      {visible('aiInsight') && (
                        <ErrorBoundary label="CustomerInsightPanel" silentFail>
                          <CustomerInsightPanel
                            customerId={c.id}
                            refreshKey={insightRefreshKey}
                          />
                        </ErrorBoundary>
                      )}

                      {/* 次にやるべきこと */}
                      {visible('nextAction') && (
                        <ErrorBoundary label="NextActionPanel" silentFail>
                          <NextActionPanel
                            customerId={c.id}
                            staffId={currentStaffId}
                            visits={c.visits}
                            totalSales={c.total_sales}
                            lineResponseRate={c.line_response_rate}
                            vipRank={c.vip_rank}
                            churnRisk={c.churn_risk}
                            daysSinceLastVisit={r.days_since_last_visit ?? 0}
                            skinTags={skinTags}
                            menuName={r.menu}
                            recommendedCycleDays={c.recommended_cycle_days}
                            homecareProductNames={homecareProducts.map(p => p.productName)}
                            reservationId={r.id}
                            onActionLogged={() => loadRecentActions(c.id)}
                            compact={isCompact('nextAction')}
                            excludeIds={['phase_new_rebook']}
                          />
                        </ErrorBoundary>
                      )}

                      {/* 接客コンテキスト（リスク・関係性・SmartFollow） */}
                      {visible('storeLearning') && (
                        <ErrorBoundary label="CustomerRiskCard" silentFail>
                          <CustomerRiskCard
                            customerId={c.id}
                            customerName={c.name}
                            visits={c.visits}
                            totalSales={c.total_sales}
                            lineResponseRate={c.line_response_rate}
                            vipRank={c.vip_rank}
                            churnRisk={c.churn_risk}
                            daysSinceLastVisit={r.days_since_last_visit ?? 0}
                            skinTags={skinTags}
                            menuName={r.menu}
                            avgPrice={c.avg_price}
                            recommendedCycleDays={c.recommended_cycle_days}
                          />
                        </ErrorBoundary>
                      )}

                      {/* 今日の接客ポイント(STAFF_PROPOSAL_LEARNING_PIPELINE: ProposalOrchestrator
                          由来の実データへ差し替え。取得できない場合は従来のfallback文言(aiAdvice/
                          aiNg、TYPE_COPYベース)をそのまま表示する。算出ロジック自体は無変更) */}
                      <ErrorBoundary label="AIProposalCard" silentFail>
                        <AIProposalCard
                          customerId={c.id}
                          fallbackAdvice={aiAdvice}
                          fallbackNg={aiNg}
                        />
                      </ErrorBoundary>

                      {/* 再来推奨タイミング */}
                      <ReturnTimingBadge />

                      {/* 肌タグ */}
                      <SkinTagSection />

                      {/* ホームケア使用商品（PHASE HC-2B） */}
                      <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                        <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
                          🏠 ホームケア使用商品
                        </p>
                        {homecareProductsLoading ? (
                          <p className="text-xs text-[#C8A58C] py-1">読み込み中…</p>
                        ) : homecareProducts.length === 0 ? (
                          <p className="text-xs text-[#C8A58C] py-1">購入履歴なし</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {homecareProducts.map(p => {
                              // PHASE HC-5: today - lastPurchasedAt の日数差のみ（予測ロジックなし・事実表示）
                              const daysSincePurchase = Math.floor(
                                (Date.now() - new Date(p.lastPurchasedAt).getTime()) / 86400000
                              );
                              const elapsedStyle =
                                daysSincePurchase >= 61
                                  ? 'text-[#C05060] font-bold'      // 61日以上: 強調表示
                                  : daysSincePurchase >= 31
                                    ? 'text-[#C8A070] font-medium'  // 31〜60日: 少し薄い注意表示
                                    : 'text-[#9F7E6C]';             // 0〜30日: 通常表示
                              return (
                                <div key={p.productName} className="bg-white rounded-2xl px-3.5 py-3">
                                  <p className="text-sm font-semibold text-[#5C4033] mb-1 break-words">{p.productName}</p>
                                  <p className="text-xs text-[#9F7E6C]">
                                    最終購入: {new Date(p.lastPurchasedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })}
                                  </p>
                                  <p className={`text-xs ${elapsedStyle}`}>前回購入から{daysSincePurchase}日</p>
                                  <p className="text-xs text-[#9F7E6C]">購入回数: {p.purchaseCount}回</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 関連記事・接客ヒント（BLOG_CONTENT_PHASE2・接客ヒントはPHASE2-C-3でAI化）
                          既存の🏠ホームケア使用商品ブロックの直下に追加表示。記事本文・外部URLは
                          一切表示しない(タイトルのみ)。残量推定・買い替え提案の文言は使わない。
                          接客ヒントは肌タグ×承認済みブログ記事のkeywords一致から選ぶ固定テンプレート
                          文言(knowledgeMatch.ts)。一致が無ければGENERAL_HINTSにフォールバックする。 */}
                      {homecareProducts.length > 0 && (
                        <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                          {relatedArticlesLoading ? (
                            <p className="text-xs text-[#C8A58C] py-1">読み込み中…</p>
                          ) : (
                            <>
                              {relatedArticles.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2">
                                    📰 関連記事
                                  </p>
                                  <div className="flex flex-col gap-1">
                                    {relatedArticles.map(a => (
                                      <p key={a.id} className="text-xs text-[#5C4033] leading-relaxed break-words">
                                        ・{a.title}について
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div>
                                <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2">
                                  💬 接客ヒント
                                </p>
                                <div className="flex flex-col gap-1">
                                  {knowledgeHintsLoading ? (
                                    <p className="text-xs text-[#C8A58C] py-1">読み込み中…</p>
                                  ) : (
                                    knowledgeHints.map((hint, i) => (
                                      <p key={i} className="text-xs text-[#5C4033] leading-relaxed">・{hint}</p>
                                    ))
                                  )}
                                </div>
                                {/* 生成理由（PHASE2-C追加確認）: タグ名・カテゴリ名のみを表示する。
                                    記事タイトル・記事本文・summary・URLは一切表示しない。 */}
                                {!knowledgeHintsLoading && knowledgeReasons.length > 0 && (
                                  <div className="mt-2.5 pt-2 border-t border-[#F0DCE0]">
                                    <p className="text-[10px] text-[#C8A8B0] tracking-[0.08em] mb-1">生成理由</p>
                                    <div className="flex flex-wrap gap-1">
                                      {knowledgeReasons.map((reason) => (
                                        <span key={reason.type + reason.label} className="text-[10px] text-[#9F7E6C] bg-white rounded-full px-2 py-0.5 border border-[#F0DCE0]">
                                          {reason.label}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* ホームケア使い方カード（PHASE HC-4） */}
                      {homecareProducts.length > 0 && (
                        <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                          <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
                            📋 ホームケア使い方カード
                          </p>
                          <div className="flex flex-col gap-2">
                            {homecareProducts.map(p => {
                              const guide = getHomecareUsageGuide(p.productName);
                              const open  = expandedUsageCards.has(p.productName);
                              const daysSincePurchase = Math.floor(
                                (Date.now() - new Date(p.lastPurchasedAt).getTime()) / 86400000
                              );
                              const displayedMessage = aiHomecareMessages[p.productName]
                                ?? guide?.staffMessage(c.name)
                                ?? '';
                              const generating = aiGeneratingProduct === p.productName;
                              const conversationHints = getConversationHints(p.productName);
                              return (
                                <div key={p.productName} className="bg-white rounded-2xl overflow-hidden">
                                  <div className="flex items-center justify-between px-3.5 py-3 gap-2">
                                    <p className="text-sm font-semibold text-[#5C4033] break-words flex-1">{p.productName}</p>
                                    {guide ? (
                                      <button onClick={() => toggleUsageCard(p.productName)}
                                        className="flex-shrink-0 text-[11px] font-semibold text-[#C8A58C] bg-[#F8F1F3] border-none rounded-full px-3 py-1.5 cursor-pointer whitespace-nowrap">
                                        {open ? '閉じる' : '使い方を見る'}
                                      </button>
                                    ) : (
                                      <span className="flex-shrink-0 text-[11px] text-[#C8A8B0] whitespace-nowrap">使い方情報未登録</span>
                                    )}
                                  </div>
                                  {/* 送信済み表示（PHASE LINE-LOG-1・コピー操作を送信とみなした近似） */}
                                  {sentStatusLabel(lineSendLogs, 'usage_card', p.productName) && (
                                    <div className="px-3.5 pb-2 -mt-1">
                                      <span className="inline-block text-[9px] font-semibold text-[#8060A8] bg-[#F5F0FA] rounded-full px-2 py-0.5">
                                        {sentStatusLabel(lineSendLogs, 'usage_card', p.productName)}
                                      </span>
                                    </div>
                                  )}
                                  {guide && open && (
                                    <div className="px-3.5 pb-3.5 flex flex-col gap-2.5">
                                      <div>
                                        <p className="text-[10px] text-[#C8A58C] tracking-[0.08em] mb-0.5">使用頻度</p>
                                        <p className="text-xs text-[#5C4033] leading-relaxed">{guide.frequency}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] text-[#C8A58C] tracking-[0.08em] mb-0.5">使用タイミング</p>
                                        <p className="text-xs text-[#5C4033] leading-relaxed">{guide.timing}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] text-[#C05060] tracking-[0.08em] mb-0.5">注意事項</p>
                                        <p className="text-xs text-[#C05060] leading-relaxed">{guide.caution}</p>
                                      </div>
                                      {/* customer_type別ワンポイント（PHASE HOMECARE-V12-MVP-1・任意・一致時のみ表示）
                                          ※ c.customer_typeは接客スタイル型(別軸)のため、肌質由来の
                                             skinConcernTypeを使う。DBの生値と一致した場合のみ表示 */}
                                      {c.skinConcernType && guide.byCustomerType?.[c.skinConcernType] && (
                                        <div className="bg-[#FFF0F5] rounded-2xl p-3 border border-[#F5D6DB]">
                                          <p className="text-[10px] text-[#D98292] tracking-[0.08em] mb-0.5">
                                            ✨ {CUSTOMER_TYPE_HINT_LABEL[c.skinConcernType] ?? 'あなたへのワンポイント'}
                                          </p>
                                          <p className="text-xs text-[#5C4033] leading-relaxed">
                                            {guide.byCustomerType[c.skinConcernType]}
                                          </p>
                                        </div>
                                      )}
                                      <div className="bg-[#FFF8F7] rounded-2xl p-3 border border-[#F5E6E8]">
                                        <div className="flex items-center justify-between mb-1.5">
                                          <p className="text-[10px] text-[#C8A58C] tracking-[0.08em]">
                                            {aiHomecareMessages[p.productName] ? 'AIメッセージ' : 'スタッフ送信用メッセージ'}
                                          </p>
                                          <button
                                            onClick={() => generateAiHomecareMessage(p.productName, p.lastPurchasedAt, daysSincePurchase)}
                                            disabled={generating}
                                            className="text-[10px] font-semibold text-[#8060A8] bg-[#F5F0FA] border-none rounded-full px-2.5 py-1 cursor-pointer whitespace-nowrap disabled:opacity-60">
                                            {generating ? '生成中…' : '✨ AIメッセージ生成'}
                                          </button>
                                        </div>
                                        <p className="text-xs text-[#5C4033] leading-[1.7] whitespace-pre-wrap mb-2.5">
                                          {displayedMessage}
                                        </p>
                                        <button
                                          onClick={() => copyUsageMessage(p.productName, displayedMessage)}
                                          className={`w-full py-2 rounded-full text-xs font-bold text-white border-none cursor-pointer transition-colors ${
                                            copiedUsageProduct === p.productName ? 'bg-[#34D399]' : 'bg-[#F56E8B]'
                                          }`}>
                                          {copiedUsageProduct === p.productName ? '✓ コピーしました' : 'メッセージをコピー'}
                                        </button>
                                      </div>

                                      {/* 接客ヒント（PHASE HC-7・ルールベースのみ・AI不使用） */}
                                      <div>
                                        <p className="text-[10px] text-[#8060A8] tracking-[0.08em] mb-1">
                                          💬 接客ヒント
                                        </p>
                                        <div className="flex flex-col gap-1">
                                          {conversationHints.hints
                                            .filter((hint) => hint?.trim())
                                            .map((hint, i) => (
                                              <p key={i} className="text-xs text-[#5C4033] leading-relaxed">・{hint}</p>
                                            ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ホームケアプラン */}
                      {visible('homeCare') && <HomecareAccordion />}

                      {/* LINE下書き */}
                      {visible('lineDraft') && <LineDraftAccordion />}

                      {/* LINEメッセージ生成（PHASE2-C-4・PHASE LINE-AI-1で3種類へ拡張）
                          仕様: 生成→編集→コピーのみ。送信ボタン・Webhook送信・LINE Messaging API
                          呼び出しは一切実装しない。送信はスタッフ本人がLINEアプリから手動で行う。 */}
                      <div className="bg-[#F0FAF5] rounded-[22px] p-4 border border-[#D0F0E0]">
                        <p className="text-[11px] tracking-[0.18em] text-[#34A070] font-semibold mb-2">
                          ✨ LINEメッセージ生成（AI下書き）
                        </p>
                        <div className="flex gap-1.5 mb-2">
                          {([
                            { type: 'thanks',   label: '来店お礼' },
                            { type: 'homecare', label: 'ホームケア提案' },
                            { type: 'reminder', label: '来店リマインド' },
                          ] as const).map(({ type, label }) => (
                            <button
                              key={type}
                              onClick={() => generateLineMessage(type, { variant: 'normal' })}
                              disabled={lineMessageGenerating}
                              className={`flex-1 text-[11px] font-semibold rounded-full px-2 py-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60 border ${
                                lineMessageType === type
                                  ? 'bg-[#34A070] text-white border-[#34A070]'
                                  : 'bg-white text-[#34A070] border-[#C0E8D0]'
                              }`}
                            >
                              {lineMessageGenerating && lineMessageType === type ? '生成中…' : label}
                            </button>
                          ))}
                        </div>
                        {/* LINE UX改善: 下書きがある間だけ表示する再生成クラスタ。
                            通常版/簡易版はvariantを切り替えて再生成、別案は同じvariantのまま
                            直前の下書きをpreviousDraftとしてAPIへ渡し表現を変えさせる。
                            いずれもローカルstateのみで完結し、DB・送信フローには触れない。 */}
                        {lineMessageDraft && lineMessageType && (
                          <div className="flex gap-1.5 mb-2">
                            <button
                              onClick={() => generateLineMessage(lineMessageType, { variant: 'normal' })}
                              disabled={lineMessageGenerating}
                              className={`flex-1 text-[11px] font-semibold rounded-full px-2 py-1 cursor-pointer whitespace-nowrap disabled:opacity-60 border ${
                                lineMessageVariant === 'normal'
                                  ? 'bg-[#3C5C45] text-white border-[#3C5C45]'
                                  : 'bg-white text-[#3C5C45] border-[#C0E8D0]'
                              }`}
                            >
                              📝 通常版
                            </button>
                            <button
                              onClick={() => generateLineMessage(lineMessageType, { variant: 'short' })}
                              disabled={lineMessageGenerating}
                              className={`flex-1 text-[11px] font-semibold rounded-full px-2 py-1 cursor-pointer whitespace-nowrap disabled:opacity-60 border ${
                                lineMessageVariant === 'short'
                                  ? 'bg-[#3C5C45] text-white border-[#3C5C45]'
                                  : 'bg-white text-[#3C5C45] border-[#C0E8D0]'
                              }`}
                            >
                              ⚡ 簡易版
                            </button>
                            <button
                              onClick={() => generateLineMessage(lineMessageType, { variant: lineMessageVariant, alternate: true })}
                              disabled={lineMessageGenerating}
                              className="flex-1 text-[11px] font-semibold rounded-full px-2 py-1 cursor-pointer whitespace-nowrap disabled:opacity-60 border bg-white text-[#3C5C45] border-[#C0E8D0]"
                            >
                              🔄 別案を生成
                            </button>
                          </div>
                        )}
                        {/* 送信済み表示（PHASE LINE-LOG-1・コピー操作を送信とみなした近似） */}
                        {(sentStatusLabel(lineSendLogs, 'thanks') || sentStatusLabel(lineSendLogs, 'homecare') || sentStatusLabel(lineSendLogs, 'reminder')) && (
                          <div className="flex gap-1.5 mb-1.5 flex-wrap">
                            {(['thanks', 'homecare', 'reminder'] as const).map(kind => (
                              sentStatusLabel(lineSendLogs, kind) && (
                                <span key={kind} className="text-[9px] font-semibold text-[#34A070] bg-white rounded-full px-2 py-0.5 border border-[#D0F0E0]">
                                  {LINE_SEND_KIND_LABEL[kind]}: {sentStatusLabel(lineSendLogs, kind)}
                                </span>
                              )
                            ))}
                          </div>
                        )}
                        {lineMessageDraft ? (
                          <>
                            <textarea
                              value={lineMessageDraft}
                              onChange={e => { setLineMessageDraft(e.target.value); setLineMessageCopied(false); }}
                              rows={5}
                              className="w-full bg-white rounded-2xl p-3 border border-[#C0E8D0] text-sm text-[#3C5C45] leading-[1.8] mb-2.5 resize-none"
                              placeholder="生成された文面がここに表示されます。自由に編集できます。"
                            />
                            <div className="flex gap-1.5">
                              <button onClick={() => copyLineMessageDraft()}
                                className={`flex-1 py-2.5 rounded-full text-sm font-bold text-white flex items-center justify-center gap-1.5 transition-colors border-none cursor-pointer ${
                                  lineMessageCopied ? 'bg-[#34D399]' : 'bg-[#2ECC8A]'
                                }`}>
                                {lineMessageCopied
                                  ? <><Check size={14} strokeWidth={2.5} /> コピー済</>
                                  : <><Copy size={14} strokeWidth={2} /> {lineMessageType ? LINE_SEND_KIND_LABEL[lineMessageType] : ''}としてコピー</>
                                }
                              </button>
                              {/* LINE UX改善: 下書き削除。ローカルstateのみリセット(APIコールなし)。
                                  送信済みログ・LINE送信フローには一切影響しない。 */}
                              <button onClick={clearLineMessageDraft}
                                aria-label="下書きを削除"
                                className="py-2.5 px-3.5 rounded-full text-sm font-bold text-[#7C9C88] bg-white border border-[#C0E8D0] flex items-center justify-center cursor-pointer">
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            </div>
                            <p className="text-[10px] text-[#7C9C88] mt-2 leading-relaxed">
                              送信はこのアプリからは行いません。コピーした文面をLINEアプリに貼り付けて、ご自身で送信してください。
                            </p>
                            {/* 生成理由（PHASE2-C追加確認）: タグ名・カテゴリ名のみを表示する。
                                記事タイトル・記事本文・summary・URLは一切表示しない。 */}
                            {lineMessageReasons.length > 0 && (
                              <div className="mt-2.5 pt-2 border-t border-[#D0F0E0]">
                                <p className="text-[10px] text-[#7C9C88] tracking-[0.08em] mb-1">生成理由</p>
                                <div className="flex flex-wrap gap-1">
                                  {lineMessageReasons.map((reason) => (
                                    <span key={reason.type + reason.label} className="text-[10px] text-[#3C5C45] bg-white rounded-full px-2 py-0.5 border border-[#D0F0E0]">
                                      {reason.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-[#7C9C88] py-1">
                            上のボタンを押すと、来店お礼・ホームケア提案・来店リマインドの
                            いずれかでAIがLINEメッセージの下書きを作成します。
                          </p>
                        )}
                      </div>

                      {/* LINE送信履歴（PHASE LINE-LOG-1） */}
                      <LineSendLogAccordion />

                      {/* 実施済み記録 */}
                      <ActionButtonGroup />

                      {/* 音声メモ */}
                      <div className="bg-[#F0F5FA] rounded-[22px] overflow-hidden flex-shrink-0">
                        {/* PHASE VOICE-UI-STOP-1: 録音中はこの見出しタップで折りたたませない
                            (折りたたむとVoiceMemoSectionがアンマウントされ、録音中の内容が
                            保存されないまま消えてしまうため。現場で「押しても停止しないように
                            見える」報告の一因と考えられる誤操作経路を塞ぐ。録音処理自体は無変更)。 */}
                        <button onClick={() => { if (!isVoiceRecording) toggleSection('voice'); }}
                          className="w-full flex items-center justify-between px-4 py-3.5 bg-transparent border-none cursor-pointer">
                          <p className="text-[11px] tracking-[0.18em] text-[#4878A8] font-semibold">
                            🎙️ 音声メモ{isVoiceRecording ? '（録音中）' : ''}
                          </p>
                          <span className="text-sm text-[#4878A8] transition-transform duration-200 inline-block"
                            style={{ transform: openSections.has('voice') ? 'rotate(180deg)' : 'none', opacity: isVoiceRecording ? 0.35 : 1 }}>▾</span>
                        </button>
                        {console.log('VOICE_MEMO_RENDER', {
                          openSections_has_voice: openSections.has('voice'),
                          visible_voiceMemo: visible('voiceMemo'),
                          servicePhase,
                          will_render: openSections.has('voice') && visible('voiceMemo'),
                        }) as unknown as null}
                        {openSections.has('voice') && visible('voiceMemo') && (
                          <div className="px-4 pb-4">
                            <VoiceMemoSection
                              customerId={c.id}
                              staffId={currentStaffId}
                              reservationId={r.id}
                              onSaved={() => {
                                loadRecentActions(c.id);
                                setInsightRefreshKey(p => p + 1);
                                setMemoryRefreshKey(p => p + 1);
                                // AI分析完了後に customer_notes・booking_prompt・handover を再取得
                                setTimeout(() => {
                                  setNotesRefreshKey(p => p + 1);
                                  void loadRecentNotes(c.id);
                                }, 2000);
                                setTimeout(async () => {
                                  const updated = await fetchBookingPrompt(c.id, r.id);
                                  if (updated) setBookingPrompt(updated);
                                }, 3500);
                                setTimeout(async () => {
                                  const updated = await fetchHandover(c.id, r.id);
                                  if (updated) setHandover(updated);
                                }, 4500);
                                setTimeout(async () => {
                                  const updated = await fetchContraindications(c.id);
                                  if (updated.length > 0) setContraindications(updated);
                                }, 5500);
                              }}
                              onSuggestion={(hint) => showHint(hint)}
                              onRecordingStateChange={(isRecording) => {
                                storeSetTimePressure(isRecording);
                                storeSetIsRecording(isRecording);  // 専用 store にも反映
                                if (!isRecording) {
                                  storeSetServicePhase(
                                    servicePhase === 'checkout' ? 'checkout' : 'aftercare'
                                  );
                                }
                              }}
                            />
                          </div>
                        )}
                      </div>

                    </div>

                    {/* 固定フッターボタン */}
                    <div className="flex-shrink-0 px-5 py-3 bg-white"
                      style={{
                        paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 24px)',
                        boxShadow: '0 -1px 0 #F5ECF0',
                      }}>
                      <div className="flex flex-col gap-2">
                        {/* サブナビ行 */}
                        <div className="flex gap-2">
                          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setPage('memory')}
                            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-full border-none cursor-pointer text-sm"
                            style={{
                              background: 'rgba(245,110,139,0.10)',
                              color: '#F56E8B',
                              fontWeight: 600,
                            }}>
                            💌 <span>メモ</span>
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setPage('timeline')}
                            className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-full cursor-pointer text-sm"
                            style={{
                              background: '#FFF8F2',
                              border: '1px solid #E8D8CC',
                              color: '#9F7E6C',
                              fontWeight: 600,
                            }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                              <span>🕮 AI Timeline</span>
                              <span style={{ fontSize: '9px', color: '#B8A090', fontWeight: 400 }}>AIが顧客を30秒で要約</span>
                            </div>
                          </motion.button>
                        </div>
                        {/* メインCTAボタン */}
                        <motion.button whileTap={{ scale: 0.97 }} onClick={() => setPage('log')}
                          className="flex items-center justify-center gap-2 py-4 rounded-full bg-[#F56E8B] text-white text-sm font-bold border-none cursor-pointer"
                          style={{ boxShadow: '0 8px 24px rgba(245,110,139,0.35)' }}>
                          今日の接客を記録する
                          <ChevronRight size={18} strokeWidth={2.5} />
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ════════════════════════════
                    SHEET C — Customer Memory
                ════════════════════════════ */}
                {page === 'memory' && (
                  <motion.div key="memory"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 flex flex-col min-h-0"
                  >
                    <CustomerMemoryTab
                      customerId={c.id}
                      staffId={currentStaffId}
                      onBack={() => setPage('overview')}
                    />
                  </motion.div>
                )}

                {/* ════════════════════════════
                    SHEET D — AI Timeline
                ════════════════════════════ */}
                {page === 'timeline' && (
                  <motion.div key="timeline"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 flex flex-col min-h-0"
                  >
                    <ErrorBoundary label="CustomerAITimelineTab" silentFail>
                      <CustomerAITimelineTab
                        customerId={c.id}
                        customerName={c.name}
                        onBack={() => setPage('overview')}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {/* ════════════════════════════
                    SHEET B — 接客ログ入力
                ════════════════════════════ */}
                {page === 'log' && (
                  <motion.div key="log"
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 flex flex-col min-h-0"
                  >
                    {/* 固定ヘッダー */}
                    <div className="flex-shrink-0 flex items-center justify-between px-5 pt-1 pb-3">
                      <button onClick={() => setPage('overview')}
                        className="flex items-center gap-1 bg-transparent border-none cursor-pointer text-[#C8A58C] text-sm">
                        <ChevronLeft size={16} strokeWidth={2} />戻る
                      </button>
                      <div className="text-center">
                        <p className="text-[11px] text-[#F56E8B] font-medium tracking-[0.12em] mb-0.5">
                          クイック入力
                        </p>
                        <p className="text-lg font-bold text-[#3d2218]">接客ログ記録</p>
                      </div>
                      <button onClick={close}
                        className="w-8 h-8 rounded-full bg-[#F8F1F3] border-none flex items-center justify-center cursor-pointer">
                        <X size={14} color="#C8A58C" strokeWidth={2.5} />
                      </button>
                    </div>

                    {/* スクロール領域 */}
                    <div
                      className="flex-1 min-h-0 overflow-y-auto"
                      style={{
                        padding: '0 20px 16px',
                        WebkitOverflowScrolling: 'touch',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}>

                      {/* 顧客チップ */}
                      <div className="bg-[#F8F1F3] rounded-[18px] px-4 py-3 flex items-center justify-between flex-shrink-0">
                        <span className="text-sm font-bold text-[#5C4033]">{c.name} 様</span>
                        <span className="text-xs text-[#9F7E6C]">
                          来店 {c.visits}回 · 最終来店 {r.days_since_last_visit ?? 0}日前
                        </span>
                      </div>

                      {/* KPI ログトグル */}
                      <div style={{
                        background: '#fff',
                        border: '1px solid #F5EEF0',
                        borderRadius: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        flexShrink: 0,
                        overflow: 'visible',
                      }}>
                        <div className="px-3.5 py-3 bg-[#FFF8FA] border-b border-[#F5EEF0]">
                          <p className="text-[11px] text-[#F56E8B] font-semibold tracking-[0.08em]">
                            ✓ KPI・接客ログ（ワンタップ記録）
                          </p>
                        </div>
                        <div className="px-3.5">
                          {LOG_ITEMS.map(({ key, emoji, label, onLabel, offLabel }) => {
                            const isOn = logSelected.has(key);
                            return (
                              <div key={key}
                                data-log-item={key}
                                className="flex items-center py-3 border-b border-[#F5EEF0] last:border-none gap-2.5">
                                <span className="text-xl flex-shrink-0">{emoji}</span>
                                <span className="flex-1 text-sm font-medium text-[#5C4033]">{label}</span>
                                <div className="flex gap-1.5 flex-shrink-0">
                                  <motion.button whileTap={{ scale: 0.96 }}
                                    disabled={logSaved}
                                    onClick={() => {
                                      if (!logSaved)
                                        setLogSelected(p => { const n = new Set(p); n.add(key); return n; });
                                    }}
                                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all"
                                    style={{
                                      border: `1.5px solid ${isOn ? '#F56E8B' : '#F0E0E4'}`,
                                      background: isOn ? '#F56E8B' : '#FFF',
                                      color: isOn ? '#fff' : '#A07080',
                                    }}>
                                    {onLabel}
                                  </motion.button>
                                  <motion.button whileTap={{ scale: 0.96 }}
                                    disabled={logSaved}
                                    onClick={() => {
                                      if (!logSaved)
                                        setLogSelected(p => { const n = new Set(p); n.delete(key); return n; });
                                    }}
                                    className="px-3.5 py-1.5 rounded-full text-xs cursor-pointer transition-all"
                                    style={{
                                      border: `1.5px solid ${!isOn ? '#C8A8B0' : '#F0E0E4'}`,
                                      background: !isOn ? '#F8F0F2' : '#FFF',
                                      color: !isOn ? '#7A5060' : '#C8A8B0',
                                      fontWeight: !isOn ? 600 : 400,
                                    }}>
                                    {offLabel}
                                  </motion.button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 接客メモ */}
                      <div className="bg-[#F8F1F3] rounded-[22px] p-4">
                        <div className="flex items-center justify-between mb-2.5">
                          <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold">
                            📝 接客メモ（自由入力）
                          </p>
                          {savedMemoText && !memoEditing && (
                            <button onClick={() => setMemoEditing(true)}
                              className="text-[11px] text-[#C8A58C] bg-white border border-[#F5E6E8] rounded-full px-3 py-0.5 cursor-pointer">
                              編集
                            </button>
                          )}
                          <span className="text-[11px] text-[#C8A8B0]">{memo.length}/200文字</span>
                        </div>
                        {savedMemoText && !memoEditing ? (
                          <div className="bg-white rounded-2xl p-3 border border-[#F5E6E8]">
                            <p className="text-sm text-[#5C4033] leading-[1.7] whitespace-pre-wrap">
                              {savedMemoText}
                            </p>
                          </div>
                        ) : (
                          <textarea
                            value={memo} onChange={e => setMemo(e.target.value.slice(0, 200))}
                            placeholder={`${c.name}様の接客メモを入力…`}
                            rows={3} autoFocus={memoEditing}
                            className="w-full resize-none text-sm text-[#5C4033] bg-white rounded-2xl p-3 border border-[#F5E6E8] outline-none leading-[1.7] font-['Noto_Sans_JP'] box-border"
                          />
                        )}
                      </div>

                    </div>

                    {/* 固定フッター */}
                    <div className="flex-shrink-0 px-5 pt-3 bg-white"
                      style={{
                        paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 24px)',
                        boxShadow: '0 -1px 0 #F5ECF0',
                      }}>
                      <motion.button whileTap={{ scale: 0.97 }}
                        onClick={async () => { await saveLog(); if (memo.trim()) await saveMemo(); }}
                        disabled={logSaving || logSaved}
                        className="w-full py-4 rounded-full text-sm font-bold flex items-center justify-center gap-2 transition-all border-none cursor-pointer"
                        style={{
                          background: logSaved ? '#34D399' : logSaving ? '#F5D6DB' : '#F56E8B',
                          color: logSaving ? '#C8A58C' : '#FFFFFF',
                          boxShadow: logSaved
                            ? '0 8px 24px rgba(52,211,153,0.3)'
                            : '0 8px 24px rgba(245,110,139,0.35)',
                          cursor: logSaved ? 'default' : 'pointer',
                        }}>
                        {logSaved ? '✓ 保存しました' : logSaving ? '保存中…' : '🌸 ログを保存する'}
                      </motion.button>

                      {!logSaved && (
                        <p className="text-center text-[11px] text-[#C8A8B0] mt-2">
                          保存された内容はスタッフとAIが確認できます
                        </p>
                      )}

                      {/* ServiceReplay — 保存後に静かに表示 */}
                      {logSaved && serviceReplay && visible('serviceReplay') && (
                        <div className="mt-3">
                          <ErrorBoundary label="ServiceReplayCard" silentFail>
                            <ServiceReplayCard replay={serviceReplay} />
                          </ErrorBoundary>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}


              </AnimatePresence>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
