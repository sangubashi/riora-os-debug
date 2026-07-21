'use client'
/**
 * AdminSidebar.tsx — 管理者ダッシュボード共通サイドバー
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md
 * 「サイドバー: ダッシュボード/失客リスク管理/顧客管理/スタッフ分析/CSV Import Management」
 *
 * MD-1〜MD-4・MD-6の各画面コンポーネント自体には一切手を加えず、app/admin/layout.tsxから
 * 共通の入れ物としてこのサイドバーを被せるだけの統合作業(ユーザー指示・2026-06-23)。
 * モバイル(768px未満)はハンバーガーメニュー+ドロワー、デスクトップは固定サイドバー。
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TrendingUp, AlertTriangle, Users, UserCog, UserCheck, BarChart3, UploadCloud, Settings, Menu, X, MessageCircle, LayoutGrid, GitMerge } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/admin/dashboard',         label: '経営TOP',       icon: TrendingUp },
  { href: '/admin/churn-risk',        label: '失客リスク',     icon: AlertTriangle },
  { href: '/admin/customer-assets',   label: '顧客管理',       icon: Users },
  { href: '/admin/customer-merge',    label: '顧客統合',       icon: GitMerge },
  { href: '/admin/line',              label: 'LINE',          icon: MessageCircle },
  { href: '/admin/staff-analytics',   label: 'スタッフ分析',   icon: UserCog },
  { href: '/admin/staff-management',  label: 'スタッフ管理',   icon: UserCheck },
  { href: '/admin/occupancy',         label: '稼働率分析',     icon: BarChart3 },
  { href: '/admin/csv-import',        label: 'CSV Import',    icon: UploadCloud },
  { href: '/admin/menu-master',       label: 'メニュー管理',   icon: LayoutGrid },
  { href: '/admin/business-settings', label: '設定',           icon: Settings },
] as const

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px', borderRadius: '12px', textDecoration: 'none',
              fontSize: '13px', fontWeight: active ? 700 : 600,
              color: active ? '#D98292' : '#9F7E6C',
              background: active ? '#FDEEF1' : 'transparent',
              border: active ? '1px solid #F6D6DD' : '1px solid transparent',
            }}
          >
            <Icon size={16} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function AdminSidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* ── デスクトップ: 固定サイドバー(768px以上) ── */}
      <aside
        className="hidden md:flex"
        style={{
          flexDirection: 'column', width: '220px', flexShrink: 0,
          minHeight: '100vh', background: '#fff', borderRight: '1px solid #F5EEF0',
          padding: '20px 14px', position: 'sticky', top: 0,
        }}
      >
        <div style={{ padding: '0 10px', marginBottom: '20px' }}>
          <p style={{ fontSize: '9px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em' }}>SALON RIORA</p>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>管理者ダッシュボード</p>
        </div>
        <NavLinks pathname={pathname} />
      </aside>

      {/* ── モバイル: ハンバーガー+ドロワー(768px未満) ── */}
      <div className="flex md:hidden" style={{
        alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px',
        background: '#fff', borderBottom: '1px solid #F5EEF0', position: 'sticky', top: 0, zIndex: 40,
      }}>
        <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>管理者ダッシュボード</p>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="メニューを開く"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5C4033', display: 'flex' }}
        >
          <Menu size={22} />
        </button>
      </div>

      {mobileOpen && (
        <div
          className="md:hidden"
          style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 50 }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: '78%', maxWidth: '300px',
              background: '#fff', padding: '20px 14px', boxShadow: '4px 0 24px rgba(92,64,51,0.18)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', marginBottom: '20px' }}>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em' }}>SALON RIORA</p>
                <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>管理者ダッシュボード</p>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="メニューを閉じる"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9F7E6C', display: 'flex' }}
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
