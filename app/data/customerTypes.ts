export const customerTypes = {
  sincere: {
    key: "sincere",
    label: "誠実タイプ",
    description: "信頼・誠実さを重視。じっくり話を聞いてほしい顧客。",
    preferredTone: "丁寧・共感重視",
    recommendedStaffIds: ["todate", "kameyama"],
    approach: "傾聴を中心に、押し付けず選択肢を提示する",
  },
  speed: {
    key: "speed",
    label: "スピードタイプ",
    description: "効率重視・要点を絞った説明を好む忙しい顧客。",
    preferredTone: "テンポよく・端的に",
    recommendedStaffIds: ["suzuki"],
    approach: "結論から伝え、詳細は質問があれば補足する",
  },
  luxury: {
    key: "luxury",
    label: "ラグジュアリータイプ",
    description: "上質な体験・特別感を求める高感度顧客。",
    preferredTone: "品格ある・非日常を演出",
    recommendedStaffIds: ["kameyama", "suzuki"],
    approach: "体験の価値と希少性を丁寧に伝える",
  },
} as const;

export type CustomerTypeKey = keyof typeof customerTypes;
export type CustomerType = (typeof customerTypes)[CustomerTypeKey];
