'use client'
/**
 * /karte/[customerId] — iPad専用カルテ、顧客選択後の画面(PHASE IPAD-KARTE-ENTRY-1・
 * 2026-09-20ユーザー承認)。薄いラッパーのみ、本体はKarteCustomerSwitcher.tsx。
 */
import { useParams } from 'next/navigation'
import KarteCustomerSwitcher from '@/components/karte/KarteCustomerSwitcher'

export default function KarteCustomerPage() {
  const params = useParams<{ customerId: string }>()
  return <KarteCustomerSwitcher customerId={params.customerId} />
}
