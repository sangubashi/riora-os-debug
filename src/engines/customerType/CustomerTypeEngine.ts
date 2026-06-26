/**
 * CustomerTypeEngine.ts — brain_customers.customer_type の決定論分類エンジン(Pass H)
 *
 * 設計根拠: docs/CustomerTypeEngine_事前調査.md
 *
 * 推測(自由記述のキーワード推定・商品名からの連想等)による分類は禁止のため、
 * スキーマ上「customer_type判定用」として明示的に設計されている2つの実信号のみを使う。
 *   1. customer.weddingDate(E_bridal専用の判定根拠。対応する単独メニューは存在しないため
 *      唯一の根拠)
 *   2. 来店履歴のmenuId→brain_menus.targetTypes(supabase/migrations/20260612000006_seed_master.sql
 *      で実際に1メニュー=1customer_typeとして設計済みのマスタデータ)。targetTypesが空、または
 *      複数タイプを跨ぐ汎用メニュー(entry等)は判別材料として使わない(単独タイプを明示する
 *      メニューの来店のみを実信号として数える)。
 *
 * 2026-06-25時点の本番データでは、来店39件全てがCSV取込時にメニュー名未マッチで
 * targetTypes=[]のフォールバックメニューに集約されているため、この経路からは
 * 1件も分類されない(エンジンの不具合ではなくデータ品質起因。事前調査レポート参照)。
 * 実信号が無い場合はnoneを返し、架空のタイプを割り当てない(ハードコード・推測禁止)。
 */
import type { CustomerType, Menu, Visit } from '../../types/riora.types';

export type CustomerTypeClassificationReason = 'wedding_date' | 'visit_menu_signal' | 'no_classifiable_signal';

export interface CustomerTypeClassification {
  customerType: CustomerType | null;
  confidence: number;
  reason: CustomerTypeClassificationReason;
  evidenceVisitCount: number;
}

export interface ClassifyCustomerTypeInput {
  weddingDate: string | null;
  visits: Visit[];
  menus: Menu[];
}

export function classifyCustomerType(input: ClassifyCustomerTypeInput): CustomerTypeClassification {
  if (input.weddingDate) {
    return { customerType: 'E_bridal', confidence: 1, reason: 'wedding_date', evidenceVisitCount: 0 };
  }

  const menuById = new Map(input.menus.map((m) => [m.id, m]));
  const votes = new Map<CustomerType, number>();
  let signalVisitCount = 0;

  for (const visit of input.visits) {
    const menu = menuById.get(visit.menuId);
    if (!menu) continue;
    if (menu.targetTypes.length !== 1) continue;
    const type = menu.targetTypes[0];
    votes.set(type, (votes.get(type) ?? 0) + 1);
    signalVisitCount += 1;
  }

  if (signalVisitCount === 0) {
    return { customerType: null, confidence: 0, reason: 'no_classifiable_signal', evidenceVisitCount: 0 };
  }

  const entries = Array.from(votes.entries());
  const [topType, topCount] = entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best), entries[0]);

  return { customerType: topType, confidence: topCount / signalVisitCount, reason: 'visit_menu_signal', evidenceVisitCount: signalVisitCount };
}
