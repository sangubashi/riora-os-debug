'use client'
/**
 * FacialSchemaViewer.tsx — お客様モード用「顔シェーマ」閲覧セクション(Phase 6)。
 *
 * CustomerModeView.tsx下部のCardスタック(「過去の写真」「来店履歴」と同じ並び)に配置する
 * 自己完結セクション。CustomerModeView.tsxの設計方針(スタッフ専用モジュールを一切importせず、
 * customerIdのみを受け取り自前でfetchする)に従い、GET /api/customers/[id]/facial-schemas を
 * 直接呼ぶ(customerModeData.tsやCustomerBottomSheet経由のデータには依存しない)。
 *
 * 誤操作防止のため完全に読み取り専用(pointerハンドラ・編集UIを一切持たない)。
 * 描画は共有部品(FacialSchemaThumbnail、src/components/customer/shared/FacialSchemaKit.tsx)を
 * スタッフ編集画面(FacialSchemaSection.tsx)とそのまま共用し、見た目が2画面で食い違わないようにする。
 */
import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import { FacialSchemaLegend, FacialSchemaThumbnail } from '@/components/customer/shared/FacialSchemaKit'
import { sortRecordsDesc } from '@/lib/facialSchema/facialSchemaSelection'
import type { FacialSchemaApiShape } from '@/lib/facialSchema/facialSchemaApiMapping'

interface Props {
  customerId: string
}

interface FacialSchemasApiResponse {
  success: boolean
  schemas?: FacialSchemaApiShape[]
}

function formatDateOnly(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function FacialSchemaViewer({ customerId }: Props) {
  const [schemas, setSchemas] = useState<FacialSchemaApiShape[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/facial-schemas`)
        if (res.ok) {
          const json = await res.json() as FacialSchemasApiResponse
          if (!cancelled) setSchemas(json.schemas ?? [])
        }
      } catch {
        /* 取得失敗時は「記録がありません」相当の表示のまま(致命的にしない) */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  if (loading) return null // 読み込み中はカード自体を出さない(他カードと同じ「準備できてから表示」方針)
  if (schemas.length === 0) return null // 記録が無い顧客にはカード自体を出さない(過去の写真/来店履歴と同じ方針)

  const sorted = sortRecordsDesc(schemas)
  const latest = sorted[0]
  const previous = sorted[1] ?? null

  return (
    <Card title="顔シェーマ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <FacialSchemaLegend />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: previous ? '1fr 1fr' : '1fr',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: PALETTE.gold }}>
              今回({formatDateOnly(latest.schemaDate)})
            </p>
            <FacialSchemaThumbnail strokesData={latest.strokesData} />
          </div>

          {previous && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: PALETTE.muted }}>
                前回({formatDateOnly(previous.schemaDate)})
              </p>
              <FacialSchemaThumbnail strokesData={previous.strokesData} />
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
