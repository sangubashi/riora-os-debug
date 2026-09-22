-- menu_master_subscription_ticket_sync: サブスク・回数券メニュー(Cグループ)の正式登録
--
-- 背景: 2026-09-22ユーザー承認(Phase 1.5)。docs/MENU_SUBSCRIPTION_TICKET_HEARING_LIST_2026-09-22.md
-- のCグループ(実際の契約金額がCSV上で安定して確認できる8種)について、ユーザー判断により
-- 「ヒアリング不要、CSVの実際の契約価格・名称をそのまま正として扱う」との明示指示を受け、
-- brain_menusへ正式登録する。
--
-- role/target_types方針(ユーザー承認・例示どおり):
--   - 「ヒト幹細胞ベーシック」「選べる肌改善コース」「肌改善ベーシックコース」系(内容が
--     都度選択/汎用的)は role='entry' + target_types=全5タイプ(Phase 1と同じノイズ防止方針)。
--   - 「ハーブピーリング＋ヒト幹細胞コース」はrole='peeling'+[A_acne](Phase 1の
--     「ハーブピーリング&幹細胞導入」と同じ分類)。
--   - 「造顔＋小顔＋ヒト幹細胞」はrole='lifting'+[D_aging](Phase 1の「造顔マッサージ」
--     「小顔リフトアップ」と同じ分類)。
--   - 「ハイドラ×ヒト幹細胞」はrole='pore'+[B_pore](Phase 1の「ハイドラフェイシャル」と
--     同じ分類)。
--
-- 2件は既にrole='imported_other'(CSV未マッチのフォールバック行)として存在していたため、
-- 新規行を追加せず、既存行(id指定)のrole/price/target_typesを更新して正式メニューへ
-- 昇格させる(名称重複を避けるため)。この2件は来店データのmenu_id自体は変更不要
-- (同一idのまま役割のみ変わるため、reclassify-menus実行前から既に分類対象になる)。

-- ─────────────────────────────────────────────────────────────
-- 1. 既存imported_other行2件を正式メニューへ昇格(UPDATE、id指定で安全に特定)
-- ─────────────────────────────────────────────────────────────

UPDATE public.brain_menus
   SET role = 'entry', price = 16000, target_types = ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']
 WHERE id = 'e642e635-977d-4e31-8c7a-321285e2abb6'
   AND name = '【サブスク契約】選べる肌改善コース 月1回' AND role = 'imported_other';

UPDATE public.brain_menus
   SET role = 'entry', price = 42000, target_types = ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']
 WHERE id = '0945533f-dc4b-432c-b248-a1c3a86ab3ad'
   AND name = '肌改善ベーシックコース回数券3回' AND role = 'imported_other';

-- ─────────────────────────────────────────────────────────────
-- 2. 新規6行のINSERT
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.brain_menus (store_id, name, price, role, target_types) VALUES
  ('00000000-0000-0000-0000-000000000001', '【回数券契約】ヒト幹細胞ベーシック 3回', 42000, 'entry', ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '【サブスク契約】ヒト幹細胞ベーシック 月1回', 13000, 'entry', ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '【サブスク契約】ヒト幹細胞ベーシック 月2回', 26000, 'entry', ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '【サブスク契約】ハーブピーリング＋ヒト幹細胞コース 月1回', 17000, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', '【サブスク契約】造顔＋小顔＋ヒト幹細胞 月1回', 21000, 'lifting', ARRAY['D_aging']),
  ('00000000-0000-0000-0000-000000000001', '【回数券契約】ハイドラ×ヒト幹細胞 3回', 49900, 'pore', ARRAY['B_pore']);
