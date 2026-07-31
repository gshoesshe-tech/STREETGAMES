
/* STREETGAMES Store System
   - Handles Landing, Shop, and Admin logic
   - Requires Supabase setup in config.js
*/

const SUPABASE_URL = (window.__SUPABASE_URL__ || '').trim();
const SUPABASE_ANON_KEY = (window.__SUPABASE_ANON_KEY__ || '').trim();

let __sb = null;

// --- Helper Functions ---

// 1. FIX: Added the missing money formatting function
function money(val) {
  return '₱' + (Number(val) || 0).toLocaleString('en-US');
}

function hasSupabase() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && typeof window.supabase.createClient === 'function');
}

function getSupabase() {
  if (!hasSupabase()) return null;
  if (!__sb) __sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return __sb;
}

function clampInt(v, min = 1) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || isNaN(n)) return min;
  return Math.max(min, n);
}

// Shortcut selectors
const $ = (sel, p = document) => p.querySelector(sel);
const $$ = (sel, p = document) => p.querySelectorAll(sel);


// --- Image URL helper ---
function toCDN(url) {
  return String(url || "").trim();
}



// ---------------- LANDING (index.html) ----------------
// 2. FIX: Added logic for the Landing page
function initLanding() {
  const enterBtn = $("#enterBtn");
  const fade = $("#enterFade");
  const video = $("#landingVideo");
  const soundBtn = $("#soundBtn");

  // Handle Enter
  enterBtn?.addEventListener("click", () => {
    // Fade out effect
    fade.classList.add("is-on");
    // Wait for transition then go to shop
    setTimeout(() => {
      window.location.href = "./shop.html";
    }, 450);
  });

  // Handle Sound Toggle
  soundBtn?.addEventListener("click", () => {
    if(!video) return;
    video.muted = !video.muted;
    // Optional: Visual feedback
    soundBtn.style.opacity = video.muted ? "0.6" : "1";
  });
}



// ---------------- SOLD OUT + FIXED PRODUCT PRICING ----------------
const PRICING_GROUPS = Object.freeze({
  NONE: "NONE"
});

const PRICING_RULES = Object.freeze({});

function normalizeCategoryName(category = "") {
  const raw = String(category || "").trim();
  if (!raw) return "UNCATEGORIZED";

  const c = raw
    .toUpperCase()
    .replace(/[_–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (c === "ALL") return "ALL";

  if (
    c.includes("A FRAME") ||
    c.includes("AFRAME") ||
    c.includes("A-FRAME")
  ) return "A-FRAME CAPS";

  if (
    c.includes("CLOSE CAP") ||
    c.includes("CLOSED CAP") ||
    c === "CAP" ||
    c === "CAPS"
  ) return "CLOSED CAPS";

  return c;
}

function normalizePricingGroup(value = "") {
  const group = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PRICING_GROUPS, group) ? group : PRICING_GROUPS.NONE;
}

function productSignature(prod = {}) {
  return [prod?.name, prod?.code, prod?.sku, prod?.category]
    .map((value) => String(value || "").trim().toUpperCase())
    .join(" ");
}

function inferPricingGroup() {
  return PRICING_GROUPS.NONE;
}

function getProductCategory(prod = {}) {
  return normalizeCategoryName(prod?.category);
}

function getPricingRule(prodOrGroup = {}) {
  const group = typeof prodOrGroup === "string"
    ? normalizePricingGroup(prodOrGroup)
    : inferPricingGroup(prodOrGroup);
  return PRICING_RULES[group] || null;
}

function getTotalPricingGroupQty(group, extraQty = 0, excludeCartKey = "") {
  const normalizedGroup = normalizePricingGroup(group);
  const current = cart.items
    .filter((item) => {
      const itemGroup = inferPricingGroup(item);
      const itemKey = String(item?.cart_key || getCartItemKey(item?.id, item?.selected_size || ""));
      return itemGroup === normalizedGroup && (!excludeCartKey || itemKey !== excludeCartKey);
    })
    .reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  return current + (Number(extraQty) || 0);
}

function getTierForQty(rule, qty) {
  if (!rule?.tiers?.length) return null;
  const q = clampInt(qty, rule.minimum || 1);
  return rule.tiers.find((tier) => q >= tier.min && q <= tier.max) || rule.tiers[rule.tiers.length - 1];
}

function getPricingGroupUnitPrice(group, qty) {
  const rule = getPricingRule(group);
  const tier = getTierForQty(rule, qty);
  return tier ? Number(tier.price) || 0 : 0;
}

function syncCartWholesalePricing() {
  if (!cart || !Array.isArray(cart.items)) return;

  const totals = new Map();
  cart.items.forEach((item) => {
    item.category = getProductCategory(item);
    item.pricing_group = inferPricingGroup(item);
    if (item.pricing_group === PRICING_GROUPS.NONE) return;
    totals.set(item.pricing_group, (totals.get(item.pricing_group) || 0) + (Number(item.qty) || 0));
  });

  cart.items.forEach((item) => {
    const group = inferPricingGroup(item);
    const rule = getPricingRule(group);
    if (!rule) return;
    item.pricing_group = group;
    item.price = getPricingGroupUnitPrice(group, totals.get(group) || rule.minimum || 1);
  });
}

function getMinQtyForProduct(prod) {
  const rule = getPricingRule(prod);
  return rule?.minimum || 1;
}

function getUnitPriceForProduct(prod, qty) {
  const group = inferPricingGroup(prod);
  const rule = getPricingRule(group);
  if (!rule) return Number(prod?.price) || 0;

  const cleanSize = String(prod?.selected_size || "").trim();
  const key = String(prod?.cart_key || getCartItemKey(prod?.id, cleanSize));
  const existing = cart.items.find((item) => String(item.cart_key || getCartItemKey(item.id, item.selected_size || "")) === key);
  const projectedQty = getTotalPricingGroupQty(group, Number(qty) || 0, existing ? key : "");
  return getPricingGroupUnitPrice(group, projectedQty);
}

function getCartUnitPrice(item) {
  const group = inferPricingGroup(item);
  const rule = getPricingRule(group);
  if (!rule) return Number(item?.price) || 0;
  return getPricingGroupUnitPrice(group, getTotalPricingGroupQty(group));
}

// ---------------- SHOP (shop.html) ----------------
const cart = {
  items: [],
};

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("streetgames_cart_v1") || "[]") || [];
    cart.items = raw.map((it) => {
      const selectedSize = String(it?.selected_size || "").trim();
      return {
        ...it,
        category: getProductCategory(it),
        pricing_group: inferPricingGroup(it),
        selected_size: selectedSize,
        cart_key: String(it?.cart_key || getCartItemKey(it?.id, selectedSize))
      };
    });
    syncCartWholesalePricing();
    localStorage.setItem("streetgames_cart_v1", JSON.stringify(cart.items));
  } catch {
    cart.items = [];
  }
}

