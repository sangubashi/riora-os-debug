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
import { ChevronRight, ChevronLeft, X, Copy, Check } from 'lucide-react';
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
} from '@/types';
import {
  SKIN_TAG_LABELS,
  SKIN_TAG_KEYS,
  ACTION_TYPE_LABELS,
} from '@/types';
import type { HomecarePlan, ServiceReplay } from '@/types';

// ── ロジック層 ────────────────────────────────────────────────────────────────
import {
  generateHomecarePlan,
  getReturnTiming,
  type HomecarePlanInput,
} from '@/lib/homecare/generateHomecarePlan';
import { logAction, fetchRecentActions, type ActionLogRow } from '@/lib/actionLog';
import { buildServiceReplay } from '@/lib/phase5/serviceReplay';
import { Mutex, prodLog } from '@/lib/stability';
import { useSectionPriority, isSectionVisible } from '@/lib/phase8/sectionPriority';
import {
  calculateSectionPriorities,
  type AdaptivePriorityInput,
} from '@/lib/adaptivePriority';
import { useStoreLearnings } from '@/hooks/useStoreLearnings';
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
  type Contraindication,
} from '@/lib/contraindication';

// ── コンポーネント層 ──────────────────────────────────────────────────────────
import { ErrorBoundary } from '@/components/ErrorBoundary';
import CustomerInsightPanel from '@/components/customer/CustomerInsightPanel';
import NextActionPanel from '@/components/customer/NextActionPanel';
import CustomerRiskCard from '@/components/customer/CustomerRiskCard';
import ServiceReplayCard from '@/components/customer/ServiceReplayCard';
import StoreLearningSection from '@/components/customer/StoreLearningSection';
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

type SectionKey = 'homecare' | 'line' | 'voice';

/** 来店履歴1件（Phase UX-1・/api/customers/[id]/visit-history のレスポンス型） */
interface VisitHistoryEntry {
  id:        string;
  visitDate: string;
  menuName:  string | null;
  amount:    number;
  staffName: string | null;
}

/** ホームケア使用商品1件（PHASE HC-2B・/api/customers/[id]/homecare-products のレスポンス型） */
interface HomecareProductEntry {
  productName:     string;
  purchaseCount:   number;
  lastPurchasedAt: string;
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

