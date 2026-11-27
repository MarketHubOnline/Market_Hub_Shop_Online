// =========================================================
// SHOPPING CART, SHOPEE-STYLE GROUPED CHECKOUT & AUTO-VOUCHERS
// =========================================================
import { supabaseClient, state, PLACEHOLDER_IMG } from './config.js';
import { escapeHtml, formatPeso, getProductImages, showToast } from './utils.js';
import { renderCheckoutQrSellers } from './checkout.js';

let cartActiveVouchers = [];
let appliedVoucherObj = null;

export function saveCartToStorage() {
  localStorage.setItem('markethub_cart', JSON.stringify(state.cart));
  updateCartBadge();
}

export function updateCartBadge() {
  const totalQty = state.cart.reduce((sum, item) => sum + Number(item.qty || 1), 0);
  const badge = document.getElementById('cart-count');
  if (badge) badge.textContent = totalQty;
}

export function addToCartById(productId, qty = 1) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;
  if (state.currentUser && prod.seller_id === state.currentUser.id) {
    return showToast('You cannot buy your own listing.', 'warning');
  }
  const stock = Number(prod.stock ?? 99);
  if (stock <= 0) return showToast('This item is out of stock.', 'error');

  const isFreeShip = prod.is_free_shipping === true;
  const liveShopName = state.allSellers.find(s => s.user_id === prod.seller_id)?.shop_name || prod.shop_name || 'Verified Shop';
  const existing = state.cart.find(c => String(c.product_id) === String(productId));
  if (existing) {
    existing.qty = Math.min(stock, existing.qty + qty);
    existing.shop_name = liveShopName;
    existing.cost_price = Number(prod.cost_price || 0);
    existing.is_free_shipping = isFreeShip;
    existing.shipping_fee = isFreeShip ? 0 : Number(prod.shipping_fee || 0);
  } else {
    state.cart.push({
      product_id: prod.id,
      seller_id: prod.seller_id,
      shop_name: liveShopName,
      title: prod.title,
      price: Number(prod.price),
      cost_price: Number(prod.cost_price || 0),
      is_free_shipping: isFreeShip,
      shipping_fee: isFreeShip ? 0 : Number(prod.shipping_fee || 0),
      image_url: getProductImages(prod)[0],
      qty: Math.min(stock, qty)
    });
  }
  saveCartToStorage();
  showToast(`Added "${prod.title}" to cart!`);
}

export function addFromPdpToCart() {
  if (!state.activePdpProduct) return;
  const qty = parseInt(document.getElementById('pdp-qty').value, 10) || 1;
  addToCartById(state.activePdpProduct.id, qty);
}

export function quickBuyNowById(productId) {
  addToCartById(productId, 1);
  openCartModal();
}

export function buyNowFromPdp() {
  if (!state.activePdpProduct) return;
  const qty = parseInt(document.getElementById('pdp-qty').value, 10) || 1;
  addToCartById(state.activePdpProduct.id, qty);
  openCartModal();
}

export async function openCartModal() {
  populateBarangaySuggestions();
  syncCheckoutAddressFromProfile();
  document.getElementById('cart-modal').classList.remove('hidden');
  await fetchActiveVouchersForCartSellers();
  renderCartModal();
}

export function closeCartModal() {
  document.getElementById('cart-modal').classList.add('hidden');
}

