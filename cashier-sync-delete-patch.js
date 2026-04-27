/* cashier-sync-delete-patch.js */
(function () {
  "use strict";

  const PATCH_VERSION = "2026-04-27-strong-sync-delete-v1";
  const QUEUE_STORE = "syncQueue";
  const RETRY_BASE_MS = 2500;
  const RETRY_MAX_MS = 45000;
  const HEARTBEAT_MS = 8000;

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let retryTimer = null;
  let retryAttempt = 0;
  let realtimePatched = false;
  let isSyncRunning = false;
  let onlineCheckTimer = null;

  function log(...args) {
    console.log("[cashier-sync-delete-patch]", PATCH_VERSION, ...args);
  }

  function toast(msg, ms = 2800) {
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
    clearTimeout(el.__syncPatchToast);
    el.__syncPatchToast = setTimeout(() => el.classList.remove("show"), ms);
  }

  function cleanNumber(v, fallback = 0) {
    if (typeof window.cleanNumber === "function") return window.cleanNumber(v, fallback);
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function getState() {
    return window.state || null;
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
        window.FIREBASE_ROOT &&
        window.idbGetAll &&
        window.idbDelete &&
        window.idbPut
      ) {
        return true;
      }

      await wait(100);
    }

    return false;
  }

  function syncStoreLabel(store) {
    const map = {
      products: "المنتجات",
      invoices: "الفواتير",
      customers: "العملاء",
      expenses: "المصروفات",
      purchases: "المشتريات",
      supplierPayments: "دفعات التجار",
      paymentAccounts: "حسابات الدفع",
      settings: "الإعدادات"
    };

    return map[store] || store || "عملية";
  }

  function firebasePath(store, itemId) {
    if (typeof window.firebasePath === "function") return window.firebasePath(store, itemId);
    return `${window.FIREBASE_ROOT}/${store}/${itemId}`;
  }

  function setSyncIconStatus(status) {
    const btn = $("syncNowBtn");
    const connectionText = $("connectionText");

    if (!btn) return;

    btn.classList.remove("sync-online", "sync-offline", "sync-working", "sync-error");

    if (status === "offline") {
      btn.classList.add("sync-offline");
      if (connectionText) {
        connectionText.textContent = "غير متصل - المزامنة متوقفة";
        connectionText.style.color = "#dc2626";
      }
      return;
    }

    if (status === "working") {
      btn.classList.add("sync-working");
      if (connectionText) {
        connectionText.textContent = "جاري المزامنة...";
        connectionText.style.color = "#1d4ed8";
      }
      return;
    }

    if (status === "error") {
      btn.classList.add("sync-error");
      if (connectionText) {
        connectionText.textContent = "الاتصال ضعيف - سيتم إعادة المحاولة";
        connectionText.style.color = "#d97706";
      }
      return;
    }

    btn.classList.add("sync-online");
    if (connectionText) {
      connectionText.textContent = "متصل - المزامنة مفعلة";
      connectionText.style.color = "#16a34a";
    }
  }

  function injectStyles() {
    if ($("cashierSyncDeletePatchStyles")) return;

    const style = document.createElement("style");
    style.id = "cashierSyncDeletePatchStyles";
    style.textContent = `
      #syncNowBtn .sync-dot{
        display:block !important;
        background:#22c55e;
      }

      #syncNowBtn.sync-online .sync-dot{
        display:block !important;
        background:#22c55e !important;
        box-shadow:0 0 0 4px rgba(34,197,94,.14);
      }

      #syncNowBtn.sync-offline .sync-dot{
        display:block !important;
        background:#ef4444 !important;
        box-shadow:0 0 0 4px rgba(239,68,68,.14);
      }

      #syncNowBtn.sync-error .sync-dot{
        display:block !important;
        background:#f59e0b !important;
        box-shadow:0 0 0 4px rgba(245,158,11,.16);
      }

      #syncNowBtn.sync-working .sync-dot{
        display:block !important;
        background:#3b82f6 !important;
        box-shadow:0 0 0 4px rgba(59,130,246,.14);
        animation:syncPatchPulse .8s ease-in-out infinite;
      }

      #syncNowBtn.sync-working i{
        animation:syncSpin .8s linear infinite;
        color:#1d4ed8;
      }

      @keyframes syncPatchPulse{
        0%,100%{transform:scale(1);opacity:1}
        50%{transform:scale(1.25);opacity:.65}
      }
    `;
    document.head.appendChild(style);
  }

  async function pingFirebase(timeoutMs = 4500) {
    if (!navigator.onLine) return false;

    try {
      const probe = window.get(
        window.ref(window.db, `${window.FIREBASE_ROOT}/__sync_probe`)
      );

      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });

      await Promise.race([probe, timeout]);
      return true;
    } catch {
      return false;
    }
  }

  async function updateConnectionState() {
    if (!navigator.onLine) {
      setSyncIconStatus("offline");
      return false;
    }

    const ok = await pingFirebase(3500);

    if (ok) {
      setSyncIconStatus("online");
      return true;
    }

    setSyncIconStatus("error");
    return false;
  }

  async function refreshPendingCountSafe() {
    try {
      if (typeof window.refreshPendingCount === "function") {
        await window.refreshPendingCount();
      }

      const queue = await window.idbGetAll(QUEUE_STORE);
      const badge = $("syncCountBadge");

      if (badge) {
        badge.textContent = queue.length;
        badge.style.display = queue.length ? "flex" : "none";
      }

      return queue.length;
    } catch {
      return 0;
    }
  }

  function updateSyncUiSafe(payload = {}) {
    if (typeof window.updateSyncUi === "function") {
      try {
        window.updateSyncUi(payload);
        return;
      } catch {}
    }

    const pop = $("syncPopover");
    const title = $("syncPopoverTitle");
    const status = $("syncPopoverStatus");
    const bar = $("syncMiniProgressBar");

    if (payload.visible !== undefined && pop) pop.classList.toggle("show", !!payload.visible);
    if (payload.title && title) title.textContent = payload.title;
    if (payload.status && status) status.textContent = payload.status;
    if (payload.progress !== undefined && bar) bar.style.width = `${Math.max(0, Math.min(100, cleanNumber(payload.progress)))}%`;
  }

  async function enqueueStrongSync(action) {
    const item = {
      id: `queue_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: action.type,
      store: action.store,
      itemId: action.itemId,
      data: action.data || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tries: 0,
      strongPatch: true
    };

    await window.idbPut(QUEUE_STORE, item);
    await refreshPendingCountSafe();

    if (navigator.onLine) scheduleSync(250);
    return item;
  }

  function stripLocalOnlySettings(settings) {
    if (!settings) return settings;

    return {
      ...settings,
      localLogo: "",
      logoMode: settings.logo ? "url" : "default"
    };
  }

  async function pushQueueItem(q) {
    if (!q || !q.store || !q.itemId) {
      await window.idbDelete(QUEUE_STORE, q.id);
      return true;
    }

    const path = firebasePath(q.store, q.itemId);

    if (q.type === "remove" || q.type === "delete") {
      await window.remove(window.ref(window.db, path));
      return true;
    }

    if (q.type === "set" || q.type === "update") {
      const data = q.store === "settings" ? stripLocalOnlySettings(q.data) : q.data;
      await window.set(window.ref(window.db, path), data);
      return true;
    }

    await window.idbDelete(QUEUE_STORE, q.id);
    return true;
  }

  async function syncNowStrong(showPopover = false) {
    if (isSyncRunning) return;

    if (!navigator.onLine) {
      setSyncIconStatus("offline");

      updateSyncUiSafe({
        visible: showPopover,
        title: "لا يوجد إنترنت",
        status: "لم يتوفر إنترنت، لن تتم المزامنة الآن. العمليات محفوظة محليًا.",
        progress: 0,
        spin: false
      });

      toast("لم يتوفر إنترنت، سيتم المزامنة عند عودة الاتصال");
      await refreshPendingCountSafe();
      return;
    }

    const connectionOk = await pingFirebase(5000);

    if (!connectionOk) {
      setSyncIconStatus("error");

      updateSyncUiSafe({
        visible: showPopover,
        title: "الاتصال ضعيف",
        status: "تعذر الوصول إلى Firebase الآن، سيتم إعادة المحاولة تلقائيًا.",
        progress: 0,
        spin: false
      });

      scheduleSync();
      await refreshPendingCountSafe();
      return;
    }

    const queue = await window.idbGetAll(QUEUE_STORE);

    if (!queue.length) {
      setSyncIconStatus("online");

      updateSyncUiSafe({
        visible: showPopover,
        title: "المزامنة",
        status: "كل البيانات مرفوعة ولا توجد عمليات معلقة",
        progress: 100,
        spin: false,
        operations: []
      });

      await refreshPendingCountSafe();
      return;
    }

    isSyncRunning = true;
    setSyncIconStatus("working");

    updateSyncUiSafe({
      visible: showPopover,
      title: "جاري المزامنة",
      status: `يوجد ${queue.length} عملية تنتظر الرفع`,
      progress: 1,
      spin: true,
      operations: []
    });

    let done = 0;
    let failed = false;

    const sorted = queue.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

    for (const q of sorted) {
      try {
        const label = syncStoreLabel(q.store);

        updateSyncUiSafe({
          visible: showPopover,
          title: "جاري المزامنة",
          status: `رفع ${label}: ${done + 1} من ${sorted.length}`,
          progress: Math.max(2, done / sorted.length * 100),
          spin: true,
          operation: {
            store: label,
            text: q.type === "remove" || q.type === "delete" ? "حذف" : "رفع",
            done: false
          }
        });

        await pushQueueItem(q);
        await window.idbDelete(QUEUE_STORE, q.id);

        done++;

        updateSyncUiSafe({
          visible: showPopover,
          status: `تم رفع ${done} من ${sorted.length}`,
          progress: done / sorted.length * 100,
          spin: true,
          operation: {
            store: label,
            text: q.type === "remove" || q.type === "delete" ? "حذف" : "رفع",
            done: true
          }
        });

        await refreshPendingCountSafe();
      } catch (e) {
        failed = true;

        q.tries = Number(q.tries || 0) + 1;
        q.updatedAt = Date.now();
        q.lastError = String(e?.message || e);

        try {
          await window.idbPut(QUEUE_STORE, q);
        } catch {}

        console.warn("sync item failed", q, e);

        updateSyncUiSafe({
          visible: showPopover,
          title: "الاتصال ضعيف",
          status: "فشلت عملية مؤقتًا، ستبقى محفوظة وسيتم إعادة المحاولة تلقائيًا.",
          progress: Math.max(5, done / sorted.length * 100),
          spin: false,
          operation: {
            store: syncStoreLabel(q.store),
            text: "ينتظر إعادة المحاولة",
            done: false
          }
        });

        setSyncIconStatus("error");
        break;
      }
    }

    isSyncRunning = false;

    const left = await refreshPendingCountSafe();

    if (!failed && left === 0) {
      retryAttempt = 0;
      setSyncIconStatus("online");

      updateSyncUiSafe({
        visible: showPopover,
        title: "اكتملت المزامنة",
        status: "تمت مزامنة كل العمليات بنجاح",
        progress: 100,
        spin: false
      });
    } else {
      setSyncIconStatus("error");
      scheduleSync();
    }
  }

  function scheduleSync(delay = null) {
    clearTimeout(retryTimer);

    const ms = delay ?? Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(1.6, retryAttempt));
    retryAttempt++;

    retryTimer = setTimeout(() => {
      syncNowStrong(false);
    }, ms);
  }

  function getCollectionNameFromStore(store) {
    const map = {
      products: "products",
      invoices: "invoices",
      customers: "customers",
      expenses: "expenses",
      purchases: "purchases",
      supplierPayments: "supplierPayments",
      paymentAccounts: "paymentAccounts"
    };

    return map[store] || store;
  }

  function removeItemFromState(store, itemId) {
    const st = getState();
    if (!st) return;

    const key = getCollectionNameFromStore(store);

    if (Array.isArray(st[key])) {
      st[key] = st[key].filter(x => x.id !== itemId);
    }

    if (store === "products" && Array.isArray(st.cart)) {
      st.cart = st.cart.filter(x => x.productId !== itemId);
    }
  }

  async function removeLocalAndQueue(store, itemId) {
    await window.idbDelete(store, itemId);
    removeItemFromState(store, itemId);

    await enqueueStrongSync({
      type: "remove",
      store,
      itemId
    });

    if (typeof window.rebuildCustomerBalances === "function") {
      try {
        window.rebuildCustomerBalances(false);
      } catch {}
    }

    if (typeof window.renderAll === "function") {
      window.renderAll();
    }

    scheduleSync(200);
  }

  function patchRemoveLocal() {
    const oldRemoveLocal = window.removeLocal;

    window.removeLocal = async function (store, id, sync = true) {
      try {
        await window.idbDelete(store, id);
        removeItemFromState(store, id);

        if (sync) {
          await enqueueStrongSync({
            type: "remove",
            store,
            itemId: id
          });
        }

        await refreshPendingCountSafe();

        if (sync && navigator.onLine) {
          scheduleSync(150);
        }

        return true;
      } catch (e) {
        console.error("patched removeLocal failed", e);

        if (typeof oldRemoveLocal === "function") {
          return oldRemoveLocal(store, id, sync);
        }

        return false;
      }
    };
  }

  function patchSaveLocalQueue() {
    const oldSaveLocal = window.saveLocal;

    window.saveLocal = async function (store, item, sync = true) {
      if (!item || !item.id) {
        if (typeof oldSaveLocal === "function") return oldSaveLocal(store, item, sync);
        return false;
      }

      try {
        await window.idbPut(store, item);

        const st = getState();
        const key = getCollectionNameFromStore(store);

        if (st && Array.isArray(st[key])) {
          const i = st[key].findIndex(x => x.id === item.id);
          if (i >= 0) st[key][i] = item;
          else st[key].push(item);
        }

        if (sync) {
          await enqueueStrongSync({
            type: "set",
            store,
            itemId: item.id,
            data: item
          });
        }

        await refreshPendingCountSafe();

        if (sync && navigator.onLine) {
          scheduleSync(150);
        }

        return true;
      } catch (e) {
        console.error("patched saveLocal failed", e);

        if (typeof oldSaveLocal === "function") {
          return oldSaveLocal(store, item, sync);
        }

        return false;
      }
    };
  }

  function patchSyncNow() {
    window.syncNow = syncNowStrong;
  }

  function patchSyncButton() {
    const btn = $("syncNowBtn");
    if (!btn) return;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      const pop = $("syncPopover");
      const show = pop ? !pop.classList.contains("show") : true;

      if (!navigator.onLine) {
        setSyncIconStatus("offline");

        updateSyncUiSafe({
          visible: true,
          title: "لا يوجد إنترنت",
          status: "لم يتوفر إنترنت، لن تتم المزامنة الآن. البيانات محفوظة محليًا.",
          progress: 0,
          spin: false
        });

        toast("لم يتوفر إنترنت");
        await refreshPendingCountSafe();
        return;
      }

      await syncNowStrong(show);
    }, true);
  }

  function deleteStoreByRemoteEvent(store, id) {
    const st = getState();
    if (!st || !id) return;

    window.idbDelete(store, id).catch(() => {});
    removeItemFromState(store, id);

    if (typeof window.rebuildCustomerBalances === "function") {
      try {
        window.rebuildCustomerBalances(false);
      } catch {}
    }

    if (typeof window.renderAll === "function") {
      window.renderAll();
    }

    toast(`تم حذف عنصر من ${syncStoreLabel(store)} على جهاز آخر`);
  }

  function upsertStoreByRemoteEvent(store, value) {
    if (!value || !value.id) return;

    const st = getState();
    const key = getCollectionNameFromStore(store);

    window.idbPut(store, value).catch(() => {});

    if (st && Array.isArray(st[key])) {
      const i = st[key].findIndex(x => x.id === value.id);
      if (i >= 0) st[key][i] = value;
      else st[key].push(value);
    }

    if (typeof window.rebuildCustomerBalances === "function") {
      try {
        window.rebuildCustomerBalances(false);
      } catch {}
    }

    if (typeof window.renderAll === "function") {
      window.renderAll();
    }
  }

  function patchRealtimeDeletionListeners() {
    if (realtimePatched) return;
    realtimePatched = true;

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
        window.onValue(
          window.ref(window.db, `${window.FIREBASE_ROOT}/${store}`),
          async (snap) => {
            const remoteObj = snap.exists() ? (snap.val() || {}) : {};
            const remoteIds = new Set(Object.keys(remoteObj));

            const localItems = await window.idbGetAll(store);
            const localIds = new Set(localItems.map(x => x.id).filter(Boolean));

            for (const local of localItems) {
              if (!local?.id) continue;

              if (!remoteIds.has(local.id)) {
                const pending = await hasPendingQueueFor(store, local.id);
                if (!pending) {
                  deleteStoreByRemoteEvent(store, local.id);
                }
              }
            }

            Object.values(remoteObj).forEach(value => {
              if (value && value.id) {
                upsertStoreByRemoteEvent(store, value);
              }
            });

            await refreshPendingCountSafe();
          }
        );
      } catch (e) {
        console.warn("failed realtime delete listener", store, e);
      }
    });
  }

  async function hasPendingQueueFor(store, itemId) {
    try {
      const q = await window.idbGetAll(QUEUE_STORE);
      return q.some(x => x.store === store && x.itemId === itemId);
    } catch {
      return false;
    }
  }

  function patchDeleteButtonsAsExtraProtection() {
    document.addEventListener("click", async (e) => {
      const map = [
        ["[data-delete-product]", "products", "deleteProduct"],
        ["[data-delete-invoice]", "invoices", "deleteInvoice"],
        ["[data-delete-purchase]", "purchases", "deletePurchase"],
        ["[data-delete-supplier-payment]", "supplierPayments", "deleteSupplierPayment"],
        ["[data-delete-expense]", "expenses", "deleteExpense"],
        ["[data-delete-account]", "paymentAccounts", "deletePaymentAccount"],
        ["[data-delete-customer]", "customers", "deleteCustomer"]
      ];

      for (const [selector, store] of map) {
        const btn = e.target.closest(selector);
        if (!btn) continue;

        const id =
          btn.dataset.deleteProduct ||
          btn.dataset.deleteInvoice ||
          btn.dataset.deletePurchase ||
          btn.dataset.deleteSupplierPayment ||
          btn.dataset.deleteExpense ||
          btn.dataset.deleteAccount ||
          btn.dataset.deleteCustomer;

        if (!id) return;

        setTimeout(async () => {
          const st = getState();
          const key = getCollectionNameFromStore(store);
          const stillExists = Array.isArray(st?.[key]) && st[key].some(x => x.id === id);

          if (!stillExists) {
            await enqueueStrongSync({
              type: "remove",
              store,
              itemId: id
            });
            scheduleSync(100);
          }
        }, 500);

        return;
      }
    }, true);
  }

  function patchOnlineOfflineEvents() {
    window.addEventListener("online", async () => {
      setSyncIconStatus("online");
      toast("عاد الإنترنت، جاري المزامنة");
      retryAttempt = 0;
      await refreshPendingCountSafe();
      scheduleSync(300);
      patchRealtimeDeletionListeners();
    });

    window.addEventListener("offline", async () => {
      setSyncIconStatus("offline");

      updateSyncUiSafe({
        visible: false,
        title: "أوفلاين",
        status: "لا يوجد اتصال، سيتم حفظ العمليات محليًا",
        progress: 0,
        spin: false
      });

      await refreshPendingCountSafe();
    });

    clearInterval(onlineCheckTimer);
    onlineCheckTimer = setInterval(updateConnectionState, HEARTBEAT_MS);
  }

  function patchQueueDuplicates() {
    const oldEnqueue = window.enqueueSync;

    window.enqueueSync = async function (action) {
      if (!action || !action.store || !action.itemId) {
        if (typeof oldEnqueue === "function") return oldEnqueue(action);
        return false;
      }

      const queue = await window.idbGetAll(QUEUE_STORE);

      const sameIndex = queue.findIndex(q =>
        q.store === action.store &&
        q.itemId === action.itemId
      );

      if (sameIndex >= 0) {
        const old = queue[sameIndex];

        const merged = {
          ...old,
          ...action,
          id: old.id,
          updatedAt: Date.now(),
          tries: old.tries || 0,
          strongPatch: true
        };

        if (old.type === "remove" || action.type === "remove") {
          merged.type = "remove";
          delete merged.data;
        }

        await window.idbPut(QUEUE_STORE, merged);
      } else {
        await enqueueStrongSync(action);
      }

      await refreshPendingCountSafe();

      if (navigator.onLine) scheduleSync(200);

      return true;
    };
  }

  async function forceSyncExistingQueue() {
    const count = await refreshPendingCountSafe();

    if (!navigator.onLine) {
      setSyncIconStatus("offline");
      return;
    }

    const ok = await pingFirebase(3500);

    if (!ok) {
      setSyncIconStatus("error");
      if (count) scheduleSync();
      return;
    }

    setSyncIconStatus("online");

    if (count) scheduleSync(600);
  }

  async function init() {
    injectStyles();

    const ok = await waitForApp();

    if (!ok) {
      toast("باتش المزامنة لم يجد دوال التطبيق. تأكد من إضافة Object.assign داخل index.html");
      console.warn("cashier-sync-delete-patch: app globals missing");
      return;
    }

    patchRemoveLocal();
    patchSaveLocalQueue();
    patchQueueDuplicates();
    patchSyncNow();
    patchSyncButton();
    patchOnlineOfflineEvents();
    patchRealtimeDeletionListeners();
    patchDeleteButtonsAsExtraProtection();

    await forceSyncExistingQueue();

    window.CashierSyncDeletePatch = {
      version: PATCH_VERSION,
      syncNow: syncNowStrong,
      updateConnectionState,
      enqueueStrongSync,
      cleanQueue: async () => {
        await window.idbClear(QUEUE_STORE);
        await refreshPendingCountSafe();
        toast("تم تنظيف طابور المزامنة");
      }
    };

    log("ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();