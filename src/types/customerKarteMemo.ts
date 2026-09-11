/**
 * CustomerKarteMemo 型定義
 *
 * 絶対ルール: このファイルおよびcustomer_karte_memosテーブルを、ProposalOrchestrator /
 * FireScore / PatternEngine / LINE提案 / TodayFocusCard のいずれにもimportしないこと。
 * content は接客支援AIには一切渡さない(customer_memories・customerMemory.tsと同じ絶対ルール)。
 */

export interface CustomerKarteMemo {
  id:         string
  customer_id: string
  staff_id:   string | null
  staffName:  string | null
  content:    string
  created_at: string
  updated_at: string
}
