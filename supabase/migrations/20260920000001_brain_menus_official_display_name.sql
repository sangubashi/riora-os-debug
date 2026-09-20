-- ================================================================
-- 2026-09-20: PHASE MENU-DISPLAY-NAME-1 — brain_menus に表示専用の
-- 正式名称列(official_display_name)を追加。
--
-- 背景: brain_menus.nameは2026-06-12の初期seed投入時につけられた内部作業名
-- (例:「ヒト幹15000」)のままカルテ画面(「今回の施術」「来店履歴」)に表示され、
-- ホットペッパービューティー掲載の正式クーポン名(例:「【人気NO.1！】ヒト幹細胞
-- ベーシックコース」)と一致していなかった。
--
-- nameを直接書き換えない理由: src/lib/import/menuResolver.tsが今後のCSV再取込時、
-- SalonBoardメニュー名をnameに対してキーワード一致で突合する。nameを正式名称へ
-- 書き換えると将来の取込でこの行にマッチしなくなり、同じメニューの行が重複作成
-- されるリスクがある。表示専用の別列を追加し、nameはCSV突合の土台として維持する。
--
-- 表示側は official_display_name ?? name を使う
-- (app/api/customers/[id]/visit-history/route.ts、2026-09-20ユーザー承認)。
-- ================================================================

ALTER TABLE public.brain_menus
  ADD COLUMN IF NOT EXISTS official_display_name text;

COMMENT ON COLUMN public.brain_menus.official_display_name IS
  '表示専用の正式名称(ホットペッパービューティー掲載クーポン名等)。nameは'
  'CSV取込メニュー名突合(menuResolver.ts)に使われるため変更しない。表示側は'
  'official_display_name ?? name を使う(2026-09-20ユーザー承認)。';

-- ◎ほぼ確実と判断した4件のみ設定(2026-09-20ユーザー承認)。
-- 水素+ヒト幹18000・フェイシャルエステ60分等、対応する正式クーポン名が
-- 確認できなかったものはofficial_display_name未設定のまま(nameへフォールバック)。

UPDATE public.brain_menus SET official_display_name = '【人気NO.1！】ヒト幹細胞ベーシックコース'
  WHERE id = '00000000-0000-0000-0000-000000000201'; -- ヒト幹15000

UPDATE public.brain_menus SET official_display_name = '毛穴ごっそり★脱いちご鼻！毛穴洗浄＆ヒト幹細胞導入'
  WHERE id = '00000000-0000-0000-0000-000000000202'; -- 毛穴洗浄+ヒト幹19000

UPDATE public.brain_menus SET official_display_name = '【ツルピカ】お試しハーブピーリング★角質除去&剥離なし'
  WHERE id = '00000000-0000-0000-0000-000000000204'; -- ハーブピーリング9900

UPDATE public.brain_menus SET official_display_name = '【小顔・リフトアップ】EMS＆マッサージ&ヒト幹フェイシャル'
  WHERE id = '00000000-0000-0000-0000-000000000205'; -- EMS+小顔19000
