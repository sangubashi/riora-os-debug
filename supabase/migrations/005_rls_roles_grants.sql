-- ============================================================
-- Migration: RLS / role separation / authenticated grants
-- May 30 Supabase public schema default non-public 化対応
-- ============================================================

-- Prepare future schema separation
CREATE SCHEMA IF NOT EXISTS admin_only;
CREATE SCHEMA IF NOT EXISTS ai_internal;

-- Helper functions for staff / admin binding
CREATE OR REPLACE FUNCTION public.riora_current_staff_id()
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT staff_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.riora_is_manager_or_owner()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('manager', 'owner')
  )
$$;

CREATE OR REPLACE FUNCTION public.riora_staff_has_customer(customer_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reservations
    WHERE customer_id = customer_uuid
      AND staff_id = public.riora_current_staff_id()
  )
$$;

-- AI-internal tag storage
CREATE TABLE IF NOT EXISTS ai_internal.ai_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS ai_tags_updated_at ON ai_internal.ai_tags;
CREATE TRIGGER ai_tags_updated_at
  BEFORE UPDATE ON ai_internal.ai_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION ai_internal.insert_ai_tag(
  tag_name TEXT,
  tag_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF ai_internal.ai_tags
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO ai_internal.ai_tags (name, metadata, created_by)
  VALUES (tag_name, tag_metadata, auth.uid())
  RETURNING *;
END;
$$;

-- Enable RLS on all core tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers_pii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers_secure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_internal.ai_tags ENABLE ROW LEVEL SECURITY;

-- Clean up old policies before redefining secure access patterns
DROP POLICY IF EXISTS "authenticated_read_customers" ON public.customers;
DROP POLICY IF EXISTS "manager_owner_write_customers" ON public.customers;
DROP POLICY IF EXISTS "staff_own_reservations" ON public.reservations;
DROP POLICY IF EXISTS "manager_owner_read_all_reservations" ON public.reservations;
DROP POLICY IF EXISTS "manager_owner_read_line_logs" ON public.line_logs;
DROP POLICY IF EXISTS "manager_owner_read_staff_logs" ON public.staff_logs;
DROP POLICY IF EXISTS "authenticated_read_ai_suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "staff_own_write_suggestions" ON public.ai_suggestions;

-- customers: staff see only customers they are assigned via reservations; manager/owner see all
CREATE POLICY "authenticated_select_customers" ON public.customers
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      public.riora_is_manager_or_owner()
      OR public.riora_staff_has_customer(id)
    )
  );

CREATE POLICY "manager_owner_modify_customers" ON public.customers
  FOR ALL
  USING (public.riora_is_manager_or_owner())
  WITH CHECK (public.riora_is_manager_or_owner());

-- reservations: staff access own reservations, manager/owner access all
CREATE POLICY "staff_or_admin_reservations" ON public.reservations
  FOR ALL
  USING (
    auth.role() = 'authenticated'
    AND (
      public.riora_is_manager_or_owner()
      OR staff_id = public.riora_current_staff_id()
    )
  )
  WITH CHECK (
    public.riora_is_manager_or_owner()
    OR staff_id = public.riora_current_staff_id()
  );

-- line_logs: manager/owner can read all; staff can read logs for customers they serve
CREATE POLICY "authorized_select_line_logs" ON public.line_logs
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      public.riora_is_manager_or_owner()
      OR EXISTS (
        SELECT 1 FROM public.reservations
        WHERE (
          reservations.customer_id = public.line_logs.customer_id
          OR (
            public.line_logs.customer_hash_id IS NOT NULL
            AND reservations.customer_hash_id = public.line_logs.customer_hash_id
          )
        )
          AND reservations.staff_id = public.riora_current_staff_id()
      )
    )
  );

CREATE POLICY "manager_owner_modify_line_logs" ON public.line_logs
  FOR ALL
  USING (public.riora_is_manager_or_owner())
  WITH CHECK (public.riora_is_manager_or_owner());

-- profiles: allow users to read their own profile, manager/owner can manage profiles
CREATE POLICY "authenticated_select_own_profile" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "manager_owner_modify_profiles" ON public.profiles
  FOR ALL
  USING (public.riora_is_manager_or_owner())
  WITH CHECK (public.riora_is_manager_or_owner());

-- line_users: restrict to admin users only
DROP POLICY IF EXISTS "manager_owner_access_line_users" ON public.line_users;
CREATE POLICY "manager_owner_access_line_users" ON public.line_users
  FOR ALL
  USING (public.riora_is_manager_or_owner())
  WITH CHECK (public.riora_is_manager_or_owner());

-- ai_suggestions: preserve existing admin / staff behavior
DROP POLICY IF EXISTS "authenticated_read_ai_suggestions" ON public.ai_suggestions;
CREATE POLICY "authenticated_read_ai_suggestions" ON public.ai_suggestions
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "staff_own_write_suggestions" ON public.ai_suggestions;
CREATE POLICY "staff_own_write_suggestions" ON public.ai_suggestions
  FOR INSERT
  WITH CHECK (
    staff_id = (SELECT staff_id FROM public.profiles WHERE id = auth.uid())
    OR staff_id = 'system_analysis'
  );

-- ai_internal.ai_tags: AI edge functions use a dedicated insert function,
-- authenticated users may read tags via RLS but cannot write directly.
CREATE POLICY "authenticated_select_ai_tags" ON ai_internal.ai_tags
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Grant required schema and table access for authenticated sessions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA ai_internal TO authenticated;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.reservations TO authenticated;
GRANT ALL ON TABLE public.line_logs TO authenticated;
GRANT ALL ON TABLE public.line_campaigns TO authenticated;
GRANT ALL ON TABLE public.line_users TO authenticated;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.ai_suggestions TO authenticated;
GRANT SELECT ON TABLE ai_internal.ai_tags TO authenticated;
GRANT EXECUTE ON FUNCTION ai_internal.insert_ai_tag(TEXT, JSONB) TO authenticated;
