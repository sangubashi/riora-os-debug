'use client';

export default function SplashIntroScreen() {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100dvh',
      backgroundColor: '#F7E7E7',
      zIndex: 9999,
    }}>
      <img
        src="/riora-os/wallpaper.png"
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#F7E7E7' }}
      />
    </div>
  );
}
