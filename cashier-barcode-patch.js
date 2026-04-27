/* cashier-barcode-patch.js */
(function () {
  "use strict";

  const PATCH_VERSION = "2026-04-27-html5-qrcode-inventory-units-debts-v1";
  const QR_SOUND_SRC = "./qr.mp3";
  const HTML5_QRCODE_SRC = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const $ = (id) => document.getElementById(id);

  function log(...args) {
    console.log("[cashier-barcode-patch]", PATCH_VERSION, ...args);
  }

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
    clearTimeout(el.__patchToastTimer);
    el.__patchToastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  function cleanNumber(v, fallback = 0) {
    if (typeof window.cleanNumber === "function") return window.cleanNumber(v, fallback);
    const s = String(v ?? "").trim().replace(",", ".");
    if (!s || s === "." || s === "-") return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    if (typeof window.money === "function") return window.money(value);
    const n = cleanNumber(value);
    const currency = window.state?.settings?.currency || "₪";
    return `${currency} ${n.toFixed(2)}`;
  }

  function getState() {
    return window.state || null;
  }

  async function waitForApp() {
    for (let i = 0; i < 160; i++) {
      const st = getState();
      if (
        st &&
        Array.isArray(st.products) &&
        Array.isArray(st.cart)
      ) {
        return true;
      }
      await wait(100);
    }
    return false;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === src || s.src.includes(src));
      if (existing) {
        if (window.Html5Qrcode) resolve(true);
        else {
          existing.addEventListener("load", () => resolve(true), { once: true });
          existing.addEventListener("error", reject, { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const scanSound = new Audio(QR_SOUND_SRC);
  scanSound.preload = "auto";
  scanSound.volume = 1;

  function unlockSound() {
    scanSound.play()
      .then(() => {
        scanSound.pause();
        scanSound.currentTime = 0;
      })
      .catch(() => {});
  }

  document.addEventListener("click", unlockSound, { once: true, passive: true });
  document.addEventListener("touchstart", unlockSound, { once: true, passive: true });

  function playScanSound() {
    try {
      scanSound.pause();
      scanSound.currentTime = 0;
      scanSound.play().catch(() => {});
    } catch (e) {
      console.warn(e);
    }
  }

  function vibratePhone() {
    if (navigator.vibrate) navigator.vibrate([55, 25, 55]);
  }

  function ensureScannerStyles() {
    if ($("cashierPatchScannerStyles")) return;

    const style = document.createElement("style");
    style.id = "cashierPatchScannerStyles";
    style.textContent = `
      .patch-camera-page{
        position:fixed;
        inset:0;
        z-index:9999;
        background:#000;
        display:none;
      }

      .patch-camera-page.show{
        display:block;
      }

      #patchHtml5Reader{
        width:100vw;
        height:100vh;
        background:#000;
      }

      #patchHtml5Reader video{
        width:100vw !important;
        height:100vh !important;
        object-fit:cover !important;
      }

      #patchHtml5Reader__scan_region,
      #patchHtml5Reader__dashboard{
        display:none !important;
      }

      .patch-scan-frame{
        pointer-events:none;
        position:fixed;
        top:50%;
        left:50%;
        width:min(82vw,420px);
        height:230px;
        transform:translate(-50%,-50%);
        border:3px solid rgba(255,255,255,.55);
        border-radius:26px;
        z-index:10001;
        transition:.15s ease;
        box-shadow:
          0 0 0 9999px rgba(0,0,0,.18),
          0 0 30px rgba(255,255,255,.15);
      }

      .patch-scan-frame::before,
      .patch-scan-frame::after{
        content:"";
        position:absolute;
        width:54px;
        height:54px;
        border-color:#22c55e;
        border-style:solid;
        filter:drop-shadow(0 0 12px rgba(34,197,94,.95));
      }

      .patch-scan-frame::before{
        top:-4px;
        right:-4px;
        border-width:6px 6px 0 0;
        border-radius:0 22px 0 0;
      }

      .patch-scan-frame::after{
        left:-4px;
        bottom:-4px;
        border-width:0 0 6px 6px;
        border-radius:0 0 0 22px;
      }

      .patch-laser{
        position:fixed;
        top:50%;
        left:50%;
        width:min(72vw,360px);
        height:3px;
        transform:translate(-50%,-50%);
        z-index:10002;
        border-radius:999px;
        background:linear-gradient(90deg,transparent,#22c55e,transparent);
        box-shadow:0 0 22px #22c55e;
        animation:patchLaserMove 1.2s ease-in-out infinite;
        pointer-events:none;
      }

      @keyframes patchLaserMove{
        0%,100%{
          transform:translate(-50%,calc(-50% - 95px));
          opacity:.55;
        }
        50%{
          transform:translate(-50%,calc(-50% + 95px));
          opacity:1;
        }
      }

      .patch-camera-page.detected .patch-scan-frame{
        border-color:#22c55e;
        box-shadow:
          0 0 0 9999px rgba(0,0,0,.13),
          0 0 40px rgba(34,197,94,.9),
          inset 0 0 35px rgba(34,197,94,.25);
        animation:patchGreenPop .28s ease;
      }

      @keyframes patchGreenPop{
        0%{transform:translate(-50%,-50%) scale(.96)}
        60%{transform:translate(-50%,-50%) scale(1.03)}
        100%{transform:translate(-50%,-50%) scale(1)}
      }

      .patch-camera-close{
        position:fixed;
        top:16px;
        left:16px;
        z-index:10005;
        width:46px;
        height:46px;
        border:0;
        border-radius:16px;
        background:rgba(15,23,42,.82);
        color:#fff;
        font-size:20px;
        font-weight:900;
        display:flex;
        align-items:center;
        justify-content:center;
        box-shadow:0 14px 30px rgba(0,0,0,.3);
      }

      .patch-camera-title{
        position:fixed;
        top:18px;
        right:16px;
        z-index:10005;
        max-width:calc(100vw - 90px);
        padding:10px 14px;
        border-radius:16px;
        background:rgba(15,23,42,.82);
        color:#fff;
        font-weight:900;
        font-family:Cairo,Arial,sans-serif;
        font-size:14px;
      }

      .patch-scan-hint{
        position:fixed;
        right:16px;
        left:16px;
        bottom:24px;
        z-index:10005;
        padding:13px 16px;
        border-radius:18px;
        background:rgba(15,23,42,.88);
        color:#fff;
        font-weight:900;
        text-align:center;
        font-family:Cairo,Arial,sans-serif;
        border:1px solid rgba(255,255,255,.14);
      }

      .patch-inventory-summary{
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:12px;
        margin:12px 0;
      }

      .patch-inventory-stat{
        background:#f8fafc;
        border:1px solid #e2e8f0;
        border-radius:22px;
        padding:14px 12px;
        min-height:84px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        gap:7px;
      }

      .patch-inventory-stat span{
        font-size:12px;
        color:#64748b;
        font-weight:900;
      }

      .patch-inventory-stat b{
        font-size:20px;
        color:#1d4ed8;
        direction:ltr;
        text-align:right;
      }

      .patch-inventory-stat.green b{color:#16a34a}
      .patch-inventory-stat.gold b{color:#d97706}
      .patch-inventory-stat.dark b{color:#0f172a}

      @media(max-width:900px){
        .patch-inventory-summary{
          grid-template-columns:repeat(2,minmax(0,1fr));
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureScannerDom() {
    ensureScannerStyles();

    let page = $("patchCameraPage");
    if (page) return page;

    page = document.createElement("div");
    page.id = "patchCameraPage";
    page.className = "patch-camera-page";
    page.innerHTML = `
      <div id="patchHtml5Reader"></div>
      <div class="patch-scan-frame"></div>
      <div class="patch-laser"></div>
      <button id="patchCameraCloseBtn" class="patch-camera-close" type="button">×</button>
      <div id="patchCameraTitle" class="patch-camera-title">قراءة باركود المنتج</div>
      <div id="patchScanHint" class="patch-scan-hint">وجّه الكاميرا نحو الباركود</div>
    `;
    document.body.appendChild(page);

    $("patchCameraCloseBtn").addEventListener("click", stopPatchScanner);

    return page;
  }

  let patchScanner = null;
  let patchRunning = false;
  let patchMode = "sale";
  let patchTargetInputId = "";
  let lastCode = "";
  let lastTime = 0;

  function markDetected() {
    const page = $("patchCameraPage");
    if (!page) return;

    page.classList.add("detected");
    clearTimeout(page.__detectedTimer);
    page.__detectedTimer = setTimeout(() => {
      page.classList.remove("detected");
    }, 550);
  }

  async function stopPatchScanner() {
    const page = $("patchCameraPage");

    if (patchScanner && patchRunning) {
      try {
        await patchScanner.stop();
      } catch {}
      try {
        await patchScanner.clear();
      } catch {}
    }

    patchScanner = null;
    patchRunning = false;

    if (page) page.classList.remove("show");

    const floating = $("floatingScanner");
    if (floating) floating.classList.remove("show");

    try {
      const st = getState();
      if (st?.scanner) {
        st.scanner.locked = false;
        st.scanner.active = false;
      }
    } catch {}
  }

  function getActivePage() {
    const active = document.querySelector(".section.active");
    if (!active) return "";
    return active.id?.replace("page-", "") || "";
  }

  function getProductByBarcodeLocal(code) {
    const st = getState();
    const c = String(code || "").trim();
    if (!st || !c) return null;

    if (typeof window.getProductByBarcode === "function") {
      const p = window.getProductByBarcode(c);
      if (p) return p;
    }

    return (st.products || []).find(p =>
      String(p.barcode || "").trim() === c ||
      String(p.code || "").trim() === c
    ) || null;
  }

  function normalizeProductLocal(p) {
    if (typeof window.normalizeProduct === "function") return window.normalizeProduct(p);
    return p || {};
  }

  function getDefaultSaleUnitLocal(product) {
    if (typeof window.getDefaultSaleUnit === "function") return window.getDefaultSaleUnit(product);

    const p = product || {};
    if (p.unitType === "carton") return "piece";
    if (p.unitType === "kg") return "g";
    if (p.unitType === "liter") return "ml";
    return p.unitType || "piece";
  }

  function getUnitFactorLocal(product, selectedUnit) {
    if (typeof window.getUnitFactor === "function") return cleanNumber(window.getUnitFactor(product, selectedUnit), 1);

    const p = product || {};
    if (selectedUnit === "carton") return cleanNumber(p.cartonUnits || 1, 1);
    if (selectedUnit === "kg") return 1000;
    if (selectedUnit === "liter") return 1000;
    return 1;
  }

  function getUnitTextLocal(product, selectedUnit) {
    if (typeof window.getUnitText === "function") return window.getUnitText(product, selectedUnit);

    const map = {
      piece: "قطعة",
      carton: "كرتونة",
      kg: "كيلو",
      g: "جرام",
      liter: "لتر",
      ml: "مل",
      minutes: "دقائق",
      custom: product?.customUnit || "مخصص"
    };
    return map[selectedUnit] || selectedUnit || "-";
  }

  function priceForLineFixed(product, qtyValue, selectedUnit) {
    const p = normalizeProductLocal(product);
    const qty = Math.max(0, cleanNumber(qtyValue, 0));
    const factor = getUnitFactorLocal(p, selectedUnit);
    const baseQty = qty * factor;
    const unitPrice = cleanNumber(p.salePrice) * factor;
    const unitCost = cleanNumber(p.costPrice) * factor;

    return {
      qty,
      qtyText: String(qty),
      selectedUnit,
      baseQty,
      unitLabel: getUnitTextLocal(p, selectedUnit),
      price: unitPrice,
      costPrice: unitCost,
      total: unitPrice * qty,
      costTotal: unitCost * qty
    };
  }

  function addToCartFixed(product, selectedUnit = "") {
    const st = getState();
    if (!st || !product) return false;

    const p = normalizeProductLocal(product);
    const unit = selectedUnit || getDefaultSaleUnitLocal(p);
    const pricing = priceForLineFixed(p, 1, unit);

    const existing = st.cart.find(x => x.productId === p.id && x.selectedUnit === unit);

    if (existing) {
      const nextQty = cleanNumber(existing.qty, 1) + 1;
      Object.assign(existing, priceForLineFixed(p, nextQty, unit));
    } else {
      st.cart.push({
        id: `cart_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        productId: p.id,
        name: p.name,
        selectedUnit: unit,
        ...pricing
      });
    }

    if (typeof window.renderCart === "function") window.renderCart();
    else {
      const inputEvent = new Event("input", { bubbles: true });
      $("discountValue")?.dispatchEvent(inputEvent);
    }

    toast(`تمت إضافة ${p.name}`);
    return true;
  }

  function handlePatchScannedCode(code) {
    code = String(code || "").trim();
    if (!code) return;

    markDetected();
    playScanSound();
    vibratePhone();

    const st = getState();
    const activePage = getActivePage();

    if (patchMode === "product" || patchTargetInputId) {
      const input = $(patchTargetInputId || "productBarcode");
      if (input) {
        input.value = code;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      stopPatchScanner();
      toast("تمت قراءة الباركود ووضعه في خانة كود المنتج");
      return;
    }

    if (activePage === "inventory" && $("productBarcode")) {
      $("productBarcode").value = code;
      $("productBarcode").dispatchEvent(new Event("input", { bubbles: true }));
      stopPatchScanner();
      toast("تمت قراءة الباركود ووضعه في خانة كود المنتج");
      return;
    }

    const product = getProductByBarcodeLocal(code);

    if (product) {
      stopPatchScanner();

      if (typeof window.addToCart === "function") {
        try {
          window.addToCart(product);
        } catch {
          addToCartFixed(product);
        }
      } else {
        addToCartFixed(product);
      }

      const search = $("cashierSearch");
      if (search) {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }

      return;
    }

    stopPatchScanner();
    toast("لم يتم العثور على منتج بهذا الباركود");
  }

  async function openPatchScanner(mode = "sale", targetInputId = "") {
    await loadScriptOnce(HTML5_QRCODE_SRC);

    if (!window.Html5Qrcode) {
      toast("تعذر تحميل قارئ الباركود");
      return;
    }

    await stopPatchScanner();

    patchMode = mode || "sale";
    patchTargetInputId = targetInputId || "";

    const page = ensureScannerDom();
    const title = $("patchCameraTitle");
    const hint = $("patchScanHint");

    if (title) title.textContent = patchMode === "product" ? "قراءة باركود المنتج" : "قراءة باركود للبيع";
    if (hint) hint.textContent = patchMode === "product" ? "سيتم وضع الرقم في خانة كود المنتج" : "سيتم البحث عن المنتج وإضافته للسلة";

    page.classList.add("show");

    try {
      patchScanner = new Html5Qrcode("patchHtml5Reader", {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.AZTEC,
          Html5QrcodeSupportedFormats.PDF_417
        ],
        verbose: false
      });

      const config = {
        fps: 30,
        qrbox: function(viewfinderWidth, viewfinderHeight) {
          return {
            width: Math.floor(viewfinderWidth * 0.82),
            height: Math.floor(viewfinderHeight * 0.34)
          };
        },
        aspectRatio: 1.7777778,
        disableFlip: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [
            { focusMode: "continuous" },
            { exposureMode: "continuous" },
            { whiteBalanceMode: "continuous" }
          ]
        }
      };

      await patchScanner.start(
        { facingMode: "environment" },
        config,
        (decodedText, decodedResult) => {
          const now = Date.now();
          const code = String(decodedText || "").trim();

          if (!code) return;
          if (code === lastCode && now - lastTime < 1400) return;

          lastCode = code;
          lastTime = now;

          window.dispatchEvent(new CustomEvent("barcode:scanned", {
            detail: {
              code,
              result: decodedResult,
              mode: patchMode,
              targetInputId: patchTargetInputId
            }
          }));

          handlePatchScannedCode(code);
        },
        () => {}
      );

      patchRunning = true;
    } catch (err) {
      console.error(err);
      await stopPatchScanner();
      toast("اسمح باستخدام الكاميرا وتأكد أن الرابط HTTPS");
    }
  }

  function patchScannerButtons() {
    document.addEventListener("click", (e) => {
      const openScannerBtn = e.target.closest("#openScannerBtn");
      if (openScannerBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openPatchScanner("sale");
        return;
      }

      const scanProductBtn = e.target.closest("#scanProductBarcodeBtn");
      if (scanProductBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openPatchScanner("product", "productBarcode");
        return;
      }

      const floatingClose = e.target.closest("#floatingScannerCloseBtn");
      if (floatingClose) {
        e.preventDefault();
        e.stopImmediatePropagation();
        stopPatchScanner();
      }
    }, true);

    window.openScanner = function (mode = "sale", targetInputId = "") {
      return openPatchScanner(mode, targetInputId);
    };

    window.openFloatingProductBarcodeScanner = function (targetInputId = "productBarcode") {
      return openPatchScanner("product", targetInputId);
    };

    window.stopScanner = stopPatchScanner;
    window.stopFloatingScanner = stopPatchScanner;
  }

  function patchManualBarcode() {
    window.openManualBarcode = function () {
      const code = prompt("أدخل الباركود أو كود المنتج");
      if (!code) return;

      const product = getProductByBarcodeLocal(code);
      if (product) addToCartFixed(product);
      else toast("لم يتم العثور على منتج بهذا الكود");
    };
  }

  function patchCartCalculations() {
    window.priceForLine = priceForLineFixed;

    window.addToCart = function (product, selectedUnit = "") {
      return addToCartFixed(product, selectedUnit);
    };

    window.updateCartLine = function (lineId, patch = {}, rerender = true) {
      const st = getState();
      if (!st) return;

      const line = st.cart.find(x => x.id === lineId);
      if (!line) return;

      Object.assign(line, patch);

      const product = (st.products || []).find(p => p.id === line.productId);
      if (!product) {
        if (rerender && typeof window.renderCart === "function") window.renderCart();
        return;
      }

      const selectedUnit = line.selectedUnit || getDefaultSaleUnitLocal(product);
      const qty = cleanNumber(line.qty, 0);
      Object.assign(line, priceForLineFixed(product, qty, selectedUnit));

      if (rerender && typeof window.renderCart === "function") {
        window.renderCart();
      } else if (typeof window.calculateCartTotals === "function") {
        const totals = window.calculateCartTotals();
        if ($("cartSubtotal")) $("cartSubtotal").textContent = money(totals.subtotal);
        if ($("cartDiscount")) $("cartDiscount").textContent = money(totals.discount);
        if ($("cartTotal")) $("cartTotal").textContent = money(totals.total);

        const row = document.querySelector(`[data-cart-line="${CSS.escape(lineId)}"]`);
        if (row) {
          const totalEl = row.querySelector(".line-total");
          if (totalEl) totalEl.textContent = money(line.total);
        }
      }
    };

    document.addEventListener("input", (e) => {
      const qtyInput = e.target.closest("[data-change-cart-qty]");
      if (!qtyInput) return;

      const st = getState();
      if (!st) return;

      const line = st.cart.find(x => x.id === qtyInput.dataset.changeCartQty);
      if (!line) return;

      e.stopImmediatePropagation();
      window.updateCartLine(line.id, { qty: qtyInput.value }, false);
    }, true);

    document.addEventListener("change", (e) => {
      const unitInput = e.target.closest("[data-change-cart-unit]");
      if (!unitInput) return;

      const st = getState();
      if (!st) return;

      const line = st.cart.find(x => x.id === unitInput.dataset.changeCartUnit);
      if (!line) return;

      e.stopImmediatePropagation();
      window.updateCartLine(line.id, { selectedUnit: unitInput.value }, true);
    }, true);
  }

  function calculateInventorySummary() {
    const st = getState();
    const products = st?.products || [];

    return products.reduce((acc, p) => {
      const product = normalizeProductLocal(p);
      const stock = cleanNumber(product.stock);
      const cost = cleanNumber(product.costPrice);
      const sale = cleanNumber(product.salePrice);

      acc.count += stock;
      acc.costValue += stock * cost;
      acc.saleValue += stock * sale;
      acc.expectedProfit += stock * (sale - cost);

      return acc;
    }, {
      count: 0,
      costValue: 0,
      saleValue: 0,
      expectedProfit: 0
    });
  }

  function renderInventorySummary() {
    const page = $("page-inventory");
    if (!page) return;

    let box = $("patchInventorySummary");
    const card = page.querySelector(".card");

    if (!box) {
      box = document.createElement("div");
      box.id = "patchInventorySummary";
      box.className = "patch-inventory-summary";

      if (card) {
        card.parentNode.insertBefore(box, card);
      } else {
        page.appendChild(box);
      }
    }

    const s = calculateInventorySummary();

    box.innerHTML = `
      <div class="patch-inventory-stat dark">
        <span><i class="fa-solid fa-boxes-stacked"></i> عدد المخزون الأساسي</span>
        <b>${s.count.toFixed(3).replace(/\.?0+$/, "")}</b>
      </div>

      <div class="patch-inventory-stat">
        <span><i class="fa-solid fa-coins"></i> رصيد المخزون بسعر الجملة</span>
        <b>${money(s.costValue)}</b>
      </div>

      <div class="patch-inventory-stat gold">
        <span><i class="fa-solid fa-tags"></i> رصيد المخزون بسعر البيع</span>
        <b>${money(s.saleValue)}</b>
      </div>

      <div class="patch-inventory-stat green">
        <span><i class="fa-solid fa-arrow-trend-up"></i> الأرباح المتوقعة</span>
        <b>${money(s.expectedProfit)}</b>
      </div>
    `;
  }

  function patchRenderAllAndInventory() {
    const oldRenderAll = window.renderAll;
    if (typeof oldRenderAll === "function") {
      window.renderAll = function (...args) {
        const r = oldRenderAll.apply(this, args);
        setTimeout(renderInventorySummary, 0);
        return r;
      };
    }

    const oldRenderInventory = window.renderInventory;
    if (typeof oldRenderInventory === "function") {
      window.renderInventory = function (...args) {
        const r = oldRenderInventory.apply(this, args);
        setTimeout(renderInventorySummary, 0);
        return r;
      };
    }

    setInterval(renderInventorySummary, 2500);
    renderInventorySummary();
  }

  function normalizeName(name) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function isDuplicateCustomerName(name, exceptId = "") {
    const st = getState();
    const n = normalizeName(name);
    if (!n || !st) return false;

    return (st.customers || []).some(c =>
      c.id !== exceptId &&
      normalizeName(c.name) === n
    );
  }

  function patchDebtDuplicateProtection() {
    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (!form) return;

      if (form.id === "debtCustomerForm") {
        const id = $("debtCustomerId")?.value || "";
        const name = $("debtCustomerName")?.value || "";

        if (isDuplicateCustomerName(name, id)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toast("اسم الزبون موجود مسبقًا، لا يمكن إضافته مرتين");
        }
      }

      if (form.id === "quickDebtCustomerForm") {
        const name = $("quickDebtCustomerName")?.value || "";
        const phone = $("quickDebtCustomerPhone")?.value || "";
        const st = getState();

        const existing = (st?.customers || []).find(c =>
          normalizeName(c.name) === normalizeName(name) ||
          (phone.trim() && String(c.phone || "").trim() === phone.trim())
        );

        if (existing) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toast("الزبون موجود مسبقًا، اختره من القائمة بدل إضافته مرة ثانية");

          const listItem = document.querySelector(`[data-select-debt-customer="${CSS.escape(existing.id)}"]`);
          if (listItem) listItem.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }, true);

    const oldEnsureCustomer = window.ensureCustomer;
    window.ensureCustomer = function (name, phone) {
      const st = getState();
      const n = normalizeName(name);
      const p = String(phone || "").trim();

      const existing = (st?.customers || []).find(c =>
        (p && String(c.phone || "").trim() === p) ||
        (n && normalizeName(c.name) === n)
      );

      if (existing) {
        existing.name = name || existing.name;
        existing.phone = phone || existing.phone;
        existing.updatedAt = Date.now();
        return existing;
      }

      if (typeof oldEnsureCustomer === "function") return oldEnsureCustomer(name, phone);

      const customer = {
        id: `cus_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: name || "زبون",
        phone,
        balance: 0,
        totalSales: 0,
        totalPaid: 0,
        invoicesCount: 0,
        dueDate: "",
        payments: [],
        manualDebts: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      st.customers.push(customer);
      if (typeof window.saveLocal === "function") window.saveLocal("customers", customer, true);
      return customer;
    };
  }

  function exposeModuleFunctionsIfHidden() {
    const names = [
      "state",
      "cleanNumber",
      "money",
      "toast",
      "renderAll",
      "renderCart",
      "renderInventory",
      "calculateCartTotals",
      "getProductByBarcode",
      "normalizeProduct",
      "getDefaultSaleUnit",
      "getUnitFactor",
      "getUnitText",
      "saveLocal",
      "ensureCustomer",
      "addToCart"
    ];

    const scriptText = [...document.scripts]
      .filter(s => s.type === "module")
      .map(s => s.textContent || "")
      .join("\n");

    if (!scriptText.includes("const state =") && !scriptText.includes("function addToCart")) return;

    const patch = document.createElement("script");
    patch.type = "module";
    patch.textContent = `
      try {
        if (typeof state !== "undefined") window.state = state;
        if (typeof cleanNumber !== "undefined") window.cleanNumber = cleanNumber;
        if (typeof money !== "undefined") window.money = money;
        if (typeof toast !== "undefined") window.toast = toast;
        if (typeof renderAll !== "undefined") window.renderAll = renderAll;
        if (typeof renderCart !== "undefined") window.renderCart = renderCart;
        if (typeof renderInventory !== "undefined") window.renderInventory = renderInventory;
        if (typeof calculateCartTotals !== "undefined") window.calculateCartTotals = calculateCartTotals;
        if (typeof getProductByBarcode !== "undefined") window.getProductByBarcode = getProductByBarcode;
        if (typeof normalizeProduct !== "undefined") window.normalizeProduct = normalizeProduct;
        if (typeof getDefaultSaleUnit !== "undefined") window.getDefaultSaleUnit = getDefaultSaleUnit;
        if (typeof getUnitFactor !== "undefined") window.getUnitFactor = getUnitFactor;
        if (typeof getUnitText !== "undefined") window.getUnitText = getUnitText;
        if (typeof saveLocal !== "undefined") window.saveLocal = saveLocal;
        if (typeof ensureCustomer !== "undefined") window.ensureCustomer = ensureCustomer;
        if (typeof addToCart !== "undefined") window.addToCart = addToCart;
        window.dispatchEvent(new CustomEvent("cashier:module-exported"));
      } catch (e) {
        console.warn("cashier module export failed", e);
      }
    `;
    document.body.appendChild(patch);
  }

  async function init() {
    log("loading");

    exposeModuleFunctionsIfHidden();

    const ok = await waitForApp();
    if (!ok) {
      console.warn("cashier-barcode-patch: لم أجد state الخاصة بالتطبيق. تأكد أن الباتش بعد كود التطبيق.");
      toast("ملف الباتش لازم يكون بعد كود التطبيق الأصلي");
      return;
    }

    await loadScriptOnce(HTML5_QRCODE_SRC);

    patchScannerButtons();
    patchManualBarcode();
    patchCartCalculations();
    patchRenderAllAndInventory();
    patchDebtDuplicateProtection();

    window.CashierBarcodePatch = {
      version: PATCH_VERSION,
      openScanner: openPatchScanner,
      stopScanner: stopPatchScanner,
      renderInventorySummary
    };

    log("ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && patchRunning) stopPatchScanner();
  });

  window.addEventListener("beforeunload", () => {
    if (patchRunning) stopPatchScanner();
  });
})();