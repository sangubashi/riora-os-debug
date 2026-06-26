# customers テーブル PII公開問題 — 修正案（提案のみ・未適用）

- 作成日: 2026-06-19
- 位置づけ: **CSV Import設計とは別タスク**。本書は修正案の提示のみ。ALTER/CREATE POLICY/DROP POLICY/GRANT/REVOKEの実行は行わない。
- 関連: `docs/DB_AUDIT_REPORT.md` §4（問題の初回確認）

---

## 1. 問題の再確認

- `anon`公開キーで`customers`テーブルに`SELECT`すると、`service_role`と同じ**30件全件**が取得できる（実環境で確認済み）。
- 同条件で`reservations`/`profiles`/`customers_pii`/`customers_secure`は`42501 permission denied`を返す。`customers`だけが例外的に開いている。
- リポジトリ内の`customers`関連RLS/GRANT定義を全履歴調査した結果（7ファイル: `setup.sql`, `001_schema.sql`, `005_rls_roles_grants.sql`等）、**いずれのファイルもanonへのアクセスを許可する記述を含まない**。つまりファイル履行と本番の実挙動が矛盾している＝本番側で意図せぬ状態（RLS無効化 or ダッシュボード経由の手動変更等）が発生している可能性が高い。

## 2. 推定原因（確認できる範囲）

PostgRESTでは「テーブル権限（GRANT）チェック → RLSポリシー評価」の順で処理される。`42501`が出ている他テーブルは「GRANTが無い」ことが直接の原因と確定できるが、`customers`が`anon`で全件読めるという挙動は、考えられる原因が複数あり、現時点ではpg_catalogへの直接アクセス（Supabase MCP認証は今回中止）がないため一意に確定できない。可能性として:

1. `customers`テーブルの`ROW LEVEL SECURITY`が（手動操作等により）無効化されている、かつ`anon`に対する`GRANT SELECT`が何らかの経緯で存在する
2. RLSは有効だが、`anon`でも`USING (true)`相当になる緩いポリシーが本番にだけ存在する（ファイル履行に存在しない、本番限定の変更）

いずれの場合も、**もしRLSが実際に無効化されているなら、anonだけでなくauthenticated（スタッフ）も意図した行範囲（`assigned_staff_id = auth.uid()`等）を超えて全顧客を見えてしまっている可能性がある**。これは外部公開漏洩より一段深刻な、内部の閲覧範囲制御自体の破綻であり、今回確認したanon経由の漏洩はその症状の一部に過ぎない可能性がある点に注意。

## 3. 修正案（3パターン）

### パターン1: 即時最小修正（anonのGRANTのみ剥奪）

```sql
REVOKE ALL ON customers FROM anon;
```

- **効果**: 公開漏洩（anon全件取得）を即座に止める。GRANT層でブロックされるため、RLSの状態に関わらず確実に効く。
- **リスク/限界**: authenticated側（スタッフ）の閲覧範囲が実際に正しく制限されているかは別問題として残る。§2のとおりRLS自体が無効化されている場合、スタッフが担当外顧客を見られる問題は本パターンでは解決しない。
- **適用コスト**: 最小。既存の正常な動作（owner/staffのcustomers利用）に影響しない見込みが高い（service_role経由のサーバーサイド処理やauthenticated経由の通常利用には無関係）。

### パターン2: RLS全面再構築（正本ポリシーの一本化）

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

-- 既存の重複/競合ポリシーを一度クリーンアップ（実際の本番ポリシー名は
-- 事前にSQL Editorで pg_policies を確認してから個別にDROPする）
-- DROP POLICY IF EXISTS "..." ON customers;

REVOKE ALL ON customers FROM anon;

CREATE POLICY "customers_owner_all" ON customers
  FOR ALL
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "customers_staff_assigned_select" ON customers
  FOR SELECT
  USING (assigned_staff_id = auth.uid());
```

- **効果**: ファイル履歴に散在する7世代分のポリシーを一本化し、本番の実態を正本に揃える。RLS無効化が真因だった場合、この対応で根本解決する。
- **リスク**: 本番に存在する実際のポリシー一覧（`pg_policies`）を事前に確認しないまま`DROP POLICY IF EXISTS`を組み立てると、ファイル履行に無い未知のポリシーを見落とす恐れがある。現時点ではpg_catalogへの直接アクセス手段がない（MCP認証は中止済み）ため、適用前にSupabase Dashboard（SQL Editor）で`SELECT * FROM pg_policies WHERE tablename = 'customers';`を実行し、実際の現状を確認する工程が必須。
- **適用コスト**: 中〜大。事前確認＋一本化の設計レビューが必要。

### パターン3: 段階的対応（推奨）

1. **直ちに**パターン1（`REVOKE ALL ON customers FROM anon;`）を適用し、公開漏洩を即時に塞ぐ。
2. **別タスクとして**パターン2（RLS全面再構築）を、事前のpg_policies確認工程を含めて後日実施する。authenticated側の閲覧範囲が実際に機能しているかどうかの検証もこのタスクに含める。

- **理由**: 公開漏洩という最も影響度の高いリスクをまず止め、根本原因の特定・再構築は本番ポリシーの実態確認という前提作業を伴うため、拙速に一括対応するより安全。

## 4. CSV Importタスクとの関係

本問題は`customers`テーブルのアクセス制御の問題であり、CSV取込機能（`staff_name_aliases`/`import_logs`/`reservations.source`等の新設）とは独立した既存不具合である。CSV Import側のmigrationの適用順序や内容に依存しないため、**両タスクは並行して進めて構わない**（CSV Import側のmigration適用を本問題の修正完了まで待つ必要はない）。

## 5. 次のアクション（本書では未実施）

- [ ] パターン1〜3のどれを採用するか、ユーザー判断を確定する
- [ ] パターン2/3を選ぶ場合、Supabase Dashboard SQL Editorで`pg_policies`の現況確認を先行実施する
- [ ] 上記確定後、別途migrationファイルを作成し、本書とは別レビューを経て適用する