function saveCart() {
  syncCartWholesalePricing();
  localStorage.setItem("streetgames_cart_v1", JSON.stringify(cart.items));
}

function cartTotalQty() {
  return cart.items.reduce((a, it) => a + (Number(it.qty) || 0), 0);
}

function cartSubtotal() {
  syncCartWholesalePricing();
  return cart.items.reduce((a, it) => a + getCartUnitPrice(it) * (Number(it.qty) || 0), 0);
}

function getCartItemKey(id, selectedSize = "") {
  const sizeKey = String(selectedSize || "").trim().toUpperCase();
  return `${String(id)}::${sizeKey}`;
}

function findCartItem(id, selectedSize = "") {
  const key = getCartItemKey(id, selectedSize);
  return cart.items.find(x => String(x.cart_key || getCartItemKey(x.id, x.selected_size || "")) === key);
}

function addToCart(prod, qty, selectedSize = "") {
  if (prod?.sold_out === true) {
    alert("This item is currently sold out.");
    return;
  }

  const minQty = getMinQtyForProduct(prod);
  const q = clampInt(qty, minQty);
  const cleanSize = String(selectedSize || "").trim();
  const existing = findCartItem(prod.id, cleanSize);
  const normalizedCategory = getProductCategory(prod);
  const pricingGroup = inferPricingGroup(prod);

  if (existing) {
    existing.category = normalizedCategory;
    existing.pricing_group = pricingGroup;
    existing.qty = clampInt((existing.qty || 0) + q, minQty);
  } else {
    cart.items.push({
      id: prod.id,
      cart_key: getCartItemKey(prod.id, cleanSize),
      name: prod.name,
      price: Number(prod.price) || 0,
      code: prod.code || "",
      sku: prod.sku || "",
      category: normalizedCategory,
      pricing_group: pricingGroup,
      image: toCDN((prod.images && prod.images[0]) || prod.image_url || ""),
      qty: q,
      selected_size: cleanSize,
      sold_out: prod.sold_out === true
    });
  }

  syncCartWholesalePricing();
  saveCart();
}

