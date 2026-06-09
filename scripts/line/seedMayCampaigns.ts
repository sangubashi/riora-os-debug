/**
 * 5・6月向け「価値提供型」LINEメッセージ — 一括シードスクリプト
 * 口コミ評価「ノーファンデで過ごせる肌への変化」「親身・押しつけなし」をベースに生成
 *
 * 実行: npx ts-node scripts/line/seedMayCampaigns.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing ENV: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です');
  process.exit(1);
}

const supabase = createClient(url, key);

// ─── リオラちゃんの口調で生成した5パターン ────────────────────────────
// 基準: 100文字前後 / 口コミで評価された「施術後の変化」をヒントにしたセルフケア情報
// 禁止: 売り込み・医療表現・恐怖訴求
const CAMPAIGNS = [
  {
    title: '紫外線',
    target_tags: ['紫外線対策', '5月', '6月'],
    body:
      '5月の紫外線量は真夏とほぼ同じ強さです。' +
      '日焼け止めは朝だけでなく3〜4時間おきに塗り直すと、肌への刺激がぐっと減りますよ🌿' +
      '施術後の肌は外からの刺激を受けやすいので、ぜひ意識してみてください🌸',
  },
  {
    title: '毛穴',
    target_tags: ['毛穴', '皮脂', '5月', '6月'],
    body:
      '気温が上がると皮脂分泌が増えて毛穴が目立ちやすくなります。' +
      '洗顔後はすぐに保湿するのがコツで、乾燥が続くと逆に皮脂が過剰になりやすいんです✨' +
      'この小さな習慣が、ノーファンデ肌への近道ですよ🌸',
  },
  {
    title: '乾燥×エアコン',
    target_tags: ['乾燥', 'エアコン', '6月', '梅雨'],
    body:
      '梅雨の時期でも、エアコンで室内はとても乾燥します。' +
      '化粧水をつける前に、顔に軽くぬるま湯をなじませるひと手間があると浸透感が変わりますよ🌿' +
      '施術で整えた肌を、ぜひ毎日守ってあげてください🌸',
  },
  {
    title: '季節の変わり目・肌ゆらぎ',
    target_tags: ['肌荒れ', '季節美容', '5月'],
    body:
      '季節の変わり目は肌のリズムが崩れやすい時期です。' +
      'いつもより洗顔をやさしく短めに、そして化粧水はたっぷりと。' +
      '整えた環境が、ゆらぎを静める一番の近道ですよ🌸',
  },
  {
    title: '睡眠と肌の回復',
    target_tags: ['睡眠', '肌回復', '5月', '6月'],
    body:
      '肌が回復するのは夜22時〜深夜2時ごろ。' +
      'この時間帯に眠れていると、施術の効果が肌に定着しやすくなります✨' +
      '睡眠の質が整うだけで、次回のご来店時に「変化したね」と感じていただけることが多いですよ🌿',
  },
];

async function main() {
  console.log('\n🌸 Salon Riora — 5・6月LINEキャンペーン シード開始\n');

  let success = 0;

  for (const c of CAMPAIGNS) {
    const charCount = c.body.length;
    console.log(`テーマ: ${c.title}（${charCount}文字）`);
    console.log(`  ${c.body.slice(0, 40)}…`);

    const { error } = await supabase.from('line_campaigns').insert({
      title: c.title,
      body: c.body,
      target_tags: c.target_tags,
      status: 'draft',
    });

    if (error) {
      console.error(`  ❌ 保存失敗: ${error.message}`);
    } else {
      console.log(`  ✅ draft として保存完了`);
      success++;
    }
    console.log('');
  }

  console.log(`────────────────────────────────────`);
  console.log(`完了: ${success} / ${CAMPAIGNS.length} 件保存`);
  console.log('管理画面の「LINE配信管理」から確認・承認してください。\n');
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
