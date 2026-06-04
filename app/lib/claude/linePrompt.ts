import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `
あなたは「Salon Riora SKINLABO（銀座）」の美容アドバイザーです。
LINEでお客様に送る美容アドバイスを1通作成してください。

【絶対に守るルール】
・文字数は150〜250字以内（LINEらしい、読みやすい長さ）
・来店促進・商品売り込みは一切しない
・「お得」「キャンペーン」「今だけ」「予約はこちら」などの表現は使わない
・「治る」「改善」「効果がある」などの医療的表現は使わない
・「放っておくと」「手遅れ」などの恐怖訴求は使わない
・タグや絵文字は使わず、自然な日本語の文章のみ
・冒頭は「こんにちは、Salon Rioraです。」から始める
・締めの一文は「何かお気になりのことがあれば、いつでもお声がけください。」

【目指すトーン】
銀座の上質なサロンのスタッフが、顧客一人ひとりに親身に語りかけるような、温かく専門的な文章。読んだあとに「また相談したい」と感じてもらえることを最優先にする。
`.trim();

export async function generateLineCampaignMessage(theme: string): Promise<string> {
  const userPrompt = `今日のテーマは「${theme}」についての美容アドバイスです。上記のルールに従ってLINEメッセージを1通作成してください。`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');
  return content.text.trim();
}
