-- ================================================================
-- STAFF_MANAGEMENT_PHASE2_1_IMPLEMENT_1 (2026-07-17)
--
-- 目的: 招待経由の新規スタッフ作成において、profiles + brain_staff を単一
-- トランザクションで作成し、片方だけ成功する状態を構造的に禁止するRPC。
-- 設計根拠: docs/STAFF_MANAGEMENT_PHASE2_DESIGN_2.md 2章⑤・8章。
--
-- auth.users の作成(supabase.auth.admin.createUser())はこの関数の外側
-- (呼び出し側のサーバー処理・招待APIはPhase2-2で実装予定)で先に行う。本関数は
-- 発行済みのauth.users.id(p_auth_uid)を受け取るだけで、auth.usersへの書き込みは
-- 一切行わない(PL/pgSQLからauth.usersへ直接INSERTしてもGoTrueのパスワード
-- ハッシュ等の付随処理が行われず実用にならないため、Supabase Auth Admin APIを
-- 使う設計になっている)。
--
-- 事故防止: profiles/brain_staffのINSERTを本関数1回の呼び出し(1トランザクション)
-- に集約することで、「profilesだけ/brain_staffだけが作られる」という過去に
-- 実際発生した事故(亀山・外舘のprofiles欠落, 2026-05-08)を構造的に防ぐ。
-- あわせて 20260717120000_staff_management_phase2_1_user_id_unique_guard.sql の
-- UNIQUE制約が、admin流用等でuser_idが重複した場合の最終防衛線として機能する。
--
-- StaffRepo.create()(src/repositories/supabase/StaffRepo.ts)以外から呼ばないこと。
-- StaffRepo.create()は呼び出し前に必ず assertNotAdminAuthUid() を実行する
-- (admin流用事故の再発防止・アプリケーション層の防御)。
--
-- 戻り値の success 列について: 本関数はエラー時に例外(RAISE EXCEPTION)を投げて
-- トランザクション全体をロールバックする設計のため、行が返る時点で常に
-- success=true になる(PostgreSQLの例外はRETURN QUERYより前で処理を中断させる)。
-- 失敗はsuccess=falseの行としてではなく、Postgresのエラー(supabase-jsの
-- {error})として呼び出し側に伝わる。success列は戻り値の形を呼び出し側の
-- 契約(interfaces.ts CreateStaffInput/Staff)に合わせて明示するために残して
-- いるが、値そのものは常にtrueである。
--
-- 本番適用: このセッションでは行っていない(SQL実行禁止・本番データ更新禁止・
-- migration適用禁止の指示のため)。適用にはユーザー側での実行が別途必要。
-- 前提: 20260717120000_staff_management_phase2_1_user_id_unique_guard.sql を
-- 先に適用しておくことを強く推奨する(本関数自体はUNIQUE制約が無くても動作は
-- するが、同一auth_uidの二重プロビジョニングに対する最終防衛線が働かなくなる)。
-- ================================================================

CREATE OR REPLACE FUNCTION public.provision_staff(
  p_auth_uid  uuid,
  p_name      text,
  p_store_id  uuid,
  p_role      text
)
RETURNS TABLE (
  success      boolean,
  staff_id     uuid,
  profile_id   uuid,
  store_id     uuid,
  name         text,
  style        text,
  is_active    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.brain_staff;
BEGIN
  IF p_auth_uid IS NULL OR p_name IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'provision_staff: p_auth_uid, p_name, p_store_id は必須です';
  END IF;

  IF p_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'provision_staff: invalid role "%" (expected owner or staff)', p_role;
  END IF;

  -- profiles: id は auth.users.id と同値(新規行のみを想定)。既に同idのprofilesが
  -- 存在する場合は上書きしない(ON CONFLICT DO NOTHING)。
  INSERT INTO public.profiles (id, role, staff_name, display_name)
  VALUES (p_auth_uid, p_role, p_name, p_name)
  ON CONFLICT (id) DO NOTHING;

  -- brain_staff: user_idのUNIQUE制約(適用済みなら)がここでの重複を最終防衛する。
  -- style は現時点でUIから選択させる設計が無いため既定値'evidence'を使う
  -- (brain_staff.style CHECK制約: evidence/theory/empathyのいずれか)。
  INSERT INTO public.brain_staff (user_id, name, store_id, style, is_active)
  VALUES (p_auth_uid, p_name, p_store_id, 'evidence', true)
  RETURNING * INTO v_staff;

  RETURN QUERY SELECT
    true            AS success,
    v_staff.id      AS staff_id,
    p_auth_uid      AS profile_id,
    v_staff.store_id,
    v_staff.name,
    v_staff.style,
    v_staff.is_active;
END;
$$;

COMMENT ON FUNCTION public.provision_staff(uuid, text, uuid, text) IS
  '招待経由の新規スタッフ作成専用RPC(STAFF_MANAGEMENT_PHASE2_1)。profiles+brain_staffを単一トランザクションで作成する。auth.usersの作成は呼び出し側が先にsupabase.auth.admin.createUser()で行う。StaffRepo.create()以外から直接呼ばないこと。';

-- 実行権限: service_role のみ(StaffRepo.create()はサーバー側APIからservice_role
-- クライアントで呼ばれる想定。requireAdmin等のアプリ側認可はAPI層で別途行う)。
REVOKE ALL ON FUNCTION public.provision_staff(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_staff(uuid, text, uuid, text) TO service_role;
