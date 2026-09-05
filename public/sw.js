// 서비스 워커: 오프라인 캐시(최소) + 웹푸시 수신 + 알림 클릭 처리
const CACHE = 'amr-alarm-v2';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시 (API는 항상 네트워크)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;         // API는 캐시하지 않음
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// 푸시 수신 → 알림 표시
self.addEventListener('push', (e) => {
  let data = { title: 'AMR 알람', body: '', url: '/' };
  try { data = { ...data, ...e.data.json() }; } catch { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    ...(data.sound === false ? { silent: true } : {}),
    ...(data.vibrate === false ? {} : { vibrate: [120, 60, 120] }),
    data: { url: data.url || '/' }
  }));
});

// 알림 클릭 → 앱 열기/포커스
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    return clients.openWindow(target);
  }));
});
