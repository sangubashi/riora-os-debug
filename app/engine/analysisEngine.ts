import { SecureProfile } from "../lib/customerManager";
import { supabaseAdmin as db } from "../lib/supabaseAdminClient";
import { getAdminStrategy } from "../lib/adminControl";

// ============================================================
// 型定義
// ============================================================

export interface AnalysisContext {
  importedHashIds: string[];
  profiles: SecureProfile[];
  importedAt: string;
  sourceFile: string;
  summary: { total: number; success: number; skipped: number; errorCount: number };
}

// サロンタイプ A–F（施術軸の分類）
export type SalonCustomerType = "A" | "B" | "C" | "D" | "E" | "F";

// 来店ステージ
type VisitStage = "WELCOME" | "EARLY" | "REGULAR" | "LOYAL" | "VIP" | "AT_RISK";

// AI アドバイス人格タグ（UI側でアイコンを出し分ける）
export type PersonalityTag = "[RIORA]" | "[AI分析]";

export interface PersonalityAdvice {
  tag: PersonalityTag;
  message: string;          // タグ込みの完全なメッセージ
  rawMessage: string;       // タグなし本文（UI描画用）
  trigger: string;          // どの指標が人格を決定したか（デバッグ用）
}

export interface AnalysisResult {
  hashId: string;
  salonType: SalonCustomerType;
  recommendedMenu: string;
  recommendedOption: string;
  nextVisitMessage: string;
  visitStage: VisitStage;
  riskScore: number;
  vipCandidate: boolean;
  customerType?: "sincere" | "speed" | "luxury";
  advice: PersonalityAdvice;          // 人格付きアドバイス
  memo?: string;
}

// フック関数の型（外部から差し込む場合）
export type AnalysisHook = (ctx: AnalysisContext) => Promise<AnalysisResult[]>;

let _hook: AnalysisHook | null = null;

export function registerAnalysisHook(fn: AnalysisHook): void {
  _hook = fn;
}

// ============================================================
// STEP 1: 顧客タイプ A–F の判定
// 来店回数 × LTV × 肌タイプ で分類
// ============================================================
function classifySalonType(p: SecureProfile): SalonCustomerType {
  const { visitCount, ltv, skinType, isVip } = p;
  const strategy = getAdminStrategy();

  if (strategy === "premium_focus" && (isVip || ltv >= 120000)) return "A";
  if (isVip || ltv >= 150000)                              return "A"; // VIP・超高LTV
  if (skinType === "sensitive")                            return "B"; // 敏感肌
  if (skinType === "dry" && visitCount >= 3)              return "C"; // 乾燥肌リピーター
  if (strategy === "repeat_focus" && visitCount >= 4)      return "C";
  if (skinType === "oily" && visitCount >= 3)             return "D"; // 脂性肌リピーター
  if (skinType === "oily" || skinType === "combination")  return "E"; // 毛穴悩み系
  if (visitCount <= 2)                                    return "F"; // 新規・肌リセット
  return "C"; // フォールバック
}

// ============================================================
// STEP 2: メニュー提案（提供されたロジック）
// ============================================================
function recommendMenu(customerType: SalonCustomerType): { menu: string; option: string } {
  const strategy = getAdminStrategy();

  switch (customerType) {
    case "A":
      return {
        menu: strategy === "premium_focus" ? "プレミアムEMS＋ヒト幹細胞フェイシャル" : "EMS＋ヒト幹細胞フェイシャル",
        option: strategy === "premium_focus" ? "プラセンタ導入" : "造顔マッサージ",
      };
    case "B":
      return {
        menu: "水素＋ヒト幹細胞",
        option: strategy === "stability_focus" ? "カーミングパック" : "カーミングパック",
      };
    case "C":
      return {
        menu: strategy === "repeat_focus" ? "継続ケア・ヒト幹細胞フェイシャル" : "ヒト幹細胞100%フェイシャル",
        option: strategy === "repeat_focus" ? "継続パック" : "エレクトロポレーション",
      };
    case "D":
      return {
        menu: "水素＋ヒト幹細胞",
        option: strategy === "repeat_focus" ? "オイルマッサージ継続" : "オイルマッサージ",
      };
    case "E":
      return {
        menu: strategy === "premium_focus" ? "プレミアム毛穴洗浄＋ヒト幹細胞" : "毛穴洗浄＋ヒト幹細胞",
        option: strategy === "repeat_focus" ? "炭酸パック継続" : "炭酸パック",
      };
    case "F":
      return {
        menu: strategy === "repeat_focus" ? "継続ハーブピーリング＋幹細胞" : "ハーブピーリング＋幹細胞",
        option: "肌別パック",
      };
    default:
      return { menu: "肌リセットコース", option: "幹細胞高濃度パック" };
  }
}