function initShop() {
  loadCart();
  wireCartUI();

  const sb = getSupabase(); // Use the safe getter
  const grid = $("#productsGrid");
  const empty = $("#emptyState");

  // --- HELP MODAL (supports your shop.html help modal) ---
  const helpBtn = $("#helpBtn");
  const helpModal = $("#helpModal");
  const helpCloseEls = helpModal ? $$("[data-help-close='1']", helpModal) : [];

  function openHelp() {
    if (!helpModal) return;
    helpModal.classList.add("is-open");
    helpModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeHelp() {
    if (!helpModal) return;
    helpModal.classList.remove("is-open");
    helpModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  const facebookOrderLink = $("#facebookOrderLink");
  facebookOrderLink?.addEventListener("click", (event) => {
    const href = facebookOrderLink.getAttribute("href") || "";
    if (!href || href === "#") {
      event.preventDefault();
      alert("Add the Streetgames Facebook page URL in shop.html before launch.");
    }
  });

  if (helpBtn) helpBtn.addEventListener("click", openHelp);
  helpCloseEls.forEach(el => el.addEventListener("click", closeHelp));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpModal && helpModal.classList.contains("is-open")) {
      closeHelp();
    }
  });


  let pills = Array.from($$(".pill"));
  let activeFilter = "CLOSED CAPS"; // Default category

  // --- PRODUCTS DROPDOWN (supports your shop.html dropdown) ---
  const productsToggle = $("#productsToggle");
  const productsDropdown = document.querySelector(".productsDropdown");

  function openProductsDropdown() {
    if (!productsDropdown || !productsToggle) return;
    productsDropdown.classList.add("is-open");
    productsToggle.setAttribute("aria-expanded", "true");
  }

  function closeProductsDropdown() {
    if (!productsDropdown || !productsToggle) return;
    productsDropdown.classList.remove("is-open");
    productsToggle.setAttribute("aria-expanded", "false");
  }

  function toggleProductsDropdown() {
    if (!productsDropdown) return;
    if (productsDropdown.classList.contains("is-open")) closeProductsDropdown();
    else openProductsDropdown();
  }

  if (productsToggle && productsDropdown) {
    productsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleProductsDropdown();
    });

    // Close when clicking outside the dropdown
    document.addEventListener("click", (e) => {
      if (!productsDropdown.classList.contains("is-open")) return;
      const clickedInside = productsDropdown.contains(e.target) || productsToggle.contains(e.target);
      if (!clickedInside) closeProductsDropdown();
    });

    // Close on ESC (doesn't interfere with your other modals)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeProductsDropdown();
    });
  }


  // Filter Logic — event delegation also supports dynamically-added tank categories.
  function selectProductFilter(p) {
    if (!p) return;
    pills = Array.from($$(".pill"));
    pills.forEach(x => x.classList.remove("is-active"));
    p.classList.add("is-active");
    activeFilter = p.dataset.filter || "ALL";
    renderProducts(currentProducts, activeFilter);

    closeProductsDropdown();
    if (productsToggle) {
      const label = (p.textContent || "").trim() || "PRODUCTS";
      productsToggle.innerHTML = `${escapeHtml(label)} <span class="chev">▾</span>`;
      productsToggle.setAttribute("aria-expanded", "false");
    }
  }

  productsDropdown?.addEventListener("click", (event) => {
    const p = event.target.closest(".pill");
    if (!p || !productsDropdown.contains(p)) return;
    selectProductFilter(p);
  });


  let currentProducts = [];

  async function fetchProducts() {
    if (!sb) {
      console.warn("Supabase not initialized.");
      empty.textContent = "Supabase not connected. Check config.js.";
      empty.hidden = false;
      return;
    }

    const { data, error } = await sb
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      empty.hidden = false;
      empty.textContent = "Error loading products.";
      return;
    }

    currentProducts = (data || [])
      .filter(p => (p.status || "active") === "active");

    

    // Repair category/pricing metadata saved by older broken versions without
    // deleting the customer's cart or changing quantities.
    const productsById = new Map(currentProducts.map((prod) => [String(prod.id), prod]));
    let cartWasRepaired = false;
    cart.items.forEach((item) => {
      const source = productsById.get(String(item.id));
      if (!source) return;

      const repairedGroup = inferPricingGroup(source);
      const repairedCategory = getProductCategory(source);
      if (item.pricing_group !== repairedGroup || item.category !== repairedCategory) {
        item.pricing_group = repairedGroup;
        item.category = repairedCategory;
        cartWasRepaired = true;
      }
      if (source.name && item.name !== source.name) {
        item.name = source.name;
        cartWasRepaired = true;
      }
      const sourceImage = toCDN((source.images && source.images[0]) || source.image_url || "");
      if (sourceImage && item.image !== sourceImage) {
        item.image = sourceImage;
        cartWasRepaired = true;
      }
    });
    if (cartWasRepaired) saveCart();

    renderProducts(currentProducts, activeFilter);
  }

  function renderProducts(list, filter) {
    const normalizedFilter = normalizeCategoryName(filter || "ALL");
    const filtered = (normalizedFilter === "ALL")
      ? list
      : list.filter((p) => getProductCategory(p) === normalizedFilter);

    grid.innerHTML = "";
    empty.hidden = filtered.length !== 0;

    filtered.forEach(prod => {
      const img = toCDN((prod.images && prod.images[0]) || prod.image_url || "");
      const isSoldOut = prod.sold_out === true;
      const card = document.createElement("div");
      card.className = "card" + (isSoldOut ? " is-soldout" : "");
      card.innerHTML = `
        <div class="imgWrap">
          <img class="card__img" loading="lazy" decoding="async" src="${escapeHtmlAttr(img)}" alt="${escapeHtmlAttr(prod.name || "")}" onerror="this.style.opacity=.2" />
          ${isSoldOut ? `
            <div class="soldBadge">SOLD OUT</div>
            <div class="soldOverlay"><div class="soldCenter">UNAVAILABLE</div></div>
          ` : ""}
        </div>
        <div class="card__body">
          <div class="card__name">${escapeHtml(prod.name || "")}</div>
          <div class="card__price">${isSoldOut ? "Sold Out" : money(getUnitPriceForProduct(prod, getMinQtyForProduct(prod)))}</div>
        </div>
      `;
      if (!isSoldOut) {
        card.addEventListener("click", () => openProductModal(prod));
      }
      grid.appendChild(card);
    });
  }

  // Product modal
  const modal = $("#productModal");
  const modalCloseEls = $$("[data-close='1']", modal);
  const pMain = $("#pMainImg");
  const pThumbs = $("#pThumbs");
  const pName = $("#pName");
  const pPrice = $("#pPrice");
  const pCategory = $("#pCategory");
  const pSku = $("#pSku");
  const pCode = $("#pCode");
  const pSizeWrap = $("#pSizeWrap");
  const pSizeOptions = $("#pSizeOptions");
  const pSizeError = $("#pSizeError");
  const pMinus = $("#pMinus");
  const pPlus = $("#pPlus");
  const pQty = $("#pQty");
  const pAddBtn = $("#pAddBtn");
  let pWholesaleBox = null;

  let currentProd = null;
  let selectedSize = "";


  function ensureWholesaleBox() {
    if (pWholesaleBox) return pWholesaleBox;
    const meta = document.querySelector('.pview__meta');
    if (!meta) return null;
    pWholesaleBox = document.createElement('div');
    pWholesaleBox.className = 'wholesalePricing';
    meta.insertAdjacentElement('afterend', pWholesaleBox);
    return pWholesaleBox;
  }

  function updateWholesalePricingUI() {
    const box = ensureWholesaleBox();
    if (!box || !currentProd) return;

    const group = inferPricingGroup(currentProd);
    const rule = getPricingRule(group);
    if (!rule) {
      box.hidden = true;
      box.innerHTML = '';
      if (pPrice) pPrice.textContent = money(currentProd.base_price ?? currentProd.price);
      return;
    }

    const minQty = rule.minimum || 1;
    const q = clampInt(pQty?.value || minQty, minQty);
    const cleanSize = String(selectedSize || '').trim();
    const key = getCartItemKey(currentProd.id, cleanSize);
    const existing = cart.items.find((item) => String(item.cart_key || getCartItemKey(item.id, item.selected_size || '')) === key);
    const projectedTotal = getTotalPricingGroupQty(group, q, existing ? key : '');
    const price = getPricingGroupUnitPrice(group, projectedTotal);
    currentProd.price = price;
    if (pPrice) pPrice.textContent = `${money(price)} / pc`;

    const rows = rule.tiers.map((tier) => {
      const active = projectedTotal >= tier.min && projectedTotal <= tier.max;
      return `<div class="wholesalePricing__row ${active ? 'is-active' : ''}"><span>${escapeHtml(tier.label)}</span><strong>${money(tier.price)} each</strong></div>`;
    }).join('');

    box.hidden = false;
    box.innerHTML = `
      <div class="wholesalePricing__title">Wholesale Pricing</div>
      ${rows}
      <div class="wholesalePricing__note">Tier is based on all ${escapeHtml(rule.label.toLowerCase())} in cart. Current total after adding: ${projectedTotal} pcs</div>
    `;
  }

  function renderSizeOptions(prod) {
    const sizes = Array.isArray(prod?.sizes) ? prod.sizes : [];
    selectedSize = "";

    if (pSizeError) {
      pSizeError.hidden = true;
      pSizeError.textContent = "Please select a size.";
    }

    if (!pSizeWrap || !pSizeOptions) return;

    if (!sizes.length) {
      pSizeWrap.hidden = true;
      pSizeOptions.innerHTML = "";
      return;
    }

    pSizeWrap.hidden = false;
    pSizeOptions.innerHTML = "";

    sizes.forEach((size) => {
      const btn = document.createElement("button");
      btn.className = "sizeChip";
      btn.type = "button";
      btn.textContent = size;
      btn.setAttribute("data-size", size);
      btn.addEventListener("click", () => {
        selectedSize = size;
        pSizeOptions.querySelectorAll(".sizeChip").forEach((chip) => {
          chip.classList.toggle("is-active", chip.getAttribute("data-size") === size);
        });
        if (pSizeError) pSizeError.hidden = true;
      });
      pSizeOptions.appendChild(btn);
    });
  }

  function openProductModal(prod) {
    currentProd = normalizeProduct(prod);

    // images
    const imgs = currentProd.images.length ? currentProd.images : [currentProd.image_url].filter(Boolean);
    const main = imgs[0] || "";
    pMain.src = toCDN(main);
    pMain.alt = currentProd.name;

    pThumbs.innerHTML = "";
    imgs.forEach((u) => {
      const b = document.createElement("button");
      b.className = "thumb";
      b.type = "button";
      b.innerHTML = `<img loading="lazy" decoding="async" src="${escapeHtmlAttr(toCDN(u))}" alt="" />`;
      b.addEventListener("click", () => {
        pMain.src = toCDN(u);
      });
      pThumbs.appendChild(b);
    });

    pName.textContent = currentProd.name;
    const isWholesaleProduct = Boolean(getPricingRule(currentProd));
    const openingRule = getPricingRule(currentProd);
    const openingPrice = openingRule
      ? getPricingGroupUnitPrice(inferPricingGroup(currentProd), getTotalPricingGroupQty(inferPricingGroup(currentProd), getMinQtyForProduct(currentProd)))
      : Number(currentProd.base_price ?? currentProd.price) || 0;
    pPrice.textContent = openingRule ? `${money(openingPrice)} / pc` : money(openingPrice);
    pCategory.textContent = currentProd.category || "";
    pSku.textContent = currentProd.sku || "";
    pCode.textContent = currentProd.code || "";

    renderSizeOptions(currentProd);
    pQty.value = "1";
    updateWholesalePricingUI();
    syncAddBtn();

    if (currentProd.sold_out === true) {
      pAddBtn.textContent = "SOLD OUT";
      pAddBtn.disabled = true;
      pAddBtn.classList.add("is-disabled");
    } else {
      pAddBtn.disabled = false;
      pAddBtn.classList.remove("is-disabled");
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeProductModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentProd = null;
    selectedSize = "";
  }

  modalCloseEls.forEach(el => el.addEventListener("click", closeProductModal));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) closeProductModal();
  });

  function syncAddBtn() {
    if (!currentProd) return;
    if (currentProd.sold_out === true) {
      pAddBtn.textContent = "SOLD OUT";
      pAddBtn.disabled = true;
      pAddBtn.classList.add("is-disabled");
      return;
    }
    const minQty = getMinQtyForProduct(currentProd);
    const q = clampInt(pQty.value, minQty);
    pQty.value = String(q);
    currentProd.price = getUnitPriceForProduct(currentProd, q);

    const isWholesaleProduct = Boolean(getPricingRule(currentProd));

    if (pPrice) pPrice.textContent = isWholesaleProduct ? `${money(currentProd.price)} / pc` : money(currentProd.price);
    updateWholesalePricingUI();
    pAddBtn.textContent = `ADD ${q} TO CART`;
  }

  pQty.addEventListener("input", () => {
    if (!pQty.value) return syncAddBtn();
    const minQty = getMinQtyForProduct(currentProd);
    const q = clampInt(pQty.value, minQty);
    pQty.value = String(q);
    syncAddBtn();
  });

  pMinus.addEventListener("click", () => {
    const minQty = getMinQtyForProduct(currentProd);
    const q = clampInt(pQty.value, minQty);
    pQty.value = String(Math.max(minQty, q - 1));
    syncAddBtn();
  });

  pPlus.addEventListener("click", () => {
    const minQty = getMinQtyForProduct(currentProd);
    const q = clampInt(pQty.value, minQty);
    pQty.value = String(q + 1);
    syncAddBtn();
  });

  pAddBtn.addEventListener("click", () => {
    if (!currentProd) return;

    if (currentProd.sold_out === true) {
      alert("This item is currently sold out.");
      return;
    }

    if (Array.isArray(currentProd.sizes) && currentProd.sizes.length && !selectedSize) {
      if (pSizeError) {
        pSizeError.hidden = false;
        pSizeError.textContent = "Please select a size.";
      }
      return;
    }

    const q = clampInt(pQty.value, getMinQtyForProduct(currentProd));
    currentProd.price = getUnitPriceForProduct(currentProd, q);
    addToCart(currentProd, q, selectedSize);
    updateCartUI();
    closeProductModal();
    window.openCart(); // Open drawer
  });

  fetchProducts();
  updateCartUI();
}

