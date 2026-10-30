// Character Vault web app: guscio dell'app disponibile anche senza rete. I dati (indice e miniature)
// sono gestiti dalla pagina nelle cache "cv-data" e "cv-packs"; Google non viene mai intercettato.
const SHELL = "cv-shell-v16-perspectives91";
const FILES = ["./", "index.html", "ui72.css", "ui72.js", "links73.js", "genesis82.js", "genesis_dna.js", "genesis_phone83.js", "studio90.js", "genesis_dna_v1.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith("cv-shell-") && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Rete prima (aggiornamenti immediati), copia locale se offline.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(SHELL).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
