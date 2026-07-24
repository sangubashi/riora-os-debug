/**
 * repeatRateWithin.ts — 「N日以内リピート率」共通ロジック(Phase 1-G)
 *
 * 元はsrc/lib/dashboard/DashboardAggregator.ts内のprivate関数だったものを切り出した
 * (経営TOPダッシュボードのrepeat_30/60/90と同じ定義)。計算式自体は無変更。
 * Menu画面のリピート率(Phase 1-G)もこの関数を再利用し、画面間で定義が食い違わないようにする。
 */
import type { Visit } from '../../types/riora.types';

/**
 * 来店間隔が`withinDays`日以内だった割合を返す(「30/60/90日コホート再来率」の
 * 本実装での定義: 対象期間の来店のうち、当該顧客の直前来店からの間隔がwithinDays日
 * 以内だった割合。初回来店(直前来店が無い)は分母から除外する)。
 * 直前来店は対象期間より前の来店も含む全履歴から探す(期間の境界直後の来店が
 * 期間前の来店を正しく参照できるようにするため)。
 *
 * `visitsByCustomer`は`targetVisits`と同じVisitオブジェクト参照を含み、
 * customer_id単位でvisit_date昇順に並んでいる必要がある(`history.indexOf(visit)`
 * が参照比較のため)。
 */
export function repeatRateWithin(
  targetVisits: Visit[],
  visitsByCustomer: Map<string, Visit[]>,
  withinDays: number
): number | null {
  let withPrevious = 0;
  let withinWindow = 0;

  for (const visit of targetVisits) {
    const history = visitsByCustomer.get(visit.customerId) ?? [];
    const idx = history.indexOf(visit);
    if (idx <= 0) continue; // 初回来店(直前来店なし)は対象外

    withPrevious += 1;
    const previous = history[idx - 1];
    const gapDays = (Date.parse(visit.visitDate) - Date.parse(previous.visitDate)) / 86_400_000;
    if (gapDays <= withinDays) withinWindow += 1;
  }

  return withPrevious > 0 ? withinWindow / withPrevious : null;
}

/** customer_id単位でVisit[]へグルーピングする(元の配列の並び順を保持する)。 */
export function groupVisitsByCustomer(visits: Visit[]): Map<string, Visit[]> {
  const visitsByCustomer = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    visitsByCustomer.set(v.customerId, list);
  }
  return visitsByCustomer;
}
