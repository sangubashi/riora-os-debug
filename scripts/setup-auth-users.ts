/**
 * Supabase Auth にスタッフユーザーを作成し、パスワードを設定します。
 * 既にユーザーが存在する場合はパスワードを更新します。
 *
 * 実行: npx ts-node scripts/setup-auth-users.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env に設定してください。');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const STAFF_USERS = [
  { email: 'admin@salon-riora.jp',    password: 'riora2026', name: '管理者' },
  { email: 'kameyama@salon-riora.jp', password: 'riora2026', name: '亀山 純香' },
  { email: 'todate@salon-riora.jp',   password: 'riora2026', name: '外舘 裕子' },
];

async function setupUsers() {
  console.log('🌸 Salon Riora — スタッフ認証セットアップ\n');

  for (const user of STAFF_USERS) {
    // まず既存ユーザーを検索
    const { data: { users }, error: listErr } =
      await supabaseAdmin.auth.admin.listUsers();

    if (listErr) {
      console.error(`ユーザー一覧の取得に失敗: ${listErr.message}`);
      process.exit(1);
    }

    const existing = users.find(u => u.email === user.email);

    if (existing) {
      // 既存ユーザーのパスワードを更新
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        existing.id,
        { password: user.password }
      );
      if (error) {
        console.error(`  ✗ ${user.name} の更新失敗: ${error.message}`);
      } else {
        console.log(`  ✓ ${user.name} (${user.email}) — パスワード更新済み`);
      }
    } else {
      // 新規ユーザーを作成
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email:    user.email,
        password: user.password,
        email_confirm: true,   // メール確認不要でそのまま有効化
      });
      if (error) {
        console.error(`  ✗ ${user.name} の作成失敗: ${error.message}`);
      } else {
        console.log(`  ✓ ${user.name} (${user.email}) — 作成済み`);
      }
    }
  }

  console.log('\n完了しました。パスワード: riora2026');
}

setupUsers().catch(console.error);
