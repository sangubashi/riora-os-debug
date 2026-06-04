export type AdminStrategy = "repeat_focus" | "premium_focus" | "stability_focus";

const strategyLabels: Record<AdminStrategy, string> = {
  repeat_focus: "リピート重視",
  premium_focus: "プレミアム重視",
  stability_focus: "安定重視",
};

let currentAdminStrategy: AdminStrategy = "repeat_focus";

export function getAdminStrategy(): AdminStrategy {
  return currentAdminStrategy;
}

export function getAdminStrategyLabel(strategy: AdminStrategy = currentAdminStrategy): string {
  return strategyLabels[strategy];
}

export function setAdminStrategy(strategy: AdminStrategy): void {
  currentAdminStrategy = strategy;
}

export function buildAdminStrategyCommentary(): string {
  switch (currentAdminStrategy) {
    case "premium_focus":
      return "現在の管理者戦略はプレミアム重視です。高付加価値メニューとVIP化施策を強化してください。";
    case "stability_focus":
      return "現在の管理者戦略は安定重視です。リスクを抑えた継続施策と低離脱運用を優先します。";
    case "repeat_focus":
    default:
      return "現在の管理者戦略はリピート重視です。継続来店を軸にした提案とフォロー強化を行ってください。";
  }
}
