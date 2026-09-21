// Service worker mínimo — só existe para o app ser reconhecido como instalável.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {});