// ============================================================
// STEP 3: 次回来店予測 & メッセージ生成
// ============================================================
function classifyVisitStage(p: SecureProfile): VisitStage {
  // AT_RISK を最優先（VIP・LOYAL でも90日未来店なら要フォロー）
  if (p.lastVisitAt) {
    const daysSince = (Date.now() - new Date(p.lastVisitAt).getTime()) / 86400000;
    if (daysSince >= 90) return "AT_RISK";
  }
  if (p.isVip)              return "VIP";
  if (p.visitCount === 1)   return "WELCOME";
  if (p.visitCount <= 3)    return "EARLY";
  if (p.visitCount <= 8)    return "REGULAR";
  return "LOYAL";
}

function buildNextVisitMessage(stage: VisitStage, salonType: SalonCustomerType): string {
  const menuHint = recommendMenu(salonType).menu;
  const strategy = getAdminStrategy();

  const strategyComments: Record<string, string> = {
    repeat_focus: "リピート重視のご提案を強化します。",
    premium_focus: "上質感と付加価値を意識したご案内です。",
    stability_focus: "安定した継続運用を意識したご提案です。",
  };

  const messages: Record<VisitStage, string> = {
    WELCOME:  "今日も丁寧にいきましょう。まずはお肌の状態をしっかり確認させてください。",
    EARLY:    `前回の施術から変化はありましたか？次回は「${menuHint}」でさらに効果を高めましょう。`,
    REGULAR:  `継続のお力を感じています。次のステップとして「${menuHint}」をご提案いたします。`,
    LOYAL:    `いつもありがとうございます。お肌の変化を一緒に振り返り、最適なケアを続けましょう。`,
    VIP:      `特別なお時間をご用意しています。「${menuHint}」で最高のコンディションに仕上げます。`,
    AT_RISK:  `お久しぶりです。お肌のリセットに「${menuHint}」がおすすめです。またお会いできるのを楽しみにしています。`,
  };

  return `${messages[stage]} ${strategyComments[strategy]}`;
}

// ============================================================
// STEP 4: リスクスコア算出（0–10）
// ============================================================
function calcRiskScore(p: SecureProfile, stage: VisitStage): number {
  let score = 0;

  if (stage === "AT_RISK")   score += 5;
  if (stage === "WELCOME")   score += 4;
  if (stage === "EARLY")     score += 3;
  if (p.visitCount < 2)      score += 2;
  if (p.ltv < 10000)         score += 1;

  // LTV・来店回数が多いほどリスク低下
  if (p.isVip)               score -= 3;
  if (p.visitCount >= 8)     score -= 2;
  if (p.ltv >= 100000)       score -= 2;

  return Math.max(0, Math.min(10, score));
}

// ============================================================
// STEP 5a: 人格判定 — どちらが話すかを決める
// ============================================================
type PersonalityTrigger =
  | "vip_achieved"
  | "loyal_repeat"
  | "high_ltv"
  | "vip_candidate"
  | "good_recovery"
  | "at_risk"
  | "high_risk_score"
  | "ltv_stagnant"
  | "no_return"
  | "early_churn_risk";

function selectPersonality(
  p: SecureProfile,
  stage: VisitStage,
  riskScore: number
): { tag: PersonalityTag; trigger: PersonalityTrigger } {
  // ── リスク判定を先に: AI アラートモードで処理 ─────────
  // （AT_RISK は LTV・VIP より優先して検出する）
  if (stage === "AT_RISK")
    return { tag: "[AI分析]", trigger: "at_risk" };
  if (riskScore >= 7)
    return { tag: "[AI分析]", trigger: "high_risk_score" };
  if (p.visitCount >= 4 && p.ltv < 30000)
    return { tag: "[AI分析]", trigger: "ltv_stagnant" };
  if (stage === "EARLY" && riskScore >= 5)
    return { tag: "[AI分析]", trigger: "early_churn_risk" };

  // ── ポジティブ判定 ──────────────────────────
  if (p.isVip)
    return { tag: "[RIORA]", trigger: "vip_achieved" };
  if (stage === "LOYAL" && riskScore <= 3)
    return { tag: "[RIORA]", trigger: "loyal_repeat" };
  if (p.ltv >= 150000 && riskScore <= 4)
    return { tag: "[RIORA]", trigger: "high_ltv" };
  if (p.visitCount >= 4 && !p.isVip && p.ltv >= 50000)
    return { tag: "[RIORA]", trigger: "vip_candidate" };
  if (stage === "REGULAR" && riskScore <= 2)
    return { tag: "[RIORA]", trigger: "good_recovery" };

  // ── 中立デフォルト ─────────────────────────
  return { tag: "[RIORA]", trigger: "good_recovery" };
}

