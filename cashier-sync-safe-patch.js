/* cashier-sync-safe-patch.js */
(function () {
  "use strict";

  const PATCH_VERSION = "2026-04-27-safe-sync-with-delete-v3";
  const QUEUE_STORE = "syncQueue";
  const RETRY_MS = 10000;

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let running = false;
  let timer = null;
  let remoteDeleteListening = false;

  function toast(msg, ms = 2600) {
    if (typeof window.toast === "function") {
      window.toast(msg, ms);
      return;
    }

    const el = $("toast");
    if (!el) {
      alert(msg);
      return;
    }

    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el.__safeSyncToast);
    el.__safeSyncToast = setTimeout(() => el.classList.remove("show"), ms);
  }

  async function waitForApp() {
    for (let i = 0; i < 180; i++) {
      if (
        window.state &&
        window.db &&
        window.ref &&
        window.set &&
        window.remove &&
        window.onValue &&
        window.idbGetAll &&
        window.idbDelete &&
        window.idbPut &&
        window.FIREBASE_ROOT
      ) {
        return true;
      }
      await wait(100);
    }

    return false;
  }

  function injectStyle() {
    if ($("safeSyncPatchStyle")) return;

    const style = document.createElement("style");
    style.id = "safeSyncPatchStyle";
    style.textContent = `
      #syncNowBtn .sync-dot{
        display:block !important;
      }

      #syncNowBtn.safe-online .sync-dot{
        background:#22c55e !important;
        box-shadow:0 0 0 4px rgba(34,197,94,.14);
      }

      #syncNowBtn.safe-offline .sync-dot{
        background:#ef4444 !important;
        box-shadow:0 0 0 4px rgba(239,68,68,.14);
      }

      #syncNowBtn.safe-syncing .sync-dot{
        background:#3b82f6 !important;
        box-shadow:0 0 0 4px rgba(59,130,246,.14);
      }

      #syncNowBtn.safe-syncing i{
        animation:syncSpin .8s linear infinite;
        color:#1d4ed8;
      }
    `;
    document.head.appendChild(style);
  }

  function setDot(mode) {
    const btn = $("syncNowBtn");
    const txt = $("connectionText");

    if (!btn) return;

    btn.classList.remove("safe-online", "safe-offline", "safe-syncing");

    if (mode === "offline") {
      btn.classList.add("safe-offline");
      if (txt) {
        txt.textContent = "غير متصل - المزامنة متوقفة";
        txt.style.color = "#dc2626";
      }
      return;
    }

    if (mode === "syncing") {
      btn.classList.add("safe-syncing");
      if (txt) {
        txt.textContent = "جاري المزامنة...";
        txt.style.color = "#1d4ed8";
      }
      return;
    }

    btn.classList.add("safe-online");
    if (txt) {
      txt.textContent = "متصل - المزامنة مفعلة";
      txt.style.color = "#16a34a";
    }
  }

  function firebasePath(store, itemId) {
    if (typeof window.firebasePath === "function") return window.firebasePath(store, itemId);
    return `${window.FIREBASE_ROOT}/${store}/${itemId}`;
  }

  function stripLocalOnlySettings(settings) {
    if (!settings) return settings;

    return {
      ...settings,
      localLogo: "",
      logoMode: settings.logo ? "url" : "default"
    };
  }

  function stateKey(store) {
    return {
      products: "products",
      invoices: "invoices",
      customers: "customers",
      expenses: "expenses",
      purchases: "purchases",
      supplierPayments: "supplierPayments",
      paymentAccounts: "paymentAccounts",
      settings: "settings"
    }[store] || store;
  }

  function removeFromMemory(store, id) {
    const st = window.state;
    if (!st || !id) return;

    const key = stateKey(store);

    if (Array.isArray(st[key])) {
      st[key] = st[key].filter(x => x.id !== id);
    }

    if (store === "products" && Array.isArray(st.cart)) {
      st.cart = st.cart.filter(x => x.productId !== id);
    }

    if (store === "invoices" && typeof window.rebuildCustomerBalances === "function") {
      try {
        window.rebuildCustomerBalances(false);
      } catch {}
    }

    if (store === "customers" && typeof window.rebuildCustomerBalances === "function") {
      try {
        window.rebuildCustomerBalances(false);
      } catch {}
    }
  }

  function upsertInMemory(store, item) {
    const st = window.state;
    if (!st || !item || !item.id) return;

    const key = stateKey(store);

    if (Array.isArray(st[key])) {
      const i = st[key].findIndex(x => x.id === item.id);
      if (i >= 0) st[key][i] = item;
      else st[key].push(item);
    } else if (store === "settings") {
      st.settings = item;
    }
  }

  async function refreshBadge() {
    try {
      if (typeof window.refreshPendingCount === "function") {
        await window.refreshPendingCount();
      }

      const q = await window.idbGetAll(QUEUE_STORE);
      const badge = $("syncCountBadge");

      if (badge) {
        badge.textContent = q.length;
        badge.style.display = q.length ? "flex" : "none";
      }

      return q.length;
    } catch {
      return 0;
    }
  }

  function updatePopover({ visible, title, status, progress }) {
    if (typeof window.updateSyncUi === "function") {
      try {
        window.updateSyncUi({
          visible,
          title,
          status,
          progress,
          spin: false
        });
        return;
      } catch {}
    }

    const pop = $("syncPopover");
    const t = $("syncPopoverTitle");
    const s = $("syncPopoverStatus");
    const bar = $("syncMiniProgressBar");

    if (typeof visible === "boolean" && pop) pop.classList.toggle("show", visible);
    if (title && t) t.textContent = title;
    if (status && s) s.textContent = status;
    if (typeof progress === "number" && bar) bar.style.width = `${progress}%`;
  }

  async function queueDelete(store, id) {
    if (!store || !id) return;

    const oldQueue = await window.idbGetAll(QUEUE_STORE);

    for (const q of oldQueue) {
      if (q.store === store && q.itemId === id && q.type !== "remove") {
        await window.idbDelete(QUEUE_STORE, q.id);
      }
    }

    const already = oldQueue.some(q =>
      q.store === store &&
      q.itemId === id &&
      q.type === "remove"
    );

    if (!already) {
      await window.idbPut(QUEUE_STORE, {
        id: `queue_delete_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: "remove",
        store,
        itemId: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tries: 0,
        source: "safe-sync-delete"
      });
    }

    await refreshBadge();

    if (navigator.onLine) {
      scheduleRetry(150);
    }
  }

  async function pushQueueItem(q) {
    if (!q || !q.store || !q.itemId) return true;

    const path = firebasePath(q.store, q.itemId);

    if (q.type === "remove" || q.type === "delete") {
      await window.remove(window.ref(window.db, path));
      return true;
    }

    const data = q.store === "settings" ? stripLocalOnlySettings(q.data) : q.data;
    await window.set(window.ref(window.db, path), data);
    return true;
  }

  async function safeSync(showPopover = false) {
    if (running) return;

    if (!navigator.onLine) {
      setDot("offline");
      updatePopover({
        visible: showPopover,
        title: "لا يوجد إنترنت",
        status: "لم يتوفر إنترنت، لن تتم المزامنة الآن. البيانات محفوظة محليًا.",
        progress: 0
      });
      toast("لم يتوفر إنترنت");
      await refreshBadge();
      return;
    }

    const queue = await window.idbGetAll(QUEUE_STORE);

    if (!queue.length) {
      setDot("online");
      updatePopover({
        visible: showPopover,
        title: "المزامنة",
        status: "لا توجد عمليات معلقة",
        progress: 100
      });
      await refreshBadge();
      return;
    }

    running = true;
    setDot("syncing");

    let done = 0;

    updatePopover({
      visible: showPopover,
      title: "جاري المزامنة",
      status: `يوجد ${queue.length} عملية معلقة`,
      progress: 1
    });

    for (const q of queue.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))) {
      try {
        await pushQueueItem(q);
        await window.idbDelete(QUEUE_STORE, q.id);
        done++;

        updatePopover({
          visible: showPopover,
          title: "جاري المزامنة",
          status: `تم رفع ${done} من ${queue.length}`,
          progress: Math.round((done / queue.length) * 100)
        });

        await refreshBadge();
      } catch (e) {
        console.warn("safe sync failed", e);

        q.tries = Number(q.tries || 0) + 1;
        q.lastError = String(e?.message || e);
        q.updatedAt = Date.now();

        try {
          await window.idbPut(QUEUE_STORE, q);
        } catch {}

        running = false;
        setDot("offline");

        updatePopover({
          visible: showPopover,
          title: "الاتصال ضعيف",
          status: "فشلت المزامنة مؤقتًا، ستتم إعادة المحاولة تلقائيًا.",
          progress: Math.max(5, Math.round((done / queue.length) * 100))
        });

        scheduleRetry();
        return;
      }
    }

    running = false;
    setDot("online");

    updatePopover({
      visible: showPopover,
      title: "اكتملت المزامنة",
      status: "تمت مزامنة كل العمليات بنجاح",
      progress: 100
    });

    await refreshBadge();
  }

  function scheduleRetry(delay = RETRY_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (navigator.onLine) safeSync(false);
      else setDot("offline");
    }, delay);
  }

  function patchRemoveLocalForDeleteSync() {
    const originalRemoveLocal = window.removeLocal;

    window.removeLocal = async function (store, id, sync = true) {
      try {
        await window.idbDelete(store, id);
        removeFromMemory(store, id);

        if (sync) {
          await queueDelete(store, id);
        }

        if (typeof window.renderAll === "function") {
          window.renderAll();
        }

        return true;
      } catch (e) {
        console.warn("safe removeLocal failed", e);

        if (typeof originalRemoveLocal === "function") {
          return originalRemoveLocal(store, id, sync);
        }

        return false;
      }
    };
  }

  function patchSaveLocalCleanQueue() {
    const originalSaveLocal = window.saveLocal;

    window.saveLocal = async function (store, item, sync = true) {
      if (!item || !item.id) {
        if (typeof originalSaveLocal === "function") {
          return originalSaveLocal(store, item, sync);
        }
        return false;
      }

      try {
        await window.idbPut(store, item);
        upsertInMemory(store, item);

        if (sync) {
          const q = await window.idbGetAll(QUEUE_STORE);
          const hasDelete = q.some(x =>
            x.store === store &&
            x.itemId === item.id &&
            x.type === "remove"
          );

          if (!hasDelete) {
            await window.idbPut(QUEUE_STORE, {
              id: `queue_set_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              type: "set",
              store,
              itemId: item.id,
              data: item,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              tries: 0,
              source: "safe-sync-set"
            });
          }
        }

        await refreshBadge();

        if (sync && navigator.onLine) {
          scheduleRetry(150);
        }

        return true;
      } catch (e) {
        console.warn("safe saveLocal failed", e);

        if (typeof originalSaveLocal === "function") {
          return originalSaveLocal(store, item, sync);
        }

        return false;
      }
    };
  }

  function bindOnlySyncButton() {
    const btn = $("syncNowBtn");
    if (!btn) return;

    btn.onclick = async function (e) {
      e.preventDefault();

      const pop = $("syncPopover");
      const show = pop ? !pop.classList.contains("show") : true;

      await safeSync(show);
    };
  }

  async function hasPendingDeleteFor(store, id) {
    try {
      const q = await window.idbGetAll(QUEUE_STORE);
      return q.some(x => x.store === store && x.itemId === id && x.type === "remove");
    } catch {
      return false;
    }
  }

  async function hasAnyPendingFor(store, id) {
    try {
      const q = await window.idbGetAll(QUEUE_STORE);
      return q.some(x => x.store === store && x.itemId === id);
    } catch {
      return false;
    }
  }

  function listenRemoteDeletesAndUpdates() {
    if (remoteDeleteListening) return;
    remoteDeleteListening = true;

    const stores = [
      "products",
      "invoices",
      "customers",
      "expenses",
      "purchases",
      "supplierPayments",
      "paymentAccounts"
    ];

    stores.forEach(store => {
      try {
        window.onValue(window.ref(window.db, `${window.FIREBASE_ROOT}/${store}`), async snap => {
          const remote = snap.exists() ? (snap.val() || {}) : {};
          const remoteIds = new Set(Object.keys(remote));
          const localItems = await window.idbGetAll(store);

          for (const item of localItems) {
            if (!item?.id) continue;

            const pending = await hasAnyPendingFor(store, item.id);

            if (!remoteIds.has(item.id) && !pending) {
              await window.idbDelete(store, item.id);
              removeFromMemory(store, item.id);
            }
          }

          for (const value of Object.values(remote)) {
            if (!value || !value.id) continue;

            const pendingDelete = await hasPendingDeleteFor(store, value.id);
            if (pendingDelete) continue;

            await window.idbPut(store, value);
            upsertInMemory(store, value);
          }

          if (typeof window.rebuildCustomerBalances === "function") {
            try {
              window.rebuildCustomerBalances(false);
            } catch {}
          }

          if (typeof window.renderAll === "function") {
            window.renderAll();
          }

          await refreshBadge();
        });
      } catch (e) {
        console.warn("remote listener failed", store, e);
      }
    });
  }

  function bindConnectionEvents() {
    window.addEventListener("online", () => {
      setDot("online");
      toast("عاد الإنترنت، جاري المزامنة");
      safeSync(false);
    });

    window.addEventListener("offline", () => {
      setDot("offline");
      updatePopover({
        visible: false,
        title: "أوفلاين",
        status: "لا يوجد اتصال، سيتم حفظ العمليات محليًا",
        progress: 0
      });
    });

    setInterval(() => {
      if (navigator.onLine) {
        setDot(running ? "syncing" : "online");
        safeSync(false);
      } else {
        setDot("offline");
      }
    }, 15000);
  }

  async function init() {
    injectStyle();

    const ok = await waitForApp();

    if (!ok) {
      console.warn("cashier-sync-safe-patch: لم يجد دوال التطبيق. تأكد من Object.assign داخل index.html");
      toast("باتش المزامنة لم يشتغل: دوال التطبيق غير ظاهرة");
      return;
    }

    patchRemoveLocalForDeleteSync();
    patchSaveLocalCleanQueue();
    bindOnlySyncButton();
    bindConnectionEvents();
    listenRemoteDeletesAndUpdates();

    if (navigator.onLine) {
      setDot("online");
      safeSync(false);
    } else {
      setDot("offline");
    }

    window.CashierSyncSafePatch = {
      version: PATCH_VERSION,
      syncNow: safeSync,
      queueDelete,
      forceDelete: async function (store, id) {
        await window.idbDelete(store, id);
        removeFromMemory(store, id);
        await queueDelete(store, id);
        if (typeof window.renderAll === "function") window.renderAll();
      }
    };

    console.log("[cashier-sync-safe-patch] ready", PATCH_VERSION);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();