function normalizeProduct(p) {
  return {
    id: p.id,
    name: p.name || "",
    price: Number(p.price) || 0,
    base_price: Number(p.price) || 0,
    pricing_group: inferPricingGroup(p),
    code: p.code || "",
    sku: p.sku || "",
    category: getProductCategory(p),
    image_url: p.image_url || "",
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
    sizes: Array.isArray(p.sizes) ? p.sizes.map((s) => String(s || "").trim()).filter(Boolean) : [],
    sold_out: p.sold_out === true
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeHtmlAttr(s) {
  return escapeHtml(s || "");
}


// ---------------- CART UI + CHECKOUT ----------------
function wireCartUI() {
  const cartBtn = $("#cartBtn");
  const overlay = $("#cartOverlay");
  const drawer = $("#cartDrawer");
  const closeBtn = $("#closeCartBtn");

  cartBtn?.addEventListener("click", openCart);
  overlay?.addEventListener("click", closeCart);
  closeBtn?.addEventListener("click", closeCart);

  function openCart() {
    if(!overlay || !drawer) return;
    overlay.hidden = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    updateCartUI();
  }
  function closeCart() {
    if(!overlay || !drawer) return;
    overlay.hidden = true;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  }

  window.openCart = openCart;
  window.closeCart = closeCart;

  // Checkout modal
  const checkoutBtn = $("#checkoutBtn");
  const checkoutModal = $("#checkoutModal");
  const checkoutCloseEls = $$("[data-close-checkout='1']", checkoutModal);
  const copyBtn = $("#copyOrderBtn");

  checkoutBtn?.addEventListener("click", async () => {
    if (!cart.items.length) return;

    const sb = getSupabase();
    if (sb) {
      const ids = cart.items.map((it) => it.id).filter(Boolean);
      if (ids.length) {
        const { data, error } = await sb.from("products").select("id,sold_out,status").in("id", ids);
        if (!error && Array.isArray(data)) {
          const unavailable = new Set(
            data
              .filter((p) => p.sold_out === true || (p.status && p.status !== "active"))
              .map((p) => String(p.id))
          );
          if (unavailable.size) {
            cart.items = cart.items.filter((it) => !unavailable.has(String(it.id)));
            saveCart();
            updateCartUI();
            alert("Some items are no longer available and were removed from your cart.");
            return;
          }
        }
      }
    }

    refreshOrderText();
    
    // --- FIX: Close the cart drawer so the modal is visible ---
    closeCart();
    
    checkoutModal.classList.add("is-open");
    checkoutModal.setAttribute("aria-hidden", "false");
  });

  checkoutCloseEls.forEach(el => el.addEventListener("click", () => {
    checkoutModal.classList.remove("is-open");
    checkoutModal.setAttribute("aria-hidden", "true");
  }));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && checkoutModal?.classList.contains("is-open")) {
      checkoutModal.classList.remove("is-open");
      checkoutModal.setAttribute("aria-hidden", "true");
    }
  });

  copyBtn?.addEventListener("click", async () => {
    const t = $("#orderText")?.value || "";
    try {
      await navigator.clipboard.writeText(t);
      const oldText = copyBtn.textContent;
      copyBtn.textContent = "COPIED ✅";
      setTimeout(() => (copyBtn.textContent = oldText), 1500);
    } catch {
      const ta = $("#orderText");
      ta?.select();
      document.execCommand("copy");
    }
  });

  ["#cName", "#cPhone", "#cAddress", "#cNotes"].forEach(sel => {
    const el = $(sel);
    el?.addEventListener("input", refreshOrderText);
  });

  function refreshOrderText() {
    const name = ($("#cName")?.value || "").trim();
    const phone = ($("#cPhone")?.value || "").trim();
    const address = ($("#cAddress")?.value || "").trim();
    const notes = ($("#cNotes")?.value || "").trim();

    const lines = [];
    lines.push("🛒 ORDER FORM – STREETGAMES");
    lines.push("");
    lines.push(`Name: ${name}`);
    lines.push(`Phone: ${phone}`);
    lines.push(`Address: ${address}`);
    if (notes) lines.push(`Notes: ${notes}`);
    lines.push("");
    lines.push("Order List:");
    lines.push("");

    syncCartWholesalePricing();

    // Group items by normalized category to prevent duplicate sections.
    const groups = new Map();
    cart.items.forEach(it => {
      const cat = getProductCategory(it);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(it);
    });

    const cats = Array.from(groups.keys()).sort((a, b) =>
      a.toUpperCase().localeCompare(b.toUpperCase())
    );

    cats.forEach(cat => {
      const items = groups.get(cat) || [];
      lines.push(`[${String(cat).toUpperCase()}]`);

      let catQty = 0;
      let catAmount = 0;

      items.forEach(it => {
        const qty = Number(it.qty) || 0;
        const baseLabel = it.sku || it.code || it.name;
        const sizeLabel = it.selected_size ? `${baseLabel} (Size: ${it.selected_size})` : baseLabel;
        lines.push(`• ${sizeLabel} – x${qty}`);

        catQty += qty;
        catAmount += getCartUnitPrice(it) * qty;
      });

      lines.push(`Category Qty: ${catQty}`);
      lines.push(`Category Amount: ${money(catAmount)}`);
      lines.push("");
    });

    // Overall totals
    const grandQty = cartTotalQty();
    lines.push(`Total Amount: ${money(cartSubtotal())}`);
    lines.push(`Total Quantity: ${grandQty}`);
    lines.push(`Total Items (Grand): ${grandQty}`);

    const out = lines.join("\n");
    const ta = $("#orderText");
    if (ta) ta.value = out;
  }
}

