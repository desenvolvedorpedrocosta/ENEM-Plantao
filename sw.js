
const CACHE_NAME = 'enem-plantao-static-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './Logo-ENEM-Plantao-2026.svg'
];

// Instalação: armazena os arquivos essenciais da aplicação.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ativação: remove versões antigas do cache e assume o controle das páginas.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Interceptação das requisições.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Não interfere em requisições que não sejam GET.
  if (request.method !== 'GET') return;

  // Não interfere em serviços externos ou na API do Apps Script.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/exec')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      // Se estiver no cache, utiliza a versão armazenada.
      if (cached) return cached;

      // Caso contrário, busca na rede.
      return fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, copy);
            });
          }

          return response;
        })
        .catch(() => {
          // Se a conexão falhar, apresenta a página inicial.
          return caches.match('./index.html');
        });
    })
  );
});
