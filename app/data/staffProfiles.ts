export const staffProfiles = [
  {
    id: "suzuki",
    name: "管理者（ADMIN）",
    age: 35,
    role: "管理者（ADMIN）",
    type: "爆発型・信頼構築型",
    strengths: [
      "初回成約率が高い",
      "高単価提案が自然",
      "VIP化が得意",
      "明るくエネルギッシュ",
    ],
    weaknesses: [
      "テンションが合わない顧客には刺さらない",
      "押しすぎ注意",
    ],
    kpi_focus: ["初回成約", "VIP化", "高単価"],
    behavior: {
      tone: "明るい",
      strategy: "直球提案＋信頼形成",
      upsell: "積極的OK",
      caution: "慎重タイプには圧を抑える",
    },
    ng_actions: ["不安を煽る", "強引クロージング", "医療表現"],
  },
  {
    id: "kameyama",
    name: "チーフトレーナー",
    age: 34,
    role: "チーフトレーナー",
    type: "理論型・感性型",
    strengths: ["理論説明", "美容医療比較", "センス", "美意識訴求"],
    weaknesses: ["説明が長くなりやすい"],
    kpi_focus: ["オプション", "満足度", "口コミ"],
    behavior: {
      tone: "知的",
      strategy: "理論＋納得形成",
      upsell: "理由を明確に",
      caution: "専門用語は噛み砕いて使う",
    },
    ng_actions: ["専門用語多用", "説明過多"],
  },
  {
    id: "todate",
    name: "リピート特化",
    age: 48,
    role: "リピート特化",
    type: "安心感・信頼型",
    strengths: ["安心感", "リピート率", "継続力"],
    weaknesses: ["高額クロージング弱め"],
    kpi_focus: ["継続率", "低失客", "安定売上"],
    behavior: {
      tone: "穏やか",
      strategy: "信頼構築＋継続提案",
      upsell: "段階的・無理のない提案",
      caution: "急な高額提案は避ける",
    },
    ng_actions: ["急な高額提案", "強引な提案"],
  },
];

export type StaffProfile = (typeof staffProfiles)[number];
