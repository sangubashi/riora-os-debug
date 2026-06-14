// ================================================================
// ScenarioQueueBuilder (Scenario Engine Step2-3)
//
// 責務: ScenarioSelector(Step2-2)が選んだSelectedScenarioを、
// LINE送信キュー登録用のペイロード(LineSendQueuePayload)へ変換する。
// Queue生成のみを担当し、送信は行わない。
//
// 生成項目: customer_id / store_id / scenario_code / template_id /
//          scheduled_at / approval_status
// approval_statusは常に'pending'固定(送信禁止。承認後に送信ワーカーが
// 処理する前提のキューに積むだけ)。
//
// SelectedScenario(Step2-2)はscenarioCode/priority/customerType/channel/
// updatedAtのみを持ち、customer_id/store_id/template_id/scheduled_atに
// 相当する情報を含まない。これらは呼出側(ExecutionService等)が別途
// 保持する値のためInputとして受け取り、そのまま組み立てる
// (値の算出やDB問い合わせは行わない=Queue生成のみ)。
//
// 既存のline_send_queueテーブル(20260606_create_line_send_queue.sql)とは
// カラム構成が異なる(statusカラム vs approval_status、store_id/
// scenario_codeカラムが存在しない)。LineSendQueuePayloadはScenario
// Engine内部の組み立て契約であり、実テーブルへのマッピングはRepository
// 層の責務とする。
//
// 依存規則: Supabase importを行わない。純粋関数(例外を投げる要因が
// 無いためtry/catchは設けない)。
// ================================================================

import type { UUID } from '../../types/riora.types';
import type { ISODateTime, SelectedScenario } from './ScenarioSelector';

export type ApprovalStatus = 'pending';

export interface ScenarioQueueBuildInput {
  selected: SelectedScenario;
  customerId: UUID;
  storeId: UUID;
  templateId: string;
  scheduledAt: ISODateTime;
}

export interface LineSendQueuePayload {
  customer_id: UUID;
  store_id: UUID;
  scenario_code: string;
  template_id: string;
  scheduled_at: ISODateTime;
  approval_status: ApprovalStatus;
}

export class ScenarioQueueBuilder {
  build(input: ScenarioQueueBuildInput): LineSendQueuePayload {
    const { selected, customerId, storeId, templateId, scheduledAt } = input;
    return {
      customer_id: customerId,
      store_id: storeId,
      scenario_code: selected.scenarioCode,
      template_id: templateId,
      scheduled_at: scheduledAt,
      approval_status: 'pending',
    };
  }
}
