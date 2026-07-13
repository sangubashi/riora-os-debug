-- AUTH-1 V2: voice_notes / customer_memories を Rule A'/B'/C へ統一する
-- 設計根拠: docs/SECURITY_AUTH_V2_DESIGN.md
-- 対象外（変更しない）: voice_notes_read / voice_notes_insert / voice_notes_update /
--                      voice_notes_delete / memory_service_role_write

-- 1. 共通関数: canAccessCustomer.ts (Rule A'/B'/C) のSQL移植
CREATE OR REPLACE FUNCTION auth1_v2_can_access_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    is_store_admin()
    OR EXISTS (
      -- Rule A': 直近来店(visit_date最新)の担当が自分
      SELECT 1 FROM brain_visits v
      WHERE v.customer_id = p_customer_id
        AND v.deleted_at IS NULL
        AND v.staff_id = current_brain_staff_id()
      ORDER BY v.visit_date DESC LIMIT 1
    )
    OR EXISTS (
      -- Rule B': 本日の予約担当(reservations.staff_id は auth.users.id 空間のため
      --          brain_staff.user_id 経由で変換してから比較。canAccessCustomer.tsと同一ロジック)
      SELECT 1 FROM reservations r
      JOIN brain_staff bs ON bs.id = current_brain_staff_id()
      WHERE r.brain_customer_id = p_customer_id
        AND r.staff_id = bs.user_id
        AND r.scheduled_at::date = CURRENT_DATE
        AND r.status <> 'cancelled'
    )
    OR (
      -- Rule C: 来店履歴も本日予約も無い → 店舗共有
      NOT EXISTS (SELECT 1 FROM brain_visits v WHERE v.customer_id = p_customer_id AND v.deleted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.brain_customer_id = p_customer_id
          AND r.scheduled_at::date = CURRENT_DATE AND r.status <> 'cancelled'
      )
    )
$$;

COMMENT ON FUNCTION auth1_v2_can_access_customer(uuid) IS
  'AUTH-1 V2 Rule A''/B''/C の共通判定関数。src/lib/auth/canAccessCustomer.ts と同一ロジック。voice_notes / customer_memories のRLSポリシーから呼び出す。';

-- 2. customer_memories: SELECTポリシーをRule A'/B'/Cへ置換
DROP POLICY IF EXISTS memory_access_by_customer_rule ON customer_memories;
CREATE POLICY memory_access_by_customer_rule ON customer_memories FOR SELECT
  USING (
    store_id = '00000000-0000-0000-0000-000000000001'
    AND auth1_v2_can_access_customer(customer_id)
  );

-- 3. customer_memories: authenticated への SELECT GRANT を追加
GRANT SELECT ON customer_memories TO authenticated;

-- 4. voice_notes: SELECTポリシーをRule A'/B'/Cへ置換(他4ポリシーは変更しない)
DROP POLICY IF EXISTS voice_access_by_customer_rule ON voice_notes;
CREATE POLICY voice_access_by_customer_rule ON voice_notes FOR SELECT
  USING (auth1_v2_can_access_customer(customer_id));
