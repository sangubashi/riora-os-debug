import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import ClientShell from './ClientShell'
import QueryProvider from './QueryProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Riora',
  description: 'Salon Riora 接客サポート AI',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',  // safe-area を有効化するために必須
    title: 'Riora',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',   // env(safe-area-inset-*) を有効化
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* 明示的 viewport meta: viewportFit=cover で safe-area を確実に有効化 */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Noto+Sans+JP:wght@300;400;500&family=Noto+Serif+JP:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ background: '#EDE0E4' }}>
        <QueryProvider>
          <ClientShell>{children}</ClientShell>
        </QueryProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            style: { fontFamily: 'Noto Sans JP, sans-serif', fontSize: '13px' },
          }}
        />
      </body>
    </html>
  )
}