export function populateBarangaySuggestions() {
  const datalist = document.getElementById('barangay-suggestions');
  if (!datalist) return;
  const seen = new Set();
  state.allSellers.forEach(s => {
    if (Array.isArray(s.barangay_rates)) {
      s.barangay_rates.forEach(r => { if (r.name) seen.add(r.name); });
    }
  });
  datalist.innerHTML = Array.from(seen).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

export function syncCheckoutAddressFromProfile() {
  const nEl = document.getElementById('checkout-name');
  const pEl = document.getElementById('checkout-phone');
  const bEl = document.getElementById('checkout-barangay');
  const aEl = document.getElementById('checkout-address');

  if (state.currentProfile) {
    if (nEl && !nEl.value && state.currentProfile.full_name) nEl.value = state.currentProfile.full_name;
    if (pEl && !pEl.value && state.currentProfile.phone) pEl.value = state.currentProfile.phone;
    if (bEl && !bEl.value && state.currentProfile.default_barangay) bEl.value = state.currentProfile.default_barangay;
    if (aEl && !aEl.value && state.currentProfile.default_address) aEl.value = state.currentProfile.default_address;
  }

  refreshCheckoutAddressCard();
}

export function refreshCheckoutAddressCard() {
  const nameVal = document.getElementById('checkout-name')?.value.trim() || '';
  const phoneVal = document.getElementById('checkout-phone')?.value.trim() || '';
  const brgyVal = document.getElementById('checkout-barangay')?.value.trim() || '';
  const addrVal = document.getElementById('checkout-address')?.value.trim() || '';

  const dispRow = document.getElementById('checkout-address-display');
  const editBox = document.getElementById('checkout-address-edit-box');
  const namePhoneEl = document.getElementById('disp-checkout-name-phone');
  const fullAddrEl = document.getElementById('disp-checkout-full-address');

  const isComplete = Boolean(nameVal && phoneVal && brgyVal && addrVal);

  if (isComplete) {
    if (namePhoneEl) namePhoneEl.textContent = `${nameVal} (${phoneVal})`;
    if (fullAddrEl) fullAddrEl.textContent = `${brgyVal}, ${addrVal}`;
    dispRow?.classList.remove('hidden');
    editBox?.classList.add('hidden');
  } else {
    dispRow?.classList.add('hidden');
    editBox?.classList.remove('hidden');
  }
}

export function toggleCheckoutAddressEdit(showEdit) {
  const dispRow = document.getElementById('checkout-address-display');
  const editBox = document.getElementById('checkout-address-edit-box');
  if (showEdit) {
    dispRow?.classList.add('hidden');
    editBox?.classList.remove('hidden');
  } else {
    refreshCheckoutAddressCard();
    recalculateCartCheckoutTotals();
  }
}

export async function saveCheckoutAddressToProfile() {
  const nameVal = document.getElementById('checkout-name')?.value.trim() || '';
  const phoneVal = document.getElementById('checkout-phone')?.value.trim() || '';
  const brgyVal = document.getElementById('checkout-barangay')?.value.trim() || '';
  const addrVal = document.getElementById('checkout-address')?.value.trim() || '';

  if (!nameVal || !phoneVal || !brgyVal || !addrVal) {
    return showToast('Please fill in Name, Phone, Barangay, and Address.', 'warning');
  }

  if (supabaseClient && state.currentUser) {
    const { error } = await supabaseClient
      .from('profiles')
      .update({
        full_name: nameVal,
        phone: phoneVal,
        default_barangay: brgyVal,
        default_address: addrVal
      })
      .eq('id', state.currentUser.id);

    if (!error && state.currentProfile) {
      state.currentProfile.full_name = nameVal;
      state.currentProfile.phone = phoneVal;
      state.currentProfile.default_barangay = brgyVal;
      state.currentProfile.default_address = addrVal;
    }
  }

  refreshCheckoutAddressCard();
  recalculateCartCheckoutTotals();
  showToast('Delivery address updated!');
}

async function fetchActiveVouchersForCartSellers() {
  if (!supabaseClient || !state.cart.length) {
    cartActiveVouchers = [];
    return;
  }
  const sellerIds = [...new Set(state.cart.map(i => i.seller_id).filter(Boolean))];
  if (!sellerIds.length) {
    cartActiveVouchers = [];
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('vouchers')
      .select('*')
      .in('seller_id', sellerIds)
      .eq('is_active', true);

    if (error) {
      cartActiveVouchers = [];
      return;
    }

    const now = new Date();
    cartActiveVouchers = (data || []).filter(v => {
      const notExpired = !v.expires_at || new Date(v.expires_at) >= now;
      const hasStock = Number(v.used_count || 0) < Number(v.usage_limit || 999999);
      return notExpired && hasStock;
    });
  } catch (err) {
    cartActiveVouchers = [];
  }
}

function getSellerSubtotalsMap() {
  const map = {};
  state.cart.forEach(item => {
    const sid = item.seller_id;
    map[sid] = (map[sid] || 0) + (Number(item.price) * Number(item.qty));
  });
  return map;
}

function formatVoucherBadgeLabel(v) {
  if (v.discount_type === 'free_shipping') {
    return Number(v.discount_value || 0) > 0
      ? `🚚 FREE SHIPPING (up to ${formatPeso(v.discount_value)})`
      : '🚚 100% FREE SHIPPING';
  }
  if (v.discount_type === 'percent') {
    return `🏷️ ${Number(v.discount_value)}% OFF`;
  }
  return `💵 ${formatPeso(v.discount_value)} OFF`;
}

export function renderAutoDetectedVouchers() {
  const box = document.getElementById('auto-detected-vouchers-box');
  if (!box) return;

  if (!cartActiveVouchers.length) {
    box.innerHTML = '';
    return;
  }

  const sellerSubtotals = getSellerSubtotalsMap();

  box.innerHTML = cartActiveVouchers.map(v => {
    const shopSub = sellerSubtotals[v.seller_id] || 0;
    const minSpend = Number(v.min_spend || 0);
    const isEligible = shopSub >= minSpend;
    const isApplied = appliedVoucherObj && String(appliedVoucherObj.id) === String(v.id);
    const shopName = state.allSellers.find(s => s.user_id === v.seller_id)?.shop_name || v.shop_name || 'Shop';
    const discLabel = formatVoucherBadgeLabel(v);
    const missingAmt = Math.max(0, minSpend - shopSub);
    const isFreeShipVoucher = v.discount_type === 'free_shipping';

    if (isEligible) {
      return `
        <div onclick="selectAutoVoucher('${escapeHtml(v.id)}')"
          style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;margin-bottom:0.4rem;border-radius:6px;cursor:pointer;border:1.5px solid ${isApplied ? '#15803d' : (isFreeShipVoucher ? '#0284c7' : '#86efac')};background:${isApplied ? '#dcfce7' : '#f0fdf4'};">
          <div style="min-width:0;">
            <div style="font-size:0.78rem;font-weight:800;color:${isFreeShipVoucher ? '#0369a1' : 'var(--primary-deep)'};">
              ${escapeHtml(v.code)} — <span>${discLabel}</span>
            </div>
            <div style="font-size:0.7rem;color:var(--text-secondary);">
              🏪 ${escapeHtml(shopName)} • Min. spend ${formatPeso(minSpend)}
            </div>
          </div>
          <button type="button" class="sm ${isApplied ? 'success-btn' : 'shop-cta'}" style="flex-shrink:0;">
            ${isApplied ? '✓ Applied' : 'Apply'}
          </button>
        </div>
      `;
    } else {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.45rem 0.75rem;margin-bottom:0.4rem;border-radius:6px;border:1px dashed #cbd5e1;background:#f8fafc;opacity:0.85;">
          <div style="min-width:0;">
            <div style="font-size:0.75rem;font-weight:700;color:#475569;">
              🔒 ${escapeHtml(v.code)} — ${discLabel} (${escapeHtml(shopName)})
            </div>
            <div style="font-size:0.69rem;color:#b45309;font-weight:600;">
              Add ${formatPeso(missingAmt)} more to unlock (Min. ${formatPeso(minSpend)})
            </div>
          </div>
          <span class="badge" style="font-size:0.65rem;flex-shrink:0;">Locked</span>
        </div>
      `;
    }
  }).join('');
}

export function selectAutoVoucher(voucherId) {
  const v = cartActiveVouchers.find(item => String(item.id) === String(voucherId));
  if (!v) return;

  const sellerSubtotals = getSellerSubtotalsMap();
  const shopSub = sellerSubtotals[v.seller_id] || 0;
  if (shopSub < Number(v.min_spend || 0)) {
    return showToast(`Minimum spend of ${formatPeso(v.min_spend)} required for this shop.`, 'warning');
  }

  if (appliedVoucherObj && String(appliedVoucherObj.id) === String(v.id)) {
    appliedVoucherObj = null;
    state.appliedCheckoutVoucher = null;
    const codeInput = document.getElementById('checkout-voucher-code');
    if (codeInput) codeInput.value = '';
    const msgEl = document.getElementById('checkout-voucher-msg');
    if (msgEl) msgEl.textContent = '';
    showToast('Voucher removed.');
  } else {
    appliedVoucherObj = v;
    state.appliedCheckoutVoucher = v;
    const codeInput = document.getElementById('checkout-voucher-code');
    if (codeInput) codeInput.value = v.code;
    const msgEl = document.getElementById('checkout-voucher-msg');
    if (msgEl) {
      msgEl.style.color = '#15803d';
      msgEl.textContent = v.discount_type === 'free_shipping'
        ? `🚚 Free Shipping Voucher "${v.code}" applied!`
        : `✓ Discount Voucher "${v.code}" applied!`;
    }
    showToast(`Voucher "${v.code}" applied!`);
  }

  renderAutoDetectedVouchers();
  recalculateCartCheckoutTotals();
}

export async function applyCheckoutVoucher() {
  const rawCode = (document.getElementById('checkout-voucher-code')?.value || '').trim().toUpperCase();
  const msgEl = document.getElementById('checkout-voucher-msg');
  if (!rawCode) {
    appliedVoucherObj = null;
    state.appliedCheckoutVoucher = null;
    if (msgEl) msgEl.textContent = '';
    renderAutoDetectedVouchers();
    recalculateCartCheckoutTotals();
    return;
  }

  let found = cartActiveVouchers.find(v => v.code.toUpperCase() === rawCode);
  if (!found && supabaseClient) {
    const { data } = await supabaseClient
      .from('vouchers')
      .select('*')
      .eq('code', rawCode)
      .eq('is_active', true)
      .maybeSingle();
    if (data) found = data;
  }

  if (!found) {
    appliedVoucherObj = null;
    state.appliedCheckoutVoucher = null;
    if (msgEl) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Invalid or expired voucher code.';
    }
    renderAutoDetectedVouchers();
    recalculateCartCheckoutTotals();
    return;
  }

  const sellerSubtotals = getSellerSubtotalsMap();
  const shopSub = sellerSubtotals[found.seller_id] || 0;
  if (shopSub <= 0) {
    if (msgEl) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'This voucher is only valid for items from its issuing shop.';
    }
    return;
  }

  if (shopSub < Number(found.min_spend || 0)) {
    if (msgEl) {
      msgEl.style.color = '#b45309';
      msgEl.textContent = `Minimum shop spend of ${formatPeso(found.min_spend)} required.`;
    }
    return;
  }

  appliedVoucherObj = found;
  state.appliedCheckoutVoucher = found;
  if (msgEl) {
    msgEl.style.color = '#15803d';
    msgEl.textContent = found.discount_type === 'free_shipping'
      ? `🚚 Free Shipping Voucher "${found.code}" applied!`
      : `✓ Discount Voucher "${found.code}" applied!`;
  }
  renderAutoDetectedVouchers();
  recalculateCartCheckoutTotals();
  showToast(`Voucher "${found.code}" applied!`);
}

export function renderCartModal() {
  const container = document.getElementById('cart-items-container');
  const checkoutSec = document.getElementById('checkout-section');
  const emptyBox = document.getElementById('cart-empty-box');

  if (!state.cart.length) {
    appliedVoucherObj = null;
    state.appliedCheckoutVoucher = null;
    emptyBox?.classList.remove('hidden');
    checkoutSec?.classList.add('hidden');
    if (container) container.innerHTML = '';
    return;
  }

  emptyBox?.classList.add('hidden');
  checkoutSec?.classList.remove('hidden');
  syncCheckoutAddressFromProfile();

  const brgy = document.getElementById('checkout-barangay')?.value || '';
  const grouped = {};
  state.cart.forEach((item, globalIdx) => {
    (grouped[item.seller_id] ||= []).push({ ...item, globalIdx });
  });

  container.innerHTML = Object.entries(grouped).map(([sid, items]) => {
    const seller = state.allSellers.find(s => s.user_id === sid);
    const shopName = seller?.shop_name || items[0]?.shop_name || 'Verified Shop';
    const shopShipFee = computeShippingForSellerGroup(sid, items, brgy);
    const shopItemsSub = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
    const shopOrderTotal = shopItemsSub + shopShipFee;
    const totalShopQty = items.reduce((s, i) => s + Number(i.qty), 0);

    const rowsHtml = items.map(it => {
      const isFree = it.is_free_shipping === true;
      const lineSub = Number(it.price) * Number(it.qty);
      return `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid #f1f5f9;">
          <img src="${escapeHtml(it.image_url || PLACEHOLDER_IMG)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.85rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.title)}</div>
            <div style="font-size:0.74rem;color:var(--muted);margin-top:0.15rem;">
              Unit Price: <strong>${formatPeso(it.price)}</strong>
              ${isFree ? '<span class="badge ship-free" style="margin-left:0.35rem;font-size:0.65rem;">🚚 Free Shipping</span>' : ''}
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:0.3rem;">
            <button type="button" class="secondary sm" style="padding:0.18rem 0.45rem;" onclick="updateCartItemQty(${it.globalIdx}, -1)">−</button>
            <span style="font-weight:700;font-size:0.84rem;min-width:20px;text-align:center;">${it.qty}</span>
            <button type="button" class="secondary sm" style="padding:0.18rem 0.45rem;" onclick="updateCartItemQty(${it.globalIdx}, 1)">+</button>
          </div>

          <div style="text-align:right;min-width:85px;">
            <div style="font-weight:800;font-size:0.88rem;color:var(--text);">${formatPeso(lineSub)}</div>
            <button type="button" class="text-link-btn" style="font-size:0.7rem;color:var(--danger);text-decoration:none;" onclick="removeCartItem(${it.globalIdx})">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="background:#ffffff;border-radius:8px;padding:0.95rem 1.15rem;margin-bottom:0.75rem;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <!-- Shop Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:0.55rem;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span class="pdp-mall-pill" style="font-size:0.65rem;">VERIFIED</span>
            <strong style="font-size:0.88rem;color:var(--text);">🏪 ${escapeHtml(shopName)}</strong>
          </div>
          <button type="button" class="text-link-btn" style="font-size:0.76rem;text-decoration:none;" onclick="openDirectChat('${escapeHtml(sid)}', '${escapeHtml(shopName)}')">💬 Chat Now</button>
        </div>

        <!-- Shop Items -->
        <div>${rowsHtml}</div>

        <!-- Message for Seller + Shipping Option Row (Shopee Style) -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.85rem;padding:0.75rem 0;border-bottom:1px dashed var(--border);align-items:center;">
          <div style="display:flex;align-items:center;gap:0.45rem;">
            <span style="font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;">Message:</span>
            <input type="text" class="shop-order-note-input" data-seller-id="${escapeHtml(sid)}" placeholder="Please leave a message..." style="font-size:0.78rem;padding:0.36rem 0.55rem;" />
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;">
            <div>
              <span style="color:var(--primary-dark);font-weight:700;">🚚 Standard Local Delivery</span>
              <div style="font-size:0.7rem;color:var(--muted);">${brgy ? `To ${escapeHtml(brgy)}` : 'Barangay / Item rate'}</div>
            </div>
            <strong style="color:var(--text);">${shopShipFee === 0 ? '₱0.00 (FREE)' : formatPeso(shopShipFee)}</strong>
          </div>
        </div>

        <!-- Shop Order Total -->
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:0.65rem;padding-top:0.65rem;font-size:0.84rem;">
          <span style="color:var(--muted);">Order Total (${totalShopQty} item${totalShopQty > 1 ? 's' : ''}):</span>
          <strong style="font-size:1rem;color:var(--primary-dark);">${formatPeso(shopOrderTotal)}</strong>
        </div>
      </div>
    `;
  }).join('');

  renderCheckoutQrSellers();
  renderAutoDetectedVouchers();
  recalculateCartCheckoutTotals();
}

export async function updateCartItemQty(idx, delta) {
  if (!state.cart[idx]) return;
  state.cart[idx].qty += delta;
  if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
  saveCartToStorage();
  await fetchActiveVouchersForCartSellers();
  renderCartModal();
}

export async function removeCartItem(idx) {
  state.cart.splice(idx, 1);
  saveCartToStorage();
  await fetchActiveVouchersForCartSellers();
  renderCartModal();
}

export function computeShippingForSellerGroup(sellerId, items, barangayInput) {
  const chargeableItems = items.filter(i => i.is_free_shipping !== true);
  if (chargeableItems.length === 0) return 0;

  const seller = state.allSellers.find(s => s.user_id === sellerId);
  const cleanBrgy = (barangayInput || '').trim().toLowerCase();
  if (cleanBrgy && Array.isArray(seller?.barangay_rates)) {
    const match = seller.barangay_rates.find(r => (r.name || '').trim().toLowerCase() === cleanBrgy);
    if (match) return Number(match.fee || 0);
  }
  const itemMaxShip = Math.max(...chargeableItems.map(i => Number(i.shipping_fee || 0)));
  if (itemMaxShip > 0) return itemMaxShip;
  return Number(seller?.default_shipping_fee || 0);
}

export function recalculateCartCheckoutTotals() {
  const brgy = document.getElementById('checkout-barangay')?.value || '';
  const subtotal = state.cart.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);

  const grouped = {};
  state.cart.forEach(item => {
    if (!grouped[item.seller_id]) grouped[item.seller_id] = [];
    grouped[item.seller_id].push(item);
  });

  const sellerShippingMap = {};
  let shippingTotal = 0;
  Object.entries(grouped).forEach(([sid, items]) => {
    const fee = computeShippingForSellerGroup(sid, items, brgy);
    sellerShippingMap[sid] = fee;
    shippingTotal += fee;
  });

  let itemDiscountTotal = 0;
  let shippingDiscountTotal = 0;
  const sellerSubtotals = getSellerSubtotalsMap();

  if (appliedVoucherObj) {
    const targetSid = appliedVoucherObj.seller_id;
    const targetShopSub = sellerSubtotals[targetSid] || 0;
    const targetShopShip = sellerShippingMap[targetSid] || 0;

    if (targetShopSub >= Number(appliedVoucherObj.min_spend || 0) && targetShopSub > 0) {
      if (appliedVoucherObj.discount_type === 'free_shipping') {
        const cap = Number(appliedVoucherObj.discount_value || 0);
        shippingDiscountTotal = cap > 0 ? Math.min(targetShopShip, cap) : targetShopShip;
      } else if (appliedVoucherObj.discount_type === 'percent') {
        itemDiscountTotal = Math.min(targetShopSub, targetShopSub * (Number(appliedVoucherObj.discount_value || 0) / 100));
      } else {
        itemDiscountTotal = Math.min(targetShopSub, Number(appliedVoucherObj.discount_value || 0));
      }
    } else {
      appliedVoucherObj = null;
      state.appliedCheckoutVoucher = null;
      const msgEl = document.getElementById('checkout-voucher-msg');
      if (msgEl) msgEl.textContent = '';
      renderAutoDetectedVouchers();
    }
  }

  const netShipping = Math.max(0, shippingTotal - shippingDiscountTotal);
  const totalSaved = itemDiscountTotal + shippingDiscountTotal;

  const discountRow = document.getElementById('checkout-discount-row');
  const discountValEl = document.getElementById('checkout-discount-val');
  if (discountRow && discountValEl) {
    if (totalSaved > 0) {
      discountRow.classList.remove('hidden');
      discountValEl.textContent = shippingDiscountTotal > 0 && itemDiscountTotal === 0
        ? `-${formatPeso(shippingDiscountTotal)} (Free Shipping)`
        : `-${formatPeso(totalSaved)}`;
    } else {
      discountRow.classList.add('hidden');
      discountValEl.textContent = '-₱0.00';
    }
  }

  const grandTotal = Math.max(0, subtotal - itemDiscountTotal + netShipping);
  document.getElementById('checkout-subtotal').textContent = formatPeso(subtotal);
  document.getElementById('checkout-shipping').textContent = netShipping === 0 && shippingTotal > 0
    ? '₱0.00 (FREE)'
    : formatPeso(netShipping);
  document.getElementById('checkout-grand-total').textContent = formatPeso(grandTotal);
}

Object.assign(window, {
  addToCartById,
  addFromPdpToCart,
  quickBuyNowById,
  buyNowFromPdp,
  openCartModal,
  closeCartModal,
  toggleCheckoutAddressEdit,
  saveCheckoutAddressToProfile,
  updateCartItemQty,
  removeCartItem,
  selectAutoVoucher,
  applyCheckoutVoucher,
  recalculateCartCheckoutTotals
});
