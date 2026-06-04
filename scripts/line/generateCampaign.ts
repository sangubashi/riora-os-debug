/**
 * LINE AIキャンペーン生成スクリプト
 * 使い方: npx ts-node scripts/line/generateCampaign.ts --theme 乾燥
 *
 * テーマ例: 毛穴 / 乾燥 / 紫外線 / 睡眠 / 肌荒れ / 季節美容
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { generateLineCampaignMessage } from '../../app/lib/claude/linePrompt';
import { createCampaignDraft } from '../../app/lib/supabase/lineCampaigns';

const VALID_THEMES = ['毛穴', '乾燥', '紫外線', '睡眠', '肌荒れ', '季節美容'];

function parseArgs(): { theme: string; tags: string[] } {
  const args = process.argv.slice(2);
  const themeIdx = args.findIndex(a => a === '--theme' || a === '-t');
  const theme = themeIdx !== -1 ? args[themeIdx + 1] : '';

  if (!theme) {
    console.error('エラー: --theme を指定してください');
    console.error(`使用例: npx ts-node scripts/line/generateCampaign.ts --theme 乾燥`);
    console.error(`テーマ: ${VALID_THEMES.join(' / ')}`);
    process.exit(1);
  }

  const tagsIdx = args.findIndex(a => a === '--tags');
  const tagsRaw = tagsIdx !== -1 ? args[tagsIdx + 1] : '';
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()) : [theme];

  return { theme, tags };
}

async function main() {
  const { theme, tags } = parseArgs();

  console.log(`\n🌸 Salon Riora LINE キャンペーン生成`);
  console.log(`テーマ: ${theme}`);
  console.log(`ターゲットタグ: ${tags.join(', ')}`);
  console.log('────────────────────────────────────');
  console.log('Claude にメッセージ生成を依頼中...\n');

  const messageText = await generateLineCampaignMessage(theme);

  console.log('生成されたメッセージ:');
  console.log('────────────────────────────────────');
  console.log(messageText);
  console.log('────────────────────────────────────\n');

  console.log('Supabase に draft として保存中...');
  const campaign = await createCampaignDraft({ title: theme, body: messageText, target_tags: tags });

  console.log(`✅ 保存完了 (id: ${campaign.id})`);
  console.log('管理画面から確認・承認してください。\n');
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
