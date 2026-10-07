// vite.config.ts の serviceWorker プラグインがビルド時に値を埋めて dist/sw.js として書き出す
const CACHE = 'fuda-__VERSION__'
// 同梱フォントは版をまたいで中身が変わらないので、版ごとのキャッシュとは分けて残す
const FONT_CACHE = 'fuda-fonts'
const BASE = __BASE__
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  // フォント（約930ファイル・16MB）はここでは取り込まない。使った分だけ下の fetch で残す
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fuda-') && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// 新しい版はすぐには切り替えず、画面の「更新する」が押されたときに切り替える
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (url.pathname.endsWith('.woff2')) {
    // 一度使った書体は、電波がなくても使えるよう残しておく
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true })
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // 電波の弱い会場で待たされないよう、ネットより先にキャッシュを見る。
  // 中身はビルドごとに固定なので、サーバーの Vary は見ない
  const key = req.mode === 'navigate' ? BASE : req
  event.respondWith(caches.match(key, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(req)))
})
