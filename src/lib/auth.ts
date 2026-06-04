import { supabase } from './supabase';

/**
 * スタッフID → Supabase Auth メールアドレスのマッピング
 *
 * 事前準備：Supabase Dashboard → Authentication → Users から
 * 以下のユーザーを作成してください（パスワードは任意）
 *   admin@salon-riora.jp
 *   kameyama@salon-riora.jp
 *   todate@salon-riora.jp
 */
export const STAFF_EMAILS: Record<string, string> = {
  admin:    'admin@salon-riora.jp',
  kameyama: 'kameyama@salon-riora.jp',
  todate:   'todate@salon-riora.jp',
  demo:     'demo@riora.jp',
};

// メール → スタッフID の逆引き
const EMAIL_TO_STAFF_ID: Record<string, string> = Object.fromEntries(
  Object.entries(STAFF_EMAILS).map(([id, email]) => [email, id])
);

/** メールアドレスとパスワードでログイン。成功時はスタッフID を返す */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (
      error.message.includes('Invalid login credentials') ||
      error.message.includes('invalid_credentials')
    ) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }
    if (error.message.includes('network') || error.message.includes('fetch')) {
      throw new Error('接続エラーです。電波状況を確認してください');
    }
    throw new Error('ログインに失敗しました。もう一度お試しください');
  }

  const staffId = EMAIL_TO_STAFF_ID[email];
  if (!staffId) throw new Error('このアカウントはスタッフ登録されていません');

  return staffId;
}

/** パスワードでログイン。成功時はスタッフID を返す */
export async function signIn(staffId: string, password: string): Promise<string> {
  const email = STAFF_EMAILS[staffId];
  if (!email) throw new Error('スタッフ情報が見つかりません');

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (
      error.message.includes('Invalid login credentials') ||
      error.message.includes('invalid_credentials')
    ) {
      throw new Error('パスワードが正しくありません');
    }
    if (error.message.includes('network') || error.message.includes('fetch')) {
      throw new Error('接続エラーです。電波状況を確認してください');
    }
    throw new Error('ログインに失敗しました。もう一度お試しください');
  }

  return staffId;
}

/** ログアウト */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** 現在のセッションからスタッフIDを取得（ない場合は null） */
export async function getCurrentStaffId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email) return null;
  return EMAIL_TO_STAFF_ID[session.user.email] ?? null;
}

/** 認証状態の変化を監視する */
export function onAuthStateChange(
  callback: (event: 'SIGNED_IN' | 'SIGNED_OUT') => void
) {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN')  callback('SIGNED_IN');
    if (event === 'SIGNED_OUT') callback('SIGNED_OUT');
  });
  return () => data.subscription.unsubscribe();
}