// ============================================================
// STEP 5b: ポジティブフィードバック生成
// ============================================================
function buildRioraMessage(
  p: SecureProfile,
  stage: VisitStage,
  salonType: SalonCustomerType,
  trigger: PersonalityTrigger
): string {
  const menu = recommendMenu(salonType).menu;

  const messages: Partial<Record<PersonalityTrigger, string>> = {
    vip_achieved:
      `VIP認定、おめでとうございます！✨ ${p.visitCount}回のご来店と¥${p.ltv.toLocaleString()}のご投資が、確かな美しさになって返ってきています。次回は「${menu}」で、さらに上のステージへ。`,
    loyal_repeat:
      `${p.visitCount}回のご来店、本当にありがとうございます🌸 継続こそが最強のスキンケア。次回「${menu}」で、蓄積された効果をさらに引き出しましょう。`,
    high_ltv:
      `累計¥${p.ltv.toLocaleString()}のご信頼、スタッフ一同感謝しています💛 次回は「${menu}」で、今の状態をさらに高めるご提案をします。`,
    vip_candidate:
      `あと一歩でVIPです！🎯 ${p.visitCount}回のご来店で確かな変化が出ています。次回「${menu}」でVIP認定を一緒に目指しましょう！`,
    good_recovery:
      `いいペースで通ってくださっています😊 お肌の土台がしっかり整ってきた証拠です。次回「${menu}」でさらに仕上げていきましょう。`,
  };

  return messages[trigger] ?? `素晴らしい進捗です✨ 次回は「${menu}」をご提案します。`;
}

// ============================================================
// STEP 5c: AI アラート — 丁寧かつ的確なアドバイスを提供
// ルール: 命令形・機械的表現は禁止。呆れ・皮肉・お姉様言葉で統一。
// 語尾: 〜なさいよ / 〜じゃない / 〜でしょ / 〜わよ / 〜のよ
// ============================================================
function buildTsunKumaMessage(
  p: SecureProfile,
  stage: VisitStage,
  salonType: SalonCustomerType,
  trigger: PersonalityTrigger
): string {
  const menu = recommendMenu(salonType).menu;
  const daysSince = p.lastVisitAt
    ? Math.round((Date.now() - new Date(p.lastVisitAt).getTime()) / 86400000)
    : 0;

  const messages: Partial<Record<PersonalityTrigger, string>> = {

    at_risk:
      `はぁ〜…${daysSince}日よ？アタシ、その数字見て思わず深呼吸したわ。` +
      `せっかく積み上げてきたお肌、今ごろどうなってると思う？` +
      `「${menu}」でまだ間に合うけど、これ以上放っておいたら基礎からやり直しよ。` +
      `あなたが諦めなければ、お客様も戻ってきてくれるじゃない。連絡なさいよ、ね？`,

    high_risk_score:
      `ちょっとちょっと、これどういうこと？${p.visitCount}回も通ってくれてるのに定着してないって、` +
      `それはお客様のせいじゃないわよね？アタシそう思うのよ。` +
      `接客のどこかで「あ、この人は分かってくれない」って思わせてるんじゃない？` +
      `次「${menu}」のとき、説明より先に気持ちに寄り添ってみなさいよ。絶対変わるから。`,

    ltv_stagnant:
      `${p.visitCount}回来てくれてLTV¥${p.ltv.toLocaleString()}って…アタシ笑っていいのかしら、これ。` +
      `毎回「ありがとうございました〜！」でお見送りしてるんでしょ？` +
      `オプションって言葉、もしかして怖いの？押しつけがましくなんかないのよ、` +
      `「次回は「${menu}」と合わせてこれも試してみない？」って一言言えるだけでいいじゃない。` +
      `お客様はね、提案してもらえることを待ってるのよ。`,

    early_churn_risk:
      `まだ${p.visitCount}回しか来てないのにもうこの感じ、ちょっと心配じゃない？` +
      `初回で「また来たい」って思ってもらえなかったってことでしょ、これ。` +
      `難しいことはいいのよ。「${menu}」のとき、ただ楽しんで帰ってもらうことだけ考えなさいよ。` +
      `そのたった一つができれば、流れは変わるわよ、絶対に。`,

  };

  return (
    messages[trigger] ??
    `ねぇ、このままでいいと思ってるの？アタシはそうは思わないわよ。` +
    `「${menu}」でもう一度ちゃんと向き合ってみなさいよ。諦めるには早すぎるじゃない。`
  );
}

// ============================================================
// STEP 5d: 人格アドバイスをまとめて生成
// ============================================================
function generatePersonalityAdvice(
  p: SecureProfile & { vipCandidate?: boolean },
  stage: VisitStage,
  riskScore: number,
  salonType: SalonCustomerType
): PersonalityAdvice {
  const { tag, trigger } = selectPersonality(p, stage, riskScore);

  const rawMessage =
    tag === "[RIORA]"
      ? buildRioraMessage(p, stage, salonType, trigger)
      : buildTsunKumaMessage(p, stage, salonType, trigger);

  return {
    tag,
    rawMessage,
    message: `${tag} ${rawMessage}`,
    trigger,
  };
}

