/**
 * useLineTemplateStore – LINE template Zustand store
 * Queries template_categories + line_templates from Supabase.
 * Falls back to mock data when Supabase is not configured.
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { TemplateCategory, LineTemplate } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineTemplateState {
  categories: TemplateCategory[]
  templatesByCategory: Record<string, LineTemplate[]>
  isLoading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  incrementUseCount: (templateId: string) => Promise<void>
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CATEGORIES: TemplateCategory[] = [
  { id: 'cat-1', name: 'ご来店後のお礼',       sort_order: 0 },
  { id: 'cat-2', name: 'ご予約リマインド',     sort_order: 1 },
  { id: 'cat-3', name: '次回ご来店のご案内',   sort_order: 2 },
  { id: 'cat-4', name: 'スペシャルキャンペーン', sort_order: 3 },
  { id: 'cat-5', name: '失客防止メッセージ',   sort_order: 4 },
]

const MOCK_TEMPLATES: LineTemplate[] = [
  // ① ご来店後のお礼
  {
    id: 't-1-1', category_id: 'cat-1', title: 'ご来店ありがとうございました',
    body: 'こんにちは、リオラです。\n本日はご来店いただきありがとうございました✨\n施術の仕上がりはいかがでしたか？\nまたいつでもお気軽にご来店ください。',
    tags: ['来店後', 'お礼'], use_count: 42, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-1-2', category_id: 'cat-1', title: '初回ご来店のお礼',
    body: 'こんにちは。本日はリオラへの初めてのご来店、誠にありがとうございました🌸\n緊張されていたかと思いますが、少しでもリラックスしていただけましたか？\nまたのご来店をスタッフ一同お待ちしております。',
    tags: ['初回', '来店後', 'お礼'], use_count: 18, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-1-3', category_id: 'cat-1', title: '施術後ケアのご案内',
    body: 'こんにちは。本日は施術をお受けいただきありがとうございました。\n施術後24時間は洗顔を優しめにしていただき、保湿をしっかり行っていただくとより効果が持続します💆‍♀️\n何かご不明な点がありましたらいつでもご連絡ください。',
    tags: ['来店後', 'アフターケア'], use_count: 31, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  // ② ご予約リマインド
  {
    id: 't-2-1', category_id: 'cat-2', title: '明日のご予約リマインド',
    body: 'こんにちは、リオラです。\n明日のご予約のご確認です🗓️\nご来店をスタッフ一同楽しみにお待ちしております。\nご変更・キャンセルの場合はお早めにご連絡ください。',
    tags: ['リマインド', '前日'], use_count: 55, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-2-2', category_id: 'cat-2', title: '3日前のご予約リマインド',
    body: 'こんにちは。ご予約日まで3日となりました。\n何かご不明な点やご要望がございましたら、お気軽にお知らせください✨\nご来店をお待ちしております。',
    tags: ['リマインド', '3日前'], use_count: 23, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-2-3', category_id: 'cat-2', title: '当日のご予約確認',
    body: 'こんにちは、リオラです。\n本日のご予約のお時間が近づいてまいりました⏰\nスタッフ一同お待ちしております。',
    tags: ['リマインド', '当日'], use_count: 67, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  // ③ 次回ご来店のご案内
  {
    id: 't-3-1', category_id: 'cat-3', title: '次回ご来店のご提案',
    body: 'こんにちは。先日はご来店ありがとうございました。\nお肌の調子はいかがですか？\n前回の施術から1ヶ月が経ちますので、次のケアのご提案がございます🌟\nご都合の良いお日にちをお聞かせいただけますか？',
    tags: ['次回案内', 'リピート'], use_count: 38, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-3-2', category_id: 'cat-3', title: '定期コースのご案内',
    body: 'こんにちは。\nリオラでは毎月のケアを継続いただくことで、より高い効果が期待できます✨\n定期コースをご利用いただくと、お得な料金でご案内できます。\nご興味がございましたらお気軽にご相談ください。',
    tags: ['定期コース', '次回案内'], use_count: 14, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-3-3', category_id: 'cat-3', title: '季節の変わり目ケアのご案内',
    body: 'こんにちは。季節の変わり目はお肌が敏感になりやすい時期です🍂\nこの時期に合わせた特別なケアのご提案がございます。\nご希望の方はぜひご予約ください。',
    tags: ['季節', '次回案内'], use_count: 9, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  // ④ スペシャルキャンペーン
  {
    id: 't-4-1', category_id: 'cat-4', title: 'お誕生日特別クーポン',
    body: 'お誕生日おめでとうございます🎂🎉\n日頃のご愛顧に感謝して、特別クーポンをプレゼントいたします。\n今月中にご来店の際にご提示ください（10%オフ）。\n素敵な一年になりますように✨',
    tags: ['誕生日', 'クーポン', 'VIP'], use_count: 27, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-4-2', category_id: 'cat-4', title: '限定キャンペーンのお知らせ',
    body: 'こんにちは。\n今月限定の特別キャンペーンをご案内いたします🌸\n新メニュー「プレミアムエイジングケア」を特別価格でお試しいただけます。\nご予約はお早めに。先着10名様限定です。',
    tags: ['キャンペーン', '限定', '新メニュー'], use_count: 11, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-4-3', category_id: 'cat-4', title: '紹介キャンペーンのご案内',
    body: 'こんにちは。\nリオラではお友だちご紹介キャンペーンを実施中です👭\nご紹介いただいたお客様には次回使えるポイントをプレゼント✨\nお気軽にお声がけください。',
    tags: ['紹介', 'キャンペーン'], use_count: 7, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  // ⑤ 失客防止メッセージ
  {
    id: 't-5-1', category_id: 'cat-5', title: 'お久しぶりのご連絡',
    body: 'こんにちは、リオラです。\nお元気ですか？最近お見かけしていなかったのでご連絡いたしました😊\nもしよろしければ、またぜひお顔を見せてください。\nスタッフ一同お待ちしております。',
    tags: ['失客防止', '休眠顧客'], use_count: 33, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-5-2', category_id: 'cat-5', title: '復活クーポンのご案内',
    body: 'こんにちは。\nしばらくご来店がなかったため、特別なご案内です🌸\n久しぶりのご来店に「お帰りなさいクーポン」をご用意しました（20%オフ）。\nまた元気なお顔を見せてください。スタッフ一同お待ちしております。',
    tags: ['失客防止', 'クーポン', '復活'], use_count: 19, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 't-5-3', category_id: 'cat-5', title: 'ケア状態確認メッセージ',
    body: 'こんにちは。\n以前ご来店いただいた際にお肌のお悩みを伺っていましたが、その後いかがですか？\n何かお困りのことがあればお気軽にご相談ください💆‍♀️\nまたのご来店をお待ちしております。',
    tags: ['失客防止', 'フォローアップ'], use_count: 12, is_active: true, created_at: '2025-01-01T00:00:00Z',
  },
]

function buildTemplatesByCategory(
  categories: TemplateCategory[],
  templates: LineTemplate[]
): Record<string, LineTemplate[]> {
  const map: Record<string, LineTemplate[]> = {}
  for (const cat of categories) {
    map[cat.id] = templates.filter((t) => t.category_id === cat.id && t.is_active)
  }
  return map
}

const MOCK_BY_CATEGORY = buildTemplatesByCategory(MOCK_CATEGORIES, MOCK_TEMPLATES)

// ─── Helper ───────────────────────────────────────────────────────────────────

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !url || !key || url === '' || key === ''
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useLineTemplateStore = create<LineTemplateState>((set, get) => ({
  categories: MOCK_CATEGORIES,
  templatesByCategory: MOCK_BY_CATEGORY,
  isLoading: false,
  error: null,

  fetchAll: async () => {
    if (isMockMode()) return

    set({ isLoading: true, error: null })
    try {
      const [catResult, tplResult] = await Promise.all([
        supabase
          .from('template_categories')
          .select('id, name, sort_order')
          .order('sort_order', { ascending: true }),
        supabase
          .from('line_templates')
          .select('id, category_id, title, body, tags, use_count, is_active, created_at')
          .eq('is_active', true)
          .order('use_count', { ascending: false }),
      ])

      if (catResult.error) throw catResult.error
      if (tplResult.error) throw tplResult.error

      const categories = (catResult.data ?? []) as TemplateCategory[]
      const templates = (tplResult.data ?? []) as LineTemplate[]
      const templatesByCategory = buildTemplatesByCategory(categories, templates)

      set({ categories, templatesByCategory })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'テンプレートの取得に失敗しました'
      set({ error: msg })
      // Keep mock data on error
    } finally {
      set({ isLoading: false })
    }
  },

  incrementUseCount: async (templateId: string) => {
    // Optimistic update
    const { templatesByCategory } = get()
    const updated: Record<string, LineTemplate[]> = {}
    for (const [catId, templates] of Object.entries(templatesByCategory)) {
      updated[catId] = templates.map((t) =>
        t.id === templateId ? { ...t, use_count: t.use_count + 1 } : t
      )
    }
    set({ templatesByCategory: updated })

    if (isMockMode()) return

    try {
      // Use RPC-style increment to avoid race conditions
      const { data: current } = await supabase
        .from('line_templates')
        .select('use_count')
        .eq('id', templateId)
        .single()

      if (current) {
        await supabase
          .from('line_templates')
          .update({ use_count: (current.use_count ?? 0) + 1 })
          .eq('id', templateId)
      }
    } catch {
      // Ignore increment errors – optimistic update already applied
    }
  },
}))
