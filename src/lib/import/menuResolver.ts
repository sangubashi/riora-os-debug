/**
 * menuResolver.ts — SalonBoardメニュー名 → brain_menus.id 解決(Pass C: 名寄せ精度改善)
 *
 * 解決フロー(優先順):
 *   1. exact_match      … 元の文字列のまま完全一致(正規化なし)
 *   2. normalized_match … 前後/内部空白除去・全角半角統一・大小文字統一後に完全一致
 *   3. partial_match    … 正規化後、どちらかの文字列が他方を部分文字列として含む
 *                          (例: "ハーブピーリング" ⊂ "ハーブピーリング90分")
 *   4. keyword_match    … SalonBoard長文名対応(Pass L-2)。brain_menus名を治療キーワードに分解し
 *                          (例: "毛穴洗浄+ヒト幹19000" → ["毛穴洗浄","ヒト幹"])、全キーワードが
 *                          CSV名の正規化済み文字列に含まれる場合にマッチ。複数候補があれば
 *                          キーワード数が最多のメニューを選択(最小誤マッチ)。
 *   5. fallback_other   … 上記いずれにも一致せず、各店舗に1件存在するrole='imported_other'の
 *                          フォールバック行へ集約(supabase/migrations/20260621_csv_import_fallback_menu_seed.sql参照)
 *   5. unresolved        … フォールバック行も無い場合(取込側でエラー行として扱う)
 *
 * brain_menus.role/target_typesはCSV側に対応する比較可能なシグナル(施術ジャンル・
 * 肌タイプ等)が存在しないため、本実装では使用していない(調査済み・暫定ハードコードに
 * よる無理な相関付けを避けるため見送り。CSV側に対応列が追加された場合に再検討する)。
 *
 * 別名辞書(TREATMENT_ALIAS等)による特定店舗向けのハードコードは行わない
 * (暫定ハードコード禁止の方針)。正規化は汎用ルール(normalizeForMenuMatch)のみ。
 *
 * brain_menusはインポート実行開始時に1回だけ全件取得し、本モジュールで
 * インメモリのMapに変換してから解決する(行ごとのDB問い合わせはしない・staffResolver.tsと同じ方針)。
 */

import { normalizeForMenuMatch, extractSalonBoardNormalized, extractBrainMenuKeywords } from './normalizer'
import type { Menu } from '../../types/riora.types'

/** 部分一致を試みる最小文字数(正規化後)。極端に短い文字列同士の偶発一致を避けるためのガード。 */
const MIN_PARTIAL_MATCH_LENGTH = 2

interface MenuEntry {
  id:   string
  name: string
}

export interface MenuLookup {
  byRawName:        Map<string, MenuEntry>
  byNormalizedName:  Map<string, MenuEntry>
  /** 部分一致走査用(Mapでは部分文字列検索ができないため配列で保持)。 */
  normalizedEntries: { normalized: string; entry: MenuEntry }[]
  fallbackMenuId:    string | null
  fallbackMenuName:  string | null
}

export function buildMenuLookup(menus: Menu[]): MenuLookup {
  const byRawName = new Map<string, MenuEntry>()
  const byNormalizedName = new Map<string, MenuEntry>()
  const normalizedEntries: { normalized: string; entry: MenuEntry }[] = []
  let fallbackMenuId: string | null = null
  let fallbackMenuName: string | null = null

  menus.forEach(m => {
    if (m.role === 'imported_other') {
      fallbackMenuId = m.id
      fallbackMenuName = m.name
      return
    }
    const entry: MenuEntry = { id: m.id, name: m.name }
    byRawName.set(m.name, entry)
    const normalized = normalizeForMenuMatch(m.name)
    byNormalizedName.set(normalized, entry)
    normalizedEntries.push({ normalized, entry })
  })

  return { byRawName, byNormalizedName, normalizedEntries, fallbackMenuId, fallbackMenuName }
}

export type MenuResolutionMethod = 'exact_match' | 'normalized_match' | 'partial_match' | 'keyword_match' | 'fallback_other'

export type MenuResolution =
  | { status: 'matched';  menuId: string; menuName: string; method: 'exact_match' | 'normalized_match' | 'partial_match' | 'keyword_match' }
  | { status: 'fallback'; menuId: string; menuName: string; method: 'fallback_other' }
  | { status: 'unresolved' }

export function resolveMenuId(rawMenuName: string, lookup: MenuLookup): MenuResolution {
  const exact = lookup.byRawName.get(rawMenuName)
  if (exact) return { status: 'matched', menuId: exact.id, menuName: exact.name, method: 'exact_match' }

  const normalizedRaw = normalizeForMenuMatch(rawMenuName)

  const normalized = lookup.byNormalizedName.get(normalizedRaw)
  if (normalized) return { status: 'matched', menuId: normalized.id, menuName: normalized.name, method: 'normalized_match' }

  if (normalizedRaw.length >= MIN_PARTIAL_MATCH_LENGTH) {
    for (const { normalized: candidateNormalized, entry } of lookup.normalizedEntries) {
      if (candidateNormalized.length < MIN_PARTIAL_MATCH_LENGTH) continue
      if (candidateNormalized.includes(normalizedRaw) || normalizedRaw.includes(candidateNormalized)) {
        return { status: 'matched', menuId: entry.id, menuName: entry.name, method: 'partial_match' }
      }
    }
  }

  // keyword_match: SalonBoard長文メニュー名対応(Pass L-2)
  // brain_menus名をキーワード分解し、CSV名の正規化文字列に全キーワードが含まれれば一致とする。
  // 複数候補はキーワード数最多（最も具体的）を優先。
  const sbNorm = extractSalonBoardNormalized(rawMenuName)
  const kwCandidates: { entry: MenuEntry; kwCount: number }[] = []
  for (const { entry } of lookup.normalizedEntries) {
    const kws = extractBrainMenuKeywords(entry.name)
    if (kws.length > 0 && kws.every(kw => sbNorm.includes(kw))) {
      kwCandidates.push({ entry, kwCount: kws.length })
    }
  }
  if (kwCandidates.length > 0) {
    kwCandidates.sort((a, b) => b.kwCount - a.kwCount)
    const best = kwCandidates[0].entry
    return { status: 'matched', menuId: best.id, menuName: best.name, method: 'keyword_match' }
  }

  if (lookup.fallbackMenuId) {
    return { status: 'fallback', menuId: lookup.fallbackMenuId, menuName: lookup.fallbackMenuName ?? '', method: 'fallback_other' }
  }
  return { status: 'unresolved' }
}
