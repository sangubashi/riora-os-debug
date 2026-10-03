import type { Metadata } from 'next'

/**
 * /karte 配下専用のPWA設定(2026-10-03)。
 *
 * スマホ用「Riora」(ルートlayout・/manifest.json・id=/phase1)とは別のPWAとして
 * ホーム画面に追加できるよう、/karte配下でだけ manifest・アプリ名・アイコンを上書きする。
 * 親layout(app/layout.tsx)の他の設定(viewport・meta等)はそのまま継承する。
 * metadataは子が指定したキー単位で親を置き換えるため、appleWebApp / icons は
 * このファイルで必要な値を全て指定している。
 */
export const metadata: Metadata = {
  manifest: '/karte.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Rioraカルテ',
  },
  icons: {
    icon: '/icons/karte-icon-192.png',
    apple: '/icons/karte-apple-touch-icon.png',
  },
}

export default function KarteLayout({ children }: { children: React.ReactNode }) {
  return children
}