  // ── 肌タグ ──────────────────────────────────────────────────────────────────
  const [skinTags,    setSkinTags]    = useState<SkinTagKey[]>([]);
  const [tagSaving,   setTagSaving]   = useState(false);
  const [tagEditing,  setTagEditing]  = useState(false);
  const [editingTags, setEditingTags] = useState<SkinTagKey[]>([]);

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
    setHomecareProducts([]);
    setAllDone(false);
    setServiceReplay(null);
    resetActiveSession();
    sessionStartRef.current = Date.now();
    setCompletionHint(null);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);

    supabase
        .from('customer_notes')
        .select('note')
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]?.note) { setSavedMemoText(data[0].note); setMemo(data[0].note); }
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
  }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── ロード ────────────────────────────────────────────────────────────────
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
    setVisitHistory([]);
    setTodayFocus(null);
    setNgTopics([]);
    setHomecareProducts([]);
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

  // ─── 肌タグ保存 ────────────────────────────────────────────────────────────
  const saveSkinTags = useCallback(async () => {
    if (!c || tagSaving) return;
    setTagSaving(true);

    try {
      const res = await fetch(`/api/customers/${c.id}/skin-tags`, {
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
    setLogSaving(true);

    const { error } = await supabase.from('staff_logs').insert({
      reservation_id: r?.id ?? null,
      customer_id:    c.id,
      staff_id:       currentStaffId ?? null,
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

  // ─── LINE コピー ────────────────────────────────────────────────────────────
  const copyLineDraft = useCallback(async () => {
    if (!homecarePlan?.lineDraft) return;
    try {
      await navigator.clipboard.writeText(homecarePlan.lineDraft);
      setLineCopied(true);
      toast.success('コピーしました', { duration: 1500 });
      setTimeout(() => setLineCopied(false), 2500);
    } catch { toast.error('コピーに失敗しました'); }
  }, [homecarePlan]);

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

  // ─── Store Learnings ────────────────────────────────────────────────────────
  const customerTagsForLearning = useMemo(
    () => [...skinTags, ...(c?.customer_type ? [c.customer_type] : [])],
    [skinTags, c?.customer_type] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { learnings: storeLearnings } = useStoreLearnings(
    customerTagsForLearning, servicePhase, 2
  );

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
                  {items.map((item, i) => (
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
              drag="y" dragConstraints={{ top: 0 }} dragElastic={{ top: 0, bottom: 0.3 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 500) close();
              }}
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
              {/* ドラッグハンドル */}
              <div className="flex-shrink-0 flex justify-center pt-3 pb-1.5">
                <div className="w-12 h-[5px] rounded-full bg-[#E8D5D8]" />
              </div>

              {/* 禁忌事項 — 最重要・常時表示（スクロールで隠れない・折りたたみ不可・全ページ共通固定） */}
              {(contraindicationsLoading || contraindications.length > 0) && (
                <div className="flex-shrink-0 px-5 pb-2">
                  <ErrorBoundary label="ContraindicationSection" silentFail>
                    <ContraindicationSection
                      items={contraindications}
                      loading={contraindicationsLoading}
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

                      {/* KPI 横2列(AUTH-2b: 累計売上を削除。金額をスタッフ間の比較材料にしない方針) */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: '来店回数',   value: `${c.visits}回` },
                          { label: 'LINE反応率', value: `${c.line_response_rate}%` },
                        ].map(({ label, value }) => (
                          <div key={label}
                            className="bg-[#F8F1F3] rounded-[18px] py-3 px-2 text-center">
                            <p className="text-base font-bold text-[#5C4033] leading-none mb-1
                              font-['Inter']">{value}</p>
                            <p className="text-[10px] text-[#9F7E6C]">{label}</p>
                          </div>
                        ))}
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

                      {/* Store Learning（成功パターン知見）— データがある時だけ表示 */}
                      {visible('storeLearning') && storeLearnings.length > 0 && (
                        <ErrorBoundary label="StoreLearningSection" silentFail>
                          <StoreLearningSection
                            learnings={storeLearnings}
                            compact={isCompact('storeLearning')}
                          />
                        </ErrorBoundary>
                      )}

                      {/* 今日の接客ポイント */}
                      <div className="bg-[#FFF8F7] rounded-[22px] p-4 border border-[#F5E6E8]">
                        <p className="text-[11px] tracking-[0.2em] text-[#C8A58C] font-semibold mb-2.5">
                          ✨ 今日の接客ポイント
                        </p>
                        <p className="text-sm text-[#5C4033] leading-[1.75]">{aiAdvice}</p>
                        {aiNg && (
                          <div className="mt-2.5 bg-[#FFF0F2] rounded-2xl p-2.5 flex gap-2">
                            <span className="text-sm flex-shrink-0">⚠️</span>
                            <div>
                              <p className="text-[10px] text-[#C05060] tracking-[0.08em] mb-0.5">NGワード</p>
                              <p className="text-sm text-[#C05060] leading-relaxed">{aiNg}</p>
                            </div>
                          </div>
                        )}
                      </div>

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
                            {homecareProducts.map(p => (
                              <div key={p.productName} className="bg-white rounded-2xl px-3.5 py-3">
                                <p className="text-sm font-semibold text-[#5C4033] mb-1">{p.productName}</p>
                                <p className="text-xs text-[#9F7E6C]">
                                  最終購入: {new Date(p.lastPurchasedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })}
                                </p>
                                <p className="text-xs text-[#9F7E6C]">購入回数: {p.purchaseCount}回</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* ホームケアプラン */}
                      {visible('homeCare') && <HomecareAccordion />}

                      {/* LINE下書き */}
                      {visible('lineDraft') && <LineDraftAccordion />}

                      {/* 実施済み記録 */}
                      <ActionButtonGroup />

                      {/* 音声メモ */}
                      <div className="bg-[#F0F5FA] rounded-[22px] overflow-hidden flex-shrink-0">
                        <button onClick={() => toggleSection('voice')}
                          className="w-full flex items-center justify-between px-4 py-3.5 bg-transparent border-none cursor-pointer">
                          <p className="text-[11px] tracking-[0.18em] text-[#4878A8] font-semibold">🎙️ 音声メモ</p>
                          <span className="text-sm text-[#4878A8] transition-transform duration-200 inline-block"
                            style={{ transform: openSections.has('voice') ? 'rotate(180deg)' : 'none' }}>▾</span>
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
                                setTimeout(() => setNotesRefreshKey(p => p + 1), 2000);
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
