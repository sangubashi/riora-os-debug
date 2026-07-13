/**
 * app/admin/layout.tsx — 管理者ダッシュボード共通レイアウト
 *
 * MD-1(経営TOP)〜MD-4(スタッフ分析)・MD-6(CSV Import Management)を束ねる
 * 共通の入れ物(サイドバー+コンテンツ領域)。各画面コンポーネント自体のロジック・
 * スタイルには一切手を加えない(統合作業のみ・ユーザー指示2026-06-23)。
 */
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminAuthGuard from '@/components/admin/AdminAuthGuard'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGuard>
      <div className="flex flex-col md:flex-row" style={{ minHeight: '100vh', background: '#EDE0E4' }}>
        <AdminSidebar />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </AdminAuthGuard>
  )
}
