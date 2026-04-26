/* sw.js */
const CACHE_VERSION = "cashier-pro-v15-2026-04-26";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./firebase-config.js",

  "https://cdn.tailwindcss.com",
  "https://unpkg.com/@zxing/library@latest",
  "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        return Promise.allSettled(
          APP_SHELL.map((url) => {
            return cache.add(new Request(url, { cache: "reload" }));
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  if (isFirebaseRequest(url)) {
    event.respondWith(networkOnly(req));
    return;
  }

  if (isStaticAsset(req, url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(STATIC_CACHE);
    cache.put("./index.html", fresh.clone());
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cachedReq = await caches.match(req);
    if (cachedReq) return cachedReq;

    const cachedIndex = await caches.match("./index.html");
    if (cachedIndex) return cachedIndex;

    return new Response(
      `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>أوفلاين</title>
        <style>
          body{
            margin:0;
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            font-family:Arial,sans-serif;
            background:#eff6ff;
            color:#0f172a;
            direction:rtl;
            text-align:center;
            padding:20px;
          }
          .box{
            background:white;
            border-radius:24px;
            padding:24px;
            max-width:420px;
            box-shadow:0 20px 50px rgba(15,23,42,.12);
          }
          h1{margin:0 0 10px;font-size:24px}
          p{color:#64748b;line-height:1.8}
        </style>
      </head>
      <body>
        <div class="box">
          <h1>التطبيق غير محفوظ بعد</h1>
          <p>افتح التطبيق مرة واحدة بوجود الإنترنت حتى يتم حفظه، وبعدها سيعمل بدون إنترنت حتى مع تحديث الصفحة.</p>
        </div>
      </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
        }
      }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response("", { status: 504 });
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    return new Response("", { status: 504 });
  }
}

async function networkOnly(req) {
  try {
    return await fetch(req);
  } catch (err) {
    return new Response(
      JSON.stringify({
        offline: true,
        message: "Firebase request skipped while offline"
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}

function isStaticAsset(req, url) {
  const dest = req.destination;

  if (
    dest === "script" ||
    dest === "style" ||
    dest === "font" ||
    dest === "image" ||
    dest === "manifest"
  ) {
    return true;
  }

  return (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2")
  );
}

function isFirebaseRequest(url) {
  return (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com") && url.pathname.includes("firebase")
  );
}

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
});