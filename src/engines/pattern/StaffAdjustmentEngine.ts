// ================================================================
// StaffAdjustmentEngine (Pattern Engine Code Architecture v1.0 §7 /
// Proposal Generator v2.0 §3) — 3作用点の横断エンジン。
//
// 読取専用(brain_staff_adjustments/brain_params)。値の更新はStaff Learning
// Engine(Brain接続点②)がrevision経由で行う。
//
// 作用点1 applyTimingOffset: 採点前 — visit_count減算による仮context
//   (fire_condition自体は不変・原ctxも不変。正の値=発火を来店n回分後ろ倒し)。
// 作用点2 resolveAffinity: 採点中 — w4入力(affinity_score実測EWMA優先、
//   なければstyle_affinity prior)。
// 作用点3 applyOutputStyle: 出力時 — script_style + 制約(mandatoryMax/
//   subscriptionStyle)。
//
// constraints(mandatoryMax/subscriptionStyle)はStaffAdjustment型に対応する
// データ列が無く、正典が「亀山=mandatoryMax 1(他=1。将来可変)」「外舘=サブスク
// 資料お渡し型固定」と"固定"値として明記しているため、本実装ではスタッフ名に
// 紐づく構造的定数として扱う(document_handoverはStaffStyleに含まれない値の
// ためStaffAdjustment.scriptStyleでは表現不可)。
// ================================================================

import type {
  AffinityResolved,
  Candidate,
  PatternContext,
  ProposalKind,
  ScoredCandidate,
  Staff,
  StaffAdjustment,
  StaffStyle,
} from '../../types/riora.types';
import type { StyleAffinityTable } from '../../types/brain.types';

/** 全staffのmandatoryMax現在値(Code Architecture v1.0 §7「亀山=1(他=1。将来可変)」)。 */
const MANDATORY_MAX = 1;

/** サブスク資料お渡し型固定の対象スタッフ(Proposal Generator v2.0 §3「外舘=サブスク資料お渡し型固定」)。 */
const DOCUMENT_HANDOVER_STAFF_NAME = '外舘';
const SUBSCRIPTION_STYLE_CONSTRAINT = 'document_handover' as const;

const PROPOSAL_KINDS: readonly ProposalKind[] = ['homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none'];

export class StaffAdjustmentEngine {
  /**
   * 作用点1: 採点前のtiming_offset補正。
   * off.timingOffsets はキー`${patternCode}:${kind}`(リポジトリ層でpattern_id->patternCodeを
   * 解決済みの前提)。該当エントリがあればvisitCountから減算した仮contextを返す
   * (fire_condition/原ctxは不変。正の値=後ろ倒し)。
   */
  applyTimingOffset(ctx: PatternContext, c: Candidate, off: AffinityResolved): PatternContext {
    const offset = off.timingOffsets.get(`${c.patternCode}:${c.proposalKind}`);
    if (!offset) return ctx;
    return { ...ctx, visitCount: ctx.visitCount - offset };
  }

  /**
   * 作用点2: w4(StaffAffinity)入力の解決。
   * proposalKindごとに、staffのaffinity_score実測値(非null)があればその平均を、
   * なければstyle_affinity[staff.style][kind]のpriorを使う。
   * constraintsはStaffAdjustmentデータに対応列が無いため、スタッフ名に紐づく
   * 固定値として解決する(ファイル冒頭コメント参照)。
   */
  resolveAffinity(staff: Staff, adjustments: StaffAdjustment[], priors: StyleAffinityTable): AffinityResolved {
    const perKind = new Map<ProposalKind, number>();
    for (const kind of PROPOSAL_KINDS) {
      const measured = adjustments.filter(
        (a) => a.staffId === staff.id && a.proposalKind === kind && a.affinityScore != null
      );
      if (measured.length > 0) {
        const sum = measured.reduce((acc, a) => acc + (a.affinityScore as number), 0);
        perKind.set(kind, sum / measured.length);
      } else {
        perKind.set(kind, priors[staff.style][kind]);
      }
    }

    const timingOffsets = new Map<string, number>();
    for (const a of adjustments) {
      if (a.staffId !== staff.id || a.timingOffset === 0) continue;
      timingOffsets.set(`${a.patternId}:${a.proposalKind}`, a.timingOffset);
    }

    return {
      style: staff.style,
      perKind,
      timingOffsets,
      constraints: {
        mandatoryMax: MANDATORY_MAX,
        subscriptionStyle: staff.name === DOCUMENT_HANDOVER_STAFF_NAME ? SUBSCRIPTION_STYLE_CONSTRAINT : undefined,
      },
    };
  }

  /**
   * 作用点3: 出力時のscript_style + 適用制約一覧。
   * - scriptStyle: off.style(staffのスタイルそのまま)。
   * - constraintsApplied: mandatoryMaxは常時付与(ScriptComposer/NextActionGeneratorが
   *   mandatory枠数を制約するための情報)。subscription提案かつ
   *   constraints.subscriptionStyleが設定されていれば併せて付与。
   */
  applyOutputStyle(proposal: ScoredCandidate, off: AffinityResolved): { scriptStyle: StaffStyle; constraintsApplied: string[] } {
    const constraintsApplied: string[] = [`mandatoryMax=${off.constraints.mandatoryMax}`];
    if (proposal.candidate.proposalKind === 'subscription' && off.constraints.subscriptionStyle) {
      constraintsApplied.push(off.constraints.subscriptionStyle);
    }
    return { scriptStyle: off.style, constraintsApplied };
  }
}