function updateCartUI() {
  syncCartWholesalePricing();
  const count = $("#cartCount");
  const itemsWrap = $("#cartItems");
  const subtotalEl = $("#cartSubtotal");
  const totalQtyEl = $("#cartTotalQty");

  if (count) count.textContent = String(cartTotalQty());
  if (subtotalEl) subtotalEl.textContent = money(cartSubtotal());
  if (totalQtyEl) totalQtyEl.textContent = String(cartTotalQty());

  if (!itemsWrap) return;

  itemsWrap.innerHTML = "";
  if (!cart.items.length) {
    const d = document.createElement("div");
    d.style.color = "rgba(255,255,255,.55)";
    d.style.padding = "14px 0";
    d.textContent = "Your cart is empty.";
    itemsWrap.appendChild(d);
    return;
  }

  cart.items.forEach(it => {
    const row = document.createElement("div");
    row.className = "cartItem";
    row.innerHTML = `
      <img class="cartItem__img" loading="lazy" decoding="async" src="${escapeHtmlAttr(toCDN(it.image || ""))}" alt="" onerror="this.style.opacity=.2" />
      <div>
        <div class="cartItem__name">${escapeHtml(it.name || "")}</div>
        <div class="cartItem__meta">${it.selected_size ? `Size: ${escapeHtml(it.selected_size)}` : ""}</div>
        <div class="cartItem__meta">${it.code ? `Code: ${escapeHtml(it.code)}` : ""}</div>
        <div class="cartItem__row">
          <div class="cartQty">
            <button type="button" data-dec="${escapeHtmlAttr(it.cart_key || getCartItemKey(it.id, it.selected_size || ''))}">−</button>
            <input type="number" min="1" step="1" value="${Number(it.qty) || 1}" data-qty="${escapeHtmlAttr(it.cart_key || getCartItemKey(it.id, it.selected_size || ''))}" />
            <button type="button" data-inc="${escapeHtmlAttr(it.cart_key || getCartItemKey(it.id, it.selected_size || ''))}">+</button>
          </div>
          <div style="color:rgba(255,255,255,.75);font-weight:700;">${money(getCartUnitPrice(it) * (Number(it.qty)||0))}</div>
        </div>
      </div>
      <button class="trashBtn" type="button" data-del="${escapeHtmlAttr(it.cart_key || getCartItemKey(it.id, it.selected_size || ''))}" aria-label="Remove item">🗑</button>
    `;
    itemsWrap.appendChild(row);
  });

  // Attach events
  itemsWrap.querySelectorAll("[data-dec]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-dec");
      const item = cart.items.find(x => String(x.cart_key || getCartItemKey(x.id, x.selected_size || '')) === String(key));
      if (!item) return;
      const minQty = getMinQtyForProduct(item);
      item.qty = Math.max(minQty, clampInt(item.qty, minQty) - 1);
      syncCartWholesalePricing();
      saveCart(); updateCartUI();
    });
  });

  itemsWrap.querySelectorAll("[data-inc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-inc");
      const item = cart.items.find(x => String(x.cart_key || getCartItemKey(x.id, x.selected_size || '')) === String(key));
      if (!item) return;
      const minQty = getMinQtyForProduct(item);
      item.qty = clampInt(item.qty, minQty) + 1;
      syncCartWholesalePricing();
      saveCart(); updateCartUI();
    });
  });

  itemsWrap.querySelectorAll("[data-qty]").forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.getAttribute("data-qty");
      const item = cart.items.find(x => String(x.cart_key || getCartItemKey(x.id, x.selected_size || '')) === String(key));
      if (!item) return;
      const minQty = getMinQtyForProduct(item);
      item.qty = clampInt(inp.value, minQty);
      syncCartWholesalePricing();
      saveCart(); updateCartUI();
    });
  });

  itemsWrap.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-del");
      cart.items = cart.items.filter(x => String(x.cart_key || getCartItemKey(x.id, x.selected_size || '')) !== String(key));
      syncCartWholesalePricing();
      saveCart(); updateCartUI();
    });
  });
}


