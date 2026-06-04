import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', '"Noto Sans JP"', 'sans-serif'],
        jp:      ['"Noto Sans JP"', 'sans-serif'],
        display: ['"Playfair Display"', 'serif'],
        inter:   ['Inter', 'sans-serif'],
      },
      colors: {
        // ─── UI指示書.PNG + ユーザー指定カラーコード ─────────────────
        salon: {
          // ページ・背景
          bg:           '#F8F1F3',  // ユーザー指定: ページ背景
          'bg-card':    '#FFFFFF',  // カード背景
          'bg-sub':     '#FDF7F8',  // セカンダリ背景
          'bg-input':   '#FFFFFF',  // 入力フィールド

          // ボーダー・区切り
          border:       '#F5E6E8',  // ユーザー指定: カード枠線・区切り
          'border-mid': '#EDD5D8',  // 少し濃い枠線
          'border-dark':'#DFC0C5',  // アクティブ枠線

          // ピンク系（アクセント）
          pink:         '#F5A0B5',  // メインアクセント
          'pink-mid':   '#F0879E',  // 強調ピンク
          'pink-light': '#FADADD',  // 薄ピンク
          'pink-pale':  '#FFF0F5',  // 極薄ピンク

          // ブラウン系（テキスト）
          brown:        '#4A2C2A',  // 主テキスト（ログイン画面.PNG準拠）
          'brown-mid':  '#7A5058',  // 中間ブラウン
          'brown-sub':  '#9E8090',  // サブテキスト
          'brown-light':'#C8A8B0',  // 最薄ブラウン

          // ゴールド（VIP）
          gold:         '#D4A96A',  // VIPバッジ
          'gold-bg':    '#FDF0DC',  // VIPバッジ背景
          'gold-light': '#F5E8C8',  // VIP薄

          // ステータス
          success:      '#52C87A',  // 成功・完了
          danger:       '#E84050',  // 失客リスク・警告
          warning:      '#F5A623',  // 注意
          info:         '#78A8D8',  // 情報
        },

        // 後方互換（既存コンポーネントが参照）
        riora: {
          bg:      '#F8F1F3',
          card:    '#FFFFFF',
          pink:    '#F5E6E8',
          accent:  '#F5A0B5',
          brown:   '#4A2C2A',
          sub:     '#9E8090',
          border:  '#F5E6E8',
          success: '#52C87A',
        },
      },

      boxShadow: {
        card:      '0 2px 12px rgba(245,160,181,0.10), 0 1px 4px rgba(74,44,42,0.04)',
        'card-md': '0 4px 20px rgba(245,160,181,0.14), 0 2px 8px rgba(74,44,42,0.06)',
        'card-lg': '0 8px 32px rgba(245,160,181,0.18), 0 4px 12px rgba(74,44,42,0.08)',
        sheet:     '0 -4px 32px rgba(245,160,181,0.16), 0 -2px 8px rgba(74,44,42,0.06)',
        btn:       '0 4px 14px rgba(245,160,181,0.40)',
        'btn-brown':'0 4px 14px rgba(74,44,42,0.30)',
        glass:     'inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 16px rgba(245,160,181,0.12)',
      },

      borderRadius: {
        '2.5xl': '1.25rem',  // 20px – カード標準
        '4xl':   '2rem',     // 32px – シート・モーダル
        '5xl':   '2.5rem',   // 40px
      },

      backgroundImage: {
        'salon-page':  'linear-gradient(160deg, #F8F1F3 0%, #FDF5F7 50%, #F8EFF0 100%)',
        'salon-card':  'linear-gradient(135deg, #FFFFFF 0%, #FDF8F9 100%)',
        'pink-btn':    'linear-gradient(135deg, #F5A0B5 0%, #F0879E 100%)',
        'brown-btn':   'linear-gradient(135deg, #5A3840 0%, #4A2C2A 100%)',
        'vip-badge':   'linear-gradient(135deg, #E8C88A 0%, #D4A96A 100%)',
        'bear-glow':   'radial-gradient(ellipse at center, rgba(245,160,181,0.15) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
}
export default config
