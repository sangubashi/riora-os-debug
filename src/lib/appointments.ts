import { supabase } from './supabase';
import type { CustomerProfile, CustomerType, AiPoint } from '../types';
import { KILLER_PHRASES } from '../data/constants';

type DbType = 'sincere' | 'speed' | 'luxury' | null;

function mapType(dbType: DbType, isVip: boolean): CustomerType {
  if (isVip) return 'VIP型';
  switch (dbType) {
    case 'sincere':  return '信頼構築型';
    case 'speed':    return '効果重視型';
    case 'luxury':   return '感情重視型';
    default:         return '慎重・不安型';
  }
}

function defaultOneLiner(t: CustomerType): string {
  const MAP: Record<CustomerType, string> = {
    '慎重・不安型': '安心感重視 — 強い提案は控えて',
    '感情重視型':   '共感重視 — 感情的なつながりを大切に',
    '効果重視型':   '変化の可視化 — 写真比較で確認する',
    '信頼構築型':   '信頼構築中 — 定期来店の習慣化を優先',
    'VIP型':       'VIP対応 — 特別感を演出して',
  };
  return MAP[t];
}

function defaultRioraMsg(t: CustomerType): string {
  const MAP: Record<CustomerType, string> = {
    '慎重・不安型': '安心感を優先してください。焦らずゆっくり対応して✨',
    '感情重視型':   '共感と感情を大切に接客しましょう🌸',
    '効果重視型':   '変化を具体的に見せてあげてください✨',
    '信頼構築型':   '焦らず丁寧なカウンセリングで信頼を積み上げて🌸',
    'VIP型':       'VIPのお客様です。いつも以上の丁寧さで✨',
  };
  return MAP[t];
}

function defaultTags(t: CustomerType): string[] {
  const MAP: Record<CustomerType, string[]> = {
    '慎重・不安型': ['#敏感肌', '#安心重視'],
    '感情重視型':   ['#感情重視', '#共感'],
    '効果重視型':   ['#効果重視', '#毛穴'],
    '信頼構築型':   ['#信頼構築', '#リピーター'],
    'VIP型':       ['#VIP', '#アンチエイジング'],
  };
  return MAP[t] ?? [];
}

function defaultNgAction(t: CustomerType): string {
  const MAP: Record<CustomerType, string> = {
    '慎重・不安型': '複数商品の同時提案はしないこと。信頼関係を最優先に。',
    '感情重視型':   '事務的な対応は避けること。感情的なつながりを大切に。',
    '効果重視型':   '曖昧な説明はしないこと。具体的なデータで話すこと。',
    '信頼構築型':   '高額プランの提案は時期尚早。まず定期来店の習慣化を。',
    'VIP型':       '施術時間を削らないこと。このお客様は丁寧さに価値を感じています。',
  };
  return MAP[t] ?? '';
}

type SecureRow = {
  hash_id: string;
  visit_count: number;
  customer_type: string | null;
  is_vip: boolean;
  last_visit_at: string | null;
  notes: string | null;
  risk_score: number | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  visit_count: number;
  customer_type: string | null;
  is_vip: boolean;
  notes: string | null;
};

/**
 * 今日の予約を取得して Customer[] に変換する。
 * RLS で staff_id フィルタが自動適用されるため追加フィルタ不要だが
 * admin の場合は全件取得するため staff_id フィルタは付けない。
 */
export async function fetchTodayAppointments(staffId: string): Promise<CustomerProfile[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // reservations + customers（FK join）
  let query = supabase
    .from('reservations')
    .select(`
      id, staff_id, customer_id, customer_hash_id, menu, scheduled_at, status,
      customers ( id, name, visit_count, customer_type, is_vip, notes )
    `)
    .gte('scheduled_at', today.toISOString())
    .lt('scheduled_at', tomorrow.toISOString())
    .in('status', ['pending', 'confirmed'])
    .order('scheduled_at', { ascending: true });

  if (staffId !== 'admin') {
    query = query.eq('staff_id', staffId);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.warn('[appointments] reservations fetch error:', error.message);
    return [];
  }
  if (!rows?.length) return [];

  // customers_secure から追加データを取得（hash_id 経由）
  const hashIds = Array.from(
    new Set(
      rows
        .map((r) => (r as { customer_hash_id: string | null }).customer_hash_id)
        .filter(Boolean) as string[]
    )
  );

  const secureMap = new Map<string, SecureRow>();
  if (hashIds.length > 0) {
    try {
      const { data: secureRows, error: secErr } = await supabase
        .from('customers_secure')
        .select('hash_id, visit_count, customer_type, is_vip, last_visit_at, notes, risk_score')
        .in('hash_id', hashIds);
      // テーブル未作成（42P01）は silent — データなしで継続
      if (!secErr) {
        secureRows?.forEach((r: SecureRow) => secureMap.set(r.hash_id, r));
      }
    } catch {
      // customers_secure が存在しない場合は無視して続行
    }
  }

  return rows.map((row) => {
    const r = row as unknown as {
      id: string;
      staff_id: string;
      customer_id: string | null;
      customer_hash_id: string | null;
      menu: string;
      scheduled_at: string;
      status: string;
      customers: CustomerRow | null;
    };

    const cust   = r.customers;
    const secure = r.customer_hash_id ? secureMap.get(r.customer_hash_id) : null;

    const name        = cust?.name ?? '予約のお客様';
    const visits      = secure?.visit_count ?? cust?.visit_count ?? 1;
    const dbType      = (secure?.customer_type ?? cust?.customer_type) as DbType;
    const isVip       = secure?.is_vip ?? cust?.is_vip ?? false;
    const lastVisitAt = secure?.last_visit_at ?? null;
    const notes       = secure?.notes ?? cust?.notes ?? null;

    const customerType     = mapType(dbType, isVip);
    const lastVisitDaysAgo = lastVisitAt
      ? Math.round((Date.now() - new Date(lastVisitAt).getTime()) / 86400000)
      : 0;

    const aiPoints: AiPoint[] = (KILLER_PHRASES[customerType] ?? [])
      .slice(0, 3)
      .map((kp) => ({ text: `【${kp.scene}】${kp.line}` }));

    return {
      id:               r.id,
      hashId:           r.customer_hash_id ?? undefined,
      churnRisk:        secure?.risk_score != null ? Math.round(secure.risk_score * 10) : undefined,
      staffId:          r.staff_id,
      name,
      customerType,
      aiOneLiner:       defaultOneLiner(customerType),
      visits,
      lastVisitDaysAgo,
      tags:             defaultTags(customerType),
      aiPoints,
      ngAction:         defaultNgAction(customerType),
      rioraMessage:     defaultRioraMsg(customerType),
      rejectionPatterns: (KILLER_PHRASES[customerType] ?? []).map((kp) => ({
        trigger: kp.scene,
        meaning: '',
        counter: kp.line,
      })),
      previousConcerns: notes ? [notes] : [],
    } satisfies CustomerProfile;
  });
}
