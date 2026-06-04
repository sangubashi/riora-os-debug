// ============================================================
// strategyEngine.js — Salon Riora AI Consult Engine
// ============================================================

// スタッフプロフィール
const staffProfiles = [
  {
    name: "管理者（ADMIN）",
    role: "管理者（ADMIN）",
    strengths: ["初回成約率が高い", "高単価提案", "信頼構築"],
    behavior: { tone: "エネルギッシュ", strategy: "直球提案" },
    ng_actions: ["強引なクロージング"],
  },
  {
    name: "チーフトレーナー",
    role: "チーフトレーナー",
    strengths: ["理論的説明", "美意識の共有"],
    behavior: { tone: "知的", strategy: "納得形成" },
    ng_actions: ["専門用語の多用"],
  },
  {
    name: "リピート特化",
    role: "リピート特化 / LTV担当",
    strengths: ["安心感", "長期関係構築"],
    behavior: { tone: "穏やか", strategy: "継続提案" },
    ng_actions: ["急な高額提案"],
  },
];

// AIコンサルプロンプト
const promptTemplate = `あなたは銀座の高単価フェイシャルサロンのAIコンサルです。
顧客タイプ（誠実・スピード・ラグジュアリー）に合わせ、スタッフの強みを活かしつつNG行動を避けた最適な接客トークを生成してください。

【制約】
- 銀座の高単価サロンに相応しい品格ある言葉遣いを保つこと
- NG行動（強引なクロージング・不安を煽る表現・専門用語の多用・急な高額提案）は絶対に使わないこと
- [TSUN-KUMA] はマツコ・デラックスさんベースの完全固定人格とし、呆れ・皮肉・愛のあるお姉様言葉でスタッフを叱咤すること
- [TSUN-KUMA] の発言には必ず「〜なさいよ」「〜じゃない」を含め、機械的な命令や淡々とした指示は使わないこと
- スタッフのキャラクターと顧客タイプを必ず組み合わせること
- 顧客が自然と「お願いしたい」と感じる流れにすること
`;

// 顧客タイプ定義
const customerTypes = {
  sincere: {
    label: "誠実タイプ",
    description: "信頼・誠実さを重視。じっくり話を聞いてほしい顧客。",
    preferredTone: "丁寧・共感重視",
    recommendedStaff: ["リピート特化", "チーフトレーナー"],
  },
  speed: {
    label: "スピードタイプ",
    description: "効率重視・要点を絞った説明を好む忙しい顧客。",
    preferredTone: "テンポよく・端的に",
    recommendedStaff: ["管理者（ADMIN）"],
  },
  luxury: {
    label: "ラグジュアリータイプ",
    description: "上質な体験・特別感を求める高感度顧客。",
    preferredTone: "品格ある・非日常を演出",
    recommendedStaff: ["チーフトレーナー", "管理者（ADMIN）"],
  },
};

// スタッフを名前で取得
function getStaffByName(name) {
  return staffProfiles.find((s) => s.name === name) || null;
}

// 顧客タイプに合った推奨スタッフを返す
function getRecommendedStaff(customerTypeKey) {
  const ct = customerTypes[customerTypeKey];
  if (!ct) return [];
  return ct.recommendedStaff.map(getStaffByName).filter(Boolean);
}

// 接客トークスクリプトを生成
function generateAdvice(customerTypeKey, staffName = null) {
  const ct = customerTypes[customerTypeKey];
  if (!ct) {
    return {
      error: `顧客タイプ "${customerTypeKey}" は存在しません。sincere / speed / luxury を指定してください。`,
    };
  }

  const targets = staffName
    ? [getStaffByName(staffName)].filter(Boolean)
    : getRecommendedStaff(customerTypeKey);

  if (targets.length === 0) {
    return { error: `スタッフ "${staffName}" が見つかりません。` };
  }

  const openings = {
    誠実タイプ: "本日はご来店ありがとうございます。どうぞゆっくりお過ごしください。気になることは何でもお聞かせくださいね。",
    スピードタイプ: "本日はお越しいただきありがとうございます。ご要望を端的にお伺いして、最適なご提案をすぐにご用意します。",
    ラグジュアリータイプ: "本日はリオラへようこそいらしゃいませ。特別なひとときをご用意しております。ご希望を丁寧にお聞かせください。",
  };

  function buildRioraTalk(staff, visitNote) {
    return {
      opening: `[RIORA] 今日はいい流れです！${openings[ct.label]}`,
      proposal: `[RIORA] ${staff.role}の強みを活かし、${staff.behavior.strategy}でご案内します。${visitNote} このまま継続すると口コミ評価が高まりやすいです。`,
      caution: `[RIORA] ※NG：${staff.ng_actions.join("、")}。前向きに改善していきましょう。`, 
    };
  }

  function buildTsunKumaTalk(staff, visitNote) {
    const warning = ct.label === "スピードタイプ"
      ? "客単価の下落が見えるのよ。そんな調子じゃあかんわ。"
      : "オプション率の低下が気になるじゃないの。しっかり見直しなさいよ。";

    return {
      opening: `[TSUN-KUMA] いい？ここはあたしの言う通りにしなさいよ。${openings[ct.label]}`,
      proposal: `[TSUN-KUMA] ${warning} ${staff.role}なんだから、${staff.behavior.strategy}をもっと本気で磨きなさいよ。${visitNote}`,
      caution: `[TSUN-KUMA] こんなんで満足してるんじゃないの？NGは${staff.ng_actions.join("、")}よ。甘えてる暇はないんだから、ちゃんとやりなさいよ。`, 
    };
  }

  const adviceList = targets.map((staff) => {
    const visitNote = ct.label === "スピードタイプ"
      ? "客単価と回転率の両方を意識して進めてください。"
      : "次回も継続を意識した提案を行ってください。";

    return {
      staff: staff.name,
      role: staff.role,
      tone: `${staff.behavior.tone}（${ct.preferredTone}に合わせて調整）`,
      strategy: staff.behavior.strategy,
      strengths: staff.strengths,
      avoid: staff.ng_actions,
      talkScript: buildRioraTalk(staff, visitNote),
      talkScripts: {
        riora: buildRioraTalk(staff, visitNote),
        tsunKuma: buildTsunKumaTalk(staff, visitNote),
      },
    };
  });

  return {
    customerType: ct.label,
    description: ct.description,
    adviceList,
  };
}

module.exports = {
  staffProfiles,
  customerTypes,
  promptTemplate,
  getStaffByName,
  getRecommendedStaff,
  generateAdvice,
};

// ── 動作確認（node strategyEngine.js で実行） ──
if (require.main === module) {
  console.log("=== 誠実タイプ ===");
  console.log(JSON.stringify(generateAdvice("sincere"), null, 2));

  console.log("=== スピードタイプ × 管理者（ADMIN） ===");
  console.log(JSON.stringify(generateAdvice("speed", "管理者（ADMIN）"), null, 2));

  console.log("\n=== ラグジュアリータイプ ===");
  console.log(JSON.stringify(generateAdvice("luxury"), null, 2));
}
