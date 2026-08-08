-- ================================================================
-- karte_imports: authenticated からの直接アクセスを禁止し service_role 限定にする
-- 設計・根拠: docs/security/KARTE_IMPORTS_RLS_SECURITY_AUDIT.md 案C
--
-- 背景:
--   20260807010000_karte_import.sql が作成した karte_imports は
--   RLS(USING(true)/WITH CHECK(true)) + GRANT(authenticated, service_role) の
--   組み合わせにより、ログイン済みスタッフであれば担当外の顧客の karte_imports
--   (Salon Boardカルテ原文・機微性が高い非構造化データ) を PostgREST 経由で
--   直接SELECT/INSERTできてしまう状態だった(監査§3で3方向から確認済み)。
--
--   正規のアプリ経路(commitKarteImportRepo.supabase.ts)は service_role の
--   Supabase クライアントのみを使用しており、karte_imports へブラウザから
--   直接クエリするコードはアプリ内に一切存在しない(監査§2で確認済み)ため、
--   authenticated への GRANT/RLS 許可は不要かつ唯一の実害あるリスクだった。
--
--   customer_notes / contraindications / voice_notes / customer_memories の
--   RLS/GRANTは今回のスコープ外であり一切変更しない
--   (監査§5: karte_importsのみ機微性が非対称に高く、直接アクセスの実利用も
--   ゼロのため、他テーブルとRLS方式を揃える必要はないと判断)。
--
-- 冪等性:
--   REVOKE は対象権限が既に無くても失敗しない(NOTICEのみ)。
--   GRANT/CREATE POLICYは元のIF EXISTS/置換パターンを踏襲しており、
--   本ファイルは複数回適用しても同じ最終状態に収束する。
-- ================================================================

-- 1. authenticated からのテーブルレベル権限を剥奪する
--    (PostgRESTはRLS評価より前にテーブルレベルGRANTを検査するため、
--    これだけでも authenticated からの直接アクセスは完全に遮断される)
REVOKE SELECT, INSERT ON TABLE public.karte_imports FROM authenticated;

-- 2. service_role の権限は維持する(念のため明示的に再GRANTし、状態を自己文書化する)
GRANT SELECT, INSERT ON TABLE public.karte_imports TO service_role;

-- 3. RLSポリシーも service_role 限定へ置き換える
--    (GRANT層だけで遮断は完結するが、RLS層に authenticated 向けの
--    「使われないpermissiveポリシー」を残すと、customer_memories監査で
--    指摘された「GRANTとRLSの2層が食い違ったまま放置される」構造的リスクの
--    温床になる。GRANT/RLSの対象ロールを一致させ、状態を単純に保つ)
DROP POLICY IF EXISTS "ki_select" ON public.karte_imports;
CREATE POLICY "ki_select" ON public.karte_imports
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "ki_insert" ON public.karte_imports;
CREATE POLICY "ki_insert" ON public.karte_imports
  FOR INSERT TO service_role WITH CHECK (true);

-- ================================================================
-- 適用後確認用SELECT（実行結果を目視確認してください）
-- ================================================================

-- 4a. テーブルレベルGRANT: authenticated には SELECT/INSERT どちらも残っていないこと、
--     service_role には両方残っていることを確認する
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'karte_imports'
  AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee, privilege_type;

-- 4b. RLSポリシー: ki_select/ki_insert がいずれも roles = {service_role} に
--     なっていること(authenticatedが含まれていないこと)を確認する
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'karte_imports'
ORDER BY policyname;

-- 4c. RLSが有効なままであることの確認(念のため)
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.karte_imports'::regclass;