// ---------------- ADMIN (admin.html) ----------------
function initAdmin() {
  const sb = getSupabase();
  const msgEl = document.getElementById('adminMsg');
  const authMsg = document.getElementById('authMsg');
  const authCard = document.getElementById('authCard');
  const adminApp = document.getElementById('adminApp');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const adminUser = document.getElementById('adminUser');

  const setMsg = (text, isErr = false) => {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.color = isErr ? 'rgba(255,90,90,.95)' : 'rgba(255,255,255,.70)';
  };

  const setAuthMsg = (text, isErr = false) => {
    if (!authMsg) return;
    authMsg.textContent = text || '';
    authMsg.style.color = isErr ? 'rgba(255,90,90,.95)' : 'rgba(255,255,255,.70)';
  };

  if (!sb) {
    setAuthMsg('Supabase not configured in config.js', true);
    return;
  }

  const aName = $('#aName');
  const aPrice = $('#aPrice');
  const aCode = $('#aCode');
  const aSku = $('#aSku');
  const aCategory = $('#aCategory');
  const aPricingGroup = $('#aPricingGroup');
  const aSizes = $('#aSizes');
  const aStatus = $('#aStatus');
  const aSoldOut = $('#aSoldOut');
  const aImageUrl = $('#aImageUrl');
  const addUrlBtn = $('#addUrlBtn');
  const aFiles = $('#aFiles');
  const uploadFilesBtn = $('#uploadFilesBtn');
  const imgList = $('#imgList');
  const createProductBtn = $('#createProductBtn');
  const adminProducts = $('#adminProducts');

  let stagedImages = [];
  let authReady = false;

  // Hide admin panel until Supabase confirms the user is an approved admin.
  if (adminApp) {
    adminApp.hidden = true;
    adminApp.style.display = 'none';
  }

  function showLogin() {
    const gate = authCard || document.getElementById('adminAuthGate') || document.getElementById('adminGate') || document.querySelector('.keyGate');
    const app = adminApp || document.querySelector('.adminWrap');

    if (gate) {
      gate.hidden = false;
      gate.style.display = '';
    }
    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }
    if (adminUser) adminUser.textContent = '';
    setMsg('');
  }

  function showAdmin(email) {
    const gate = authCard || document.getElementById('adminAuthGate') || document.getElementById('adminGate') || document.querySelector('.keyGate');
    const app = adminApp || document.querySelector('.adminWrap');

    if (gate) {
      gate.hidden = true;
      gate.style.display = 'none';
      gate.classList.remove('is-open');
    }
    if (app) {
      app.hidden = false;
      app.style.display = 'block';
    }
    if (adminUser) adminUser.textContent = email ? `Logged in: ${email}` : 'Logged in';
  }

  async function requireAdminSession() {
    const { data, error } = await sb.auth.getSession();
    if (error || !data?.session) {
      showLogin();
      return null;
    }

    const user = data.session.user;

    // Optional check: this works when you run the admins table SQL below.
    // RLS is still the real protection even if this check fails due to setup.
    const { data: adminRows, error: adminErr } = await sb
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .limit(1);

    if (adminErr || !adminRows || adminRows.length === 0) {
      showLogin();
      setAuthMsg('Logged in, but this account is not listed as an admin in Supabase.', true);
      await sb.auth.signOut();
      return null;
    }

    showAdmin(user.email);
    return user;
  }

  loginBtn?.addEventListener('click', async () => {
    const email = (loginEmail?.value || '').trim();
    const password = loginPassword?.value || '';
    if (!email || !password) return setAuthMsg('Enter your admin email and password.', true);

    loginBtn.disabled = true;
    setAuthMsg('Logging in…');

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMsg(`Login failed: ${error.message}`, true);
      loginBtn.disabled = false;
      return;
    }

    setAuthMsg('');
    loginBtn.disabled = false;
    const user = await requireAdminSession();
    if (user) loadAdminProducts();
  });

  [loginEmail, loginPassword].forEach((el) => {
    el?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn?.click();
    });
  });

  logoutBtn?.addEventListener('click', async () => {
    await sb.auth.signOut();
    showLogin();
  });

  sb.auth.onAuthStateChange(async (_event, session) => {
    if (!authReady) return;
    if (!session) showLogin();
  });

  function renderStaged() {
    if (!imgList) return;
    imgList.innerHTML = stagedImages.map((url, idx) => `
      <div class="imgChip">
        <img src="${escapeHtmlAttr(toCDN(url))}" alt="" loading="lazy" decoding="async" />
        <div class="imgChip__row">
          <button class="imgChip__btn" type="button" data-rm="${idx}">Remove</button>
          <span style="color:rgba(255,255,255,.45); font-size:11px;">${idx + 1}</span>
        </div>
      </div>
    `).join('');

    imgList.querySelectorAll('button[data-rm]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.getAttribute('data-rm'));
        stagedImages.splice(i, 1);
        renderStaged();
      });
    });
  }

  addUrlBtn?.addEventListener('click', () => {
    const u = (aImageUrl?.value || '').trim();
    if (!u) return;
    stagedImages.push(toCDN(u));
    if (aImageUrl) aImageUrl.value = '';
    renderStaged();
  });

  async function uploadOne(file) {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) throw new Error('Please log in first.');

    const safeName = String(file.name || 'image').replace(/[^a-z0-9_.-]/gi, '_');
    const path = `public/products/${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName}`;

    const { error } = await sb.storage.from('product_images').upload(path, file, { upsert: false });
    if (error) throw error;

    const { data } = sb.storage.from('product_images').getPublicUrl(path);
    return toCDN(data?.publicUrl || '');
  }

  uploadFilesBtn?.addEventListener('click', async () => {
    const files = Array.from(aFiles?.files || []);
    if (!files.length) return;

    uploadFilesBtn.disabled = true;
    setMsg('Uploading images…');

    try {
      for (const f of files) {
        const url = await uploadOne(f);
        if (url) stagedImages.push(url);
      }
      if (aFiles) aFiles.value = '';
      renderStaged();
      setMsg('Images uploaded ✅');
    } catch (e) {
      console.error(e);
      setMsg(`Upload failed: ${e?.message || e}`, true);
    } finally {
      uploadFilesBtn.disabled = false;
    }
  });

  async function loadAdminProducts() {
    if (!adminProducts) return;
    setMsg('Loading products…');

    const { data, error } = await sb.from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      setMsg(`Load failed: ${error.message}`, true);
      return;
    }

    setMsg('');
    const list = data || [];
    adminProducts.innerHTML = list.map((p) => {
      const img = toCDN((Array.isArray(p.images) && p.images[0]) ? p.images[0] : (p.image_url || ''));
      const sizeSummary = Array.isArray(p.sizes) && p.sizes.length ? `Sizes: ${p.sizes.join(', ')}` : null;
      const meta = [
        p.category ? `Category: ${p.category}` : null,
        `Pricing: ${inferPricingGroup(p)}`,
        p.code ? `Code: ${p.code}` : null,
        `₱${Number(p.price || 0)}`,
        sizeSummary,
        p.status ? `Status: ${p.status}` : null,
        p.sold_out ? 'SOLD OUT' : null,
      ].filter(Boolean).join(' • ');

      return `
        <div class="adminItem">
          <div class="adminItem__top">
            <div style="display:flex; gap:12px; align-items:center;">
              ${img ? `<img src="${escapeHtmlAttr(img)}" alt="" style="width:54px;height:54px;object-fit:cover;border:1px solid rgba(255,255,255,.12);" />` : ''}
              <div>
                <div class="adminItem__name">${escapeHtml(p.name || '')}</div>
                <div class="adminItem__meta">${escapeHtml(meta)}</div>
              </div>
            </div>
            <div class="adminItem__btns">
              <button class="btn btn--ghost" type="button" data-toggle-sold="${escapeHtmlAttr(p.id)}" data-sold="${p.sold_out ? '1' : '0'}">${p.sold_out ? 'Mark Available' : 'Mark Sold Out'}</button>
              <button class="btn btn--ghost" type="button" data-del="${escapeHtmlAttr(p.id)}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');


    adminProducts.querySelectorAll('button[data-toggle-sold]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-sold');
        const current = btn.getAttribute('data-sold') === '1';
        setMsg(current ? 'Marking as available…' : 'Marking as sold out…');
        const { error: updErr } = await sb.from('products').update({ sold_out: !current }).eq('id', id);
        if (updErr) {
          setMsg(`Update failed: ${updErr.message}`, true);
        } else {
          setMsg(!current ? 'Marked sold out ✅' : 'Marked available ✅');
          loadAdminProducts();
        }
      });
    });

    adminProducts.querySelectorAll('button[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this product?')) return;
        const id = btn.getAttribute('data-del');
        setMsg('Deleting…');
        const { error: delErr } = await sb.from('products').delete().eq('id', id);
        if (delErr) {
          setMsg(`Delete failed: ${delErr.message}`, true);
        } else {
          setMsg('Deleted ✅');
          loadAdminProducts();
        }
      });
    });
  }

  createProductBtn?.addEventListener('click', async () => {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) return setMsg('Please log in first.', true);

    const name = (aName?.value || '').trim();
    const price = Number((aPrice?.value || '').trim());
    const code = (aCode?.value || '').trim();
    const sku = (aSku?.value || '').trim();
    const category = (aCategory?.value || 'CLOSED CAPS');
    const pricing_group = normalizePricingGroup(aPricingGroup?.value || 'NONE');
    const sizes = String(aSizes?.value || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
    const status = (aStatus?.value || 'active');
    const sold_out = Boolean(aSoldOut?.checked);

    if (!name) return setMsg('Name is required.', true);
    if (!Number.isFinite(price) || price < 0) return setMsg('Valid price is required.', true);

    const payload = {
      name,
      price,
      code,
      sku,
      category,
      pricing_group,
      sizes,
      status,
      sold_out,
      images: stagedImages,
      image_url: stagedImages[0] || null
    };

    createProductBtn.disabled = true;
    setMsg('Creating…');

    const { error } = await sb.from('products').insert(payload);

    if (error) {
      console.error(error);
      setMsg(`Failed: ${error.message}`, true);
    } else {
      setMsg('Created ✅');
      if (aName) aName.value = '';
      if (aPrice) aPrice.value = '';
      if (aCode) aCode.value = '';
      if (aSku) aSku.value = '';
      if (aSizes) aSizes.value = '';
      if (aPricingGroup) aPricingGroup.value = 'NONE';
      if (aSoldOut) aSoldOut.checked = false;
      stagedImages = [];
      renderStaged();
      loadAdminProducts();
    }
    createProductBtn.disabled = false;
  });

  (async () => {
    authReady = true;
    const user = await requireAdminSession();
    if (user) loadAdminProducts();
  })();
}


// ---------------- BOOTSTRAP ----------------
function bootstrap() {
  const page = document.body?.dataset?.page;
  if (page === 'landing') initLanding();
  if (page === 'shop') initShop();
  if (page === 'admin') initAdmin();
}

document.addEventListener('DOMContentLoaded', bootstrap);
