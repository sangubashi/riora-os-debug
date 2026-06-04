'use client'
import { motion } from 'framer-motion'

export default function SplashScreen() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'stretch',
        background: '#F4DDE0',
        // Safari 100vh 問題: fixed + inset:0 で対応済み（height 不要）
      }}
    >
      {/* 430px 電話フレーム */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '430px',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* ── 背景画像：スプラッシュ画面.png ── */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/splash/splash-bg.png"
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
        />

        {/* ── ローディングドット（画像の下部に重ねる）── */}
        <div
          style={{
            position: 'absolute',
            bottom: 'max(72px, calc(env(safe-area-inset-bottom) + 56px))',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          {[0, 0.18, 0.36].map((delay, i) => (
            <motion.div
              key={i}
              animate={{ scale: [0.7, 1.15, 0.7], opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.2, delay, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#D98292',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