// ============================================================
// STEP 6: 接客スタイル分類（sincere / speed / luxury）
// ============================================================
function classifyCustomerStyle(p: SecureProfile): "sincere" | "speed" | "luxury" {
  const strategy = getAdminStrategy();
  if (strategy === "premium_focus" && (p.ltv >= 100000 || p.isVip)) return "luxury";
  if (strategy === "repeat_focus" && p.visitCount >= 4) return "speed";
  if (p.ltv >= 150000 || p.isVip) return "luxury";
  if (p.visitCount >= 5)          return "speed";  // 慣れたリピーターは効率重視
  return "sincere";                                 // 初期は誠実・丁寧に
}

// ============================================================
// STEP 6: DB 書き戻し（customers_secure + ai_suggestions）
// ============================================================
async function persistResults(results: AnalysisResult[]): Promise<void> {
  for (const r of results) {
    // customers_secure: risk_score / customer_type / notes を更新
    await db.from("customers_secure").update({
      risk_score:    r.riskScore,
      customer_type: r.customerType ?? null,
      notes:         r.memo ?? null,
    }).eq("hash_id", r.hashId);

    // ai_suggestions: 今回の解析結果を提案レコードとして保存
    await db.from("ai_suggestions").insert({
      customer_hash_id: r.hashId,
      staff_id:         "system_analysis",
      suggested_menu:   r.recommendedMenu,
      suggested_tone:   r.visitStage,
      strategy_logic: {
        salonType:          r.salonType,
        recommendedOption:  r.recommendedOption,
        nextVisitMessage:   r.nextVisitMessage,
        riskScore:          r.riskScore,
        vipCandidate:       r.vipCandidate,
        customerType:       r.customerType,
        adviceTag:          r.advice.tag,
        adviceMessage:      r.advice.rawMessage,
        adviceTrigger:      r.advice.trigger,
      },
    });
  }
}

// ============================================================
// エントリーポイント: インポート完了後に呼び出される
// ============================================================
export async function runAnalysis(ctx: AnalysisContext): Promise<AnalysisResult[]> {
  let results: AnalysisResult[];

  if (_hook) {
    // 外部フックが登録されている場合はそちらを優先
    console.log(`[AnalysisEngine] カスタムフック実行: ${ctx.importedHashIds.length}件`);
    results = await _hook(ctx);
  } else {
    // 組み込み解析エンジンを実行
    console.log(`[AnalysisEngine] 組み込みエンジン実行: ${ctx.profiles.length}件`);
    results = ctx.profiles.map((p) => {
      const salonType   = classifySalonType(p);
      const { menu, option } = recommendMenu(salonType);
      const stage       = classifyVisitStage(p);
      const riskScore   = calcRiskScore(p, stage);
      const customerType = classifyCustomerStyle(p);

      const vipCandidate = p.visitCount >= 4 && !p.isVip && p.ltv >= 50000;
      const advice = generatePersonalityAdvice(
        { ...p, vipCandidate } as SecureProfile & { vipCandidate: boolean },
        stage, riskScore, salonType
      );

      return {
        hashId:              p.hashId,
        salonType,
        recommendedMenu:     menu,
        recommendedOption:   option,
        nextVisitMessage:    buildNextVisitMessage(stage, salonType),
        visitStage:          stage,
        riskScore,
        vipCandidate,
        customerType,
        advice,
        memo: `タイプ${salonType} / ${stage} / リスク${riskScore} / ${advice.tag}`,
      };
    });
  }

  console.log(`[AnalysisEngine] 完了: ${results.length}件 → DB書き戻し中...`);
  await persistResults(results);
  console.log("[AnalysisEngine] DB書き戻し完了");

  return results;
}

// フォールバック（フック未登録時の後方互換）
export function defaultAnalysis(profiles: SecureProfile[]): AnalysisResult[] {
  return profiles.map((p) => {
    const salonType    = classifySalonType(p);
    const { menu, option } = recommendMenu(salonType);
    const stage        = classifyVisitStage(p);
    const riskScore    = calcRiskScore(p, stage);
    const vipCandidate = p.visitCount >= 4 && !p.isVip;
    const advice       = generatePersonalityAdvice(p, stage, riskScore, salonType);
    return {
      hashId: p.hashId, salonType,
      recommendedMenu: menu, recommendedOption: option,
      nextVisitMessage: buildNextVisitMessage(stage, salonType),
      visitStage: stage, riskScore, vipCandidate,
      customerType: classifyCustomerStyle(p),
      advice,
      memo: `${advice.tag} / タイプ${salonType}`,
    };
  });
}
