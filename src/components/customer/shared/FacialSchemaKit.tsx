'use client'
/**
 * FacialSchemaKit.tsx — 顔シェーマ機能の共有UI部品(Phase 5)。
 *
 * PhotoCompareKit.tsxと同じ「スタッフ編集画面(Phase 5)・お客様閲覧画面(Phase 6)の
 * 両方から使う部品を1箇所にまとめる」方針。テンプレート画像の配置・凡例表示は
 * 見た目が2画面で食い違わないよう、必ずこのモジュール経由で行う。
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { PALETTE, headingFont } from './PhotoCompareKit'
import { renderStrokes } from '@/lib/facialSchema/canvasRenderer'
import type { StrokesData } from '@/lib/facialSchema/strokeModel'

/** テンプレート画像(正面、IMG_1381.JPG由来)。public/mediapipe/と同じ「自前ホスティング」方針。 */
export const FACIAL_SCHEMA_TEMPLATE_SRC = '/facial-schema/face-front.jpg'
/** テンプレート画像の実寸(784×1168px)に基づくaspect-ratio。表示サイズが変わっても縦横比を保つ。 */
export const FACIAL_SCHEMA_TEMPLATE_ASPECT_RATIO = '784 / 1168'

/**
 * テンプレート画像の表示スケール(2026-09-22ユーザー要望: 顔の周りに書き込み余白を
 * 作るため、イラスト自体をひとまわり小さく表示する)。canvas(描画レイヤー・
 * ストローク座標の正規化基準となるbox)は従来通りコンテナ全面(inset:0)のまま一切
 * 変更しない — 顔画像の見た目のみを縮小し、書き込み可能領域(余白部分を含む)は
 * コンテナ全体のまま変わらない。編集画面(FacialSchemaSection.tsx)・お客様/前回
 * 閲覧(FacialSchemaThumbnail、以下)の両方でこの同じスタイルを使い、顔の見た目の
 * 縮尺が2画面で食い違わないようにする(左右上下均等に余白ができるよう、top/left/
 * width/heightをすべて同じ%にする。コンテナのaspect-ratioがテンプレート画像自身の
 * 比率と一致しているため、縦横均等に縮小しても画像の縦横比は保たれる)。
 */
const FACIAL_SCHEMA_TEMPLATE_MARGIN_PERCENT = 12
export const facialSchemaTemplateImgStyle: React.CSSProperties = {
  position: 'absolute',
  top: `${FACIAL_SCHEMA_TEMPLATE_MARGIN_PERCENT}%`,
  left: `${FACIAL_SCHEMA_TEMPLATE_MARGIN_PERCENT}%`,
  width: `${100 - FACIAL_SCHEMA_TEMPLATE_MARGIN_PERCENT * 2}%`,
  height: `${100 - FACIAL_SCHEMA_TEMPLATE_MARGIN_PERCENT * 2}%`,
  objectFit: 'contain',
  pointerEvents: 'none',
  userSelect: 'none',
}

/** セクション見出し(Cardタイトルより小さい、サブ見出し用)。 */
export function FacialSchemaSubHeading({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: PALETTE.muted, fontFamily: headingFont.style.fontFamily }}>
      {children}
    </p>
  )
}

/**
 * 読み取り専用(静止画)の顔シェーマ表示。テンプレート画像+確定済みストロークのみを描画し、
 * pointerハンドラは一切持たない(スタッフ編集画面の「前回のシェーマ」プレビュー・
 * お客様モードの閲覧の両方から使う。見た目が2画面で食い違わないよう共通化している)。
 */
export function FacialSchemaThumbnail({ strokesData }: { strokesData: StrokesData }) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const el = canvasElRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const dpr = window.devicePixelRatio || 1
      el.width  = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      renderStrokes(ctx, strokesData.strokes, { width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [strokesData])

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: FACIAL_SCHEMA_TEMPLATE_ASPECT_RATIO, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${PALETTE.border}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 固定テンプレート静止画のためnext/imageの最適化は不要 */}
      <img src={FACIAL_SCHEMA_TEMPLATE_SRC} alt="" style={facialSchemaTemplateImgStyle} />
      <canvas ref={canvasElRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
