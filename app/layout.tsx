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
    statusBarStyle: 'black-translucent',
    title: 'Riora',
    // 主要なiPhone画面サイズ向け起動画像(既存の /splash/splash-bg.png を機種別に書き出したもの)。
    // 一致する機種が無い場合はiOSがmanifestのicon+background_colorから簡易スプラッシュを自動生成する。
    startupImage: [
      { url: '/splash/apple-startup-750x1334.jpg', media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)' },
      { url: '/splash/apple-startup-1125x2436.jpg', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/apple-startup-828x1792.jpg', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)' },
      { url: '/splash/apple-startup-1170x2532.jpg', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/apple-startup-1179x2556.jpg', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/apple-startup-1284x2778.jpg', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/apple-startup-1290x2796.jpg', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)' },
    ],
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#F56E8B',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* Next.jsのappleWebApp.capableはmobile-web-app-capableのみ生成し、
            iOS Safariが依拠するapple-mobile-web-app-capableは生成しないため手動追加 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
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
