-- ================================================================
-- 写真カルテ: brain_customer_photos.angle(正規化アングル)を追加
--
-- アングルの実体は既存の body_part(face_front/face_right/face_left/forehead)。
-- 別カラムを手書き運用すると body_part と食い違うため、body_part から導出される
-- 生成列(STORED)として追加する。body_part を更新(PATCH /api/customers/[id]/photos/[photoId])
-- すれば angle も自動で追従する。
--   'front' | 'right' | 'left' | 'forehead' | 'other'
-- レガシー値(face_left45/face_right45/cheek_left等)は新語彙へ再解釈せず 'other'
-- (src/lib/photos/bodyParts.ts の方針と同じ)。
--
-- アプリ(src/lib/photos/photoAngle.ts)は body_part から同じ規則で導出するため、
-- このカラムの有無に依存しない。SQL集計・将来のAPI絞り込み用。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

ALTER TABLE public.brain_customer_photos
  ADD COLUMN IF NOT EXISTS angle text GENERATED ALWAYS AS (
    CASE body_part
      WHEN 'face_front' THEN 'front'
      WHEN 'face_right' THEN 'right'
      WHEN 'face_left'  THEN 'left'
      WHEN 'forehead'   THEN 'forehead'
      ELSE 'other'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_customer_angle
  ON public.brain_customer_photos (customer_id, angle, taken_at DESC)
  WHERE deleted_at IS NULL;
