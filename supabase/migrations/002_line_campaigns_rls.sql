-- Enable row-level security for line_campaigns and allow authenticated session access
ALTER TABLE public.line_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_line_campaigns"
  ON public.line_campaigns
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_insert_line_campaigns"
  ON public.line_campaigns
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated_update_line_campaigns"
  ON public.line_campaigns
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated_delete_line_campaigns"
  ON public.line_campaigns
  FOR DELETE
  USING (auth.role() = 'authenticated');
