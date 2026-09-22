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
      <img src={FACIAL_SCHEMA_TEMPLATE_SRC} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      <canvas ref={canvasElRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
