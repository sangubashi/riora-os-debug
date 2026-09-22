-- brain_menus_hotpepper_sync_columns: Hot Pepper Beauty自動取込機能(2026-09-22ユーザー承認)向け列追加
--
-- 背景: 名称の完全一致だけに頼った差分判定は、サロン側がHot Pepper上でメニュー名を
-- 微修正するだけで「別メニュー」と誤認識されるリスクがある。技術検証の結果、Hot Pepperの
-- クーポン/メニューにはページ側で固有ID(couponId=CP..., menuId=MN...)が付与されている
-- ことを確認したため、これをbrain_menus側にも保持し、ID一致で堅牢に差分判定する。
--
-- hotpepper_item_id: "CP00000012652962"や"MN00000013602375"のような固有ID文字列
--   (プレフィックスでクーポン/メニューオプションの種別を兼ねるため、別途type列は設けない)。
--   手動登録したメニュー(Phase 1/1.5等)はNULLのまま(未追跡)。取込機能が名称完全一致で
--   後から紐付ける(バックフィル)ことを想定する。
-- hotpepper_synced_at: このメニューが直近でHot Pepper上に存在確認できた日時。
--   取込機能が「今回のHot Pepperページに存在しなかった既存メニュー」を検出する材料にする
--   (自動削除はしない。既存の凍結ルールに合わせ、検出のみに留める)。

ALTER TABLE public.brain_menus
  ADD COLUMN IF NOT EXISTS hotpepper_item_id text,
  ADD COLUMN IF NOT EXISTS hotpepper_synced_at timestamptz;

-- 同一店舗内でのID重複登録を防ぐ(NULLは対象外、複数のNULLを許容する部分ユニーク索引)。
CREATE UNIQUE INDEX IF NOT EXISTS ux_brain_menus_hotpepper_item_id
  ON public.brain_menus (store_id, hotpepper_item_id)
  WHERE hotpepper_item_id IS NOT NULL;
