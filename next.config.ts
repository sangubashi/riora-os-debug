import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Vercel production: LAN IP は不要（dev 環境のみ）
  // Safari/iPhone の実機テスト用（npm run dev 時のみ有効）
  ...(process.env.NODE_ENV === 'development' && {
    allowedDevOrigins: [
      '192.168.11.12',
      '192.168.0.*',
      '192.168.1.*',
    ],
  }),

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Safari ITP 対応: cross-origin ポップアップ許可
          {
            key:   'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ]
  },
}

export default nextConfig
