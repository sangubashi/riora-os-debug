-- ================================================================
-- STAFF_MANAGEMENT_PHASE2_2_IMPLEMENT_1 (2026-07-17)
--
-- 目的: 招待経由の新規スタッフ作成フローを実際に動作させるための、招待トークンを
-- 保持する新規テーブル。設計根拠: docs/STAFF_MANAGEMENT_PHASE2_DESIGN_2.md 5章。
--
-- 既知の注意点(実装時の混乱防止のため明記): このプロジェクトには
-- src/store/useAuthStore.ts に `staff_invitations`(複数形・末尾s)という
-- 名前の似た別テーブルを参照するコード(inviteStaff/fetchInvitations/
-- revokeInvitation/signUp内のcheck_signup_allowed呼び出し)が既に存在するが、
-- docs/STAFF_MANAGEMENT_PHASE1_AUDIT_1.md 3章で「本番に存在しないテーブル・
-- 関数」「動作しない死んだコード」と既に判定済みである。本テーブル
-- `staff_invites`(単数形)はそれとは全く別の、今回新規に設計した仕組みであり、
-- 上記の死んだコードを再利用・修正するものではない。名前が似ているため
-- 混同しないよう注意すること。
--
-- token列について: 生トークン(URLに埋め込む値)はDBに平文保存せず、
-- sha256ハッシュ値を保存する(src/repositories/supabase/InviteRepo.ts参照)。
-- 生トークンが万一DBダンプ等で漏洩しても、招待リンクとして悪用できないように
-- するため。
--
-- 本番適用: このセッションでは行っていない(SQL実行禁止・本番データ更新禁止・
-- migration適用禁止の指示のため)。適用にはユーザー側での実行が別途必要。
-- 前提: 20260717120000_staff_management_phase2_1_user_id_unique_guard.sql・
-- 20260717120100_staff_management_phase2_1_provision_staff_rpc.sql を先に
-- 適用しておくこと。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.staff_invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        NOT NULL,
  store_id    uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('owner', 'staff')),
  staff_name  text        NOT NULL,
  email       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- tokenはハッシュ値(sha256・64文字hex)を保持する列。検証・消費のたびに
-- token一致で検索するため、UNIQUEインデックスを兼ねる形で作成する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invites_token ON public.staff_invites (token);
CREATE INDEX IF NOT EXISTS idx_staff_invites_store ON public.staff_invites (store_id);

COMMENT ON TABLE public.staff_invites IS
  'スタッフ招待トークン(STAFF_MANAGEMENT_PHASE2_2)。tokenは生トークンのsha256ハッシュ値(平文は保存しない)。src/repositories/supabase/InviteRepo.ts経由でのみ読み書きすること。';
COMMENT ON COLUMN public.staff_invites.token IS
  '生トークンのsha256ハッシュ値(hex)。生トークンそのものはDBに保存しない。';

-- RLS: 本プロジェクトのbrain_*テーブルと同様、アプリはservice_roleクライアント
-- (app/lib/repos.ts getClient())経由でのみアクセスする方針のため、他のbrain_*
-- テーブル(例: brain_staff)と整合させてRLSは有効化しない
-- (brain_staffもRLS無効・service_role専用アクセスが実態のため踏襲)。
