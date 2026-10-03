const CACHE = 'riora-shell-v2';
// /phase1: スマホ用Riora、/karte: iPad用Rioraカルテ(別PWA)。どちらもアプリの外枠(HTML)とアイコンのみ。
// 写真・API・Supabaseのデータはキャッシュしない(下のfetchでは画面遷移のみを扱う)。
const SHELL = [
  '/phase1', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/karte', '/karte.webmanifest', '/icons/karte-icon-192.png', '/icons/karte-icon-512.png', '/icons/karte-apple-touch-icon.png',
];

// 画面遷移がネットワーク失敗したときの戻り先: /karte系は/karte、それ以外は従来どおり/phase1
function fallbackPath(url) {
  const p = new URL(url).pathname;
  return p === '/karte' || p.startsWith('/karte/') ? '/karte' : '/phase1';
}

self.addEventListener('install', e => {
  // 1件の取得失敗でインストール全体が失敗しないよう、1件ずつ追加する(失敗した分は無視)
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  // API / Supabase / LINE は常にネットワーク優先
  if (request.url.includes('/api/') || request.url.includes('supabase.co')) return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match(fallbackPath(request.url)).then(r => r || caches.match('/phase1'))
      )
    );
  }
});
