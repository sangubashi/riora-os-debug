'use client'
import { createContext, useContext, useState } from 'react'
import type { CustomerProfile } from '@/types'

type Ctx = {
  customer: CustomerProfile | null
  open:  (c: CustomerProfile) => void
  close: () => void
}

const CustomerSheetContext = createContext<Ctx | null>(null)

export function CustomerSheetProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null)
  return (
    <CustomerSheetContext.Provider value={{ customer, open: setCustomer, close: () => setCustomer(null) }}>
      {children}
    </CustomerSheetContext.Provider>
  )
}

export function useCustomerSheet() {
  const ctx = useContext(CustomerSheetContext)
  if (!ctx) throw new Error('useCustomerSheet must be inside CustomerSheetProvider')
  return ctx
}
