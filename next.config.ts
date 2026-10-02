import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // 契約書PDF生成(/api/customers/[id]/contracts)が実行時に読む日本語フォントを
  // サーバーレス関数にバンドルする(fs.readFileSyncの動的パスはトレースされないため明示)。
  outputFileTracingIncludes: {
    '/api/customers/[id]/contracts': ['./src/lib/contracts/fonts/**/*'],
  },

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
          {
            key:   'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key:   'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
    ]
  },
}

export default nextConfig
