#!/usr/bin/env python3
"""Сборка версии для показов: release/ — приложение (index.html), админка, PWA.
Запуск: python3 tools/build_release.py"""
import os, shutil, hashlib, json, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'release')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
app = open(os.path.join(ROOT, 'mvp.html'), encoding='utf-8').read()
app = re.sub(r'<title>[^<]*</title>', '<title>Zakup.KG</title>', app, count=1)
# PWA: манифест и регистрация service worker
app = app.replace('<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
    '<link rel="manifest" href="manifest.webmanifest">\n<meta name="mobile-web-app-capable" content="yes">\n<link rel="icon" href="icons/icon.svg" type="image/svg+xml">', 1)
app = app.replace('</body>', "<script>if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');</script>\n</body>", 1)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(app)
shutil.copy(os.path.join(ROOT, 'admin.html'), OUT)
for d in ['icons', 'photos', 'vendor', 'logo']:
    if os.path.isdir(os.path.join(ROOT, d)): shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d))
json.dump({
  "name": "Zakup.KG", "short_name": "Zakup.KG", "description": "B2B-заказы для магазинов, поставщиков и доставщиков",
  "start_url": "./index.html", "scope": "./", "display": "standalone", "orientation": "any",
  "background_color": "#F5F6F4", "theme_color": "#FFFFFF", "lang": "ru",
  "icons": [{"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}]
}, open(os.path.join(OUT, 'manifest.webmanifest'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
# service worker: кэш оболочки, работает без сети после первого открытия
files = []
for base, _, fs in os.walk(OUT):
    for f in fs:
        rel = os.path.relpath(os.path.join(base, f), OUT).replace(os.sep, '/')
        if not rel.endswith(('.txt', '.md')): files.append(rel)
ver = hashlib.sha1(''.join(sorted(files)).encode() + app.encode()).hexdigest()[:10]
sw = """const CACHE = 'zakup-%s';
const FILES = %s;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request))); });
""" % (ver, json.dumps(['./'] + sorted(files), ensure_ascii=False))
open(os.path.join(OUT, 'sw.js'), 'w', encoding='utf-8').write(sw)
print('release/ собран:', len(files), 'файлов, версия', ver)
