// =========================================================
// SHOPPING CART, AUTO-DETECT VOUCHERS & BARANGAY SHIPPING FEE CALCULATOR
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
  document.getElementById('cart-modal').classList.remove('hidden');
  await fetchActiveVouchersForCartSellers();
  renderCartModal();
}

export function closeCartModal() {
  document.getElementById('cart-modal').classList.add('hidden');
}

export function populateBarangaySuggestions() {
  const datalist = document.getElementById('barangay-suggestions');
  const seen = new Set();
  state.allSellers.forEach(s => {
    if (Array.isArray(s.barangay_rates)) {
      s.barangay_rates.forEach(r => { if (r.name) seen.add(r.name); });
    }
  });
  datalist.innerHTML = Array.from(seen).map(name => `<option value="${escapeHtml(name)}">`).join('');
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
      console.warn('Voucher fetch warning:', error.message);
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
    console.error(err);
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

function computeVoucherDiscountAmount(voucher, sellerSubtotal) {
  if (!voucher || sellerSubtotal < Number(voucher.min_spend || 0)) return 0;
  if (voucher.discount_type === 'percent') {
    return Math.min(sellerSubtotal, sellerSubtotal * (Number(voucher.discount_value || 0) / 100));
  }
  return Math.min(sellerSubtotal, Number(voucher.discount_value || 0));
}

function ensureAutoVoucherContainer() {
  let box = document.getElementById('auto-detected-vouchers-box');
  if (!box) {
    const codeInput = document.getElementById('checkout-voucher-code');
    const wrapper = codeInput?.closest('div')?.parentElement;
    if (wrapper) {
      box = document.createElement('div');
      box.id = 'auto-detected-vouchers-box';
      box.style.marginBottom = '0.6rem';
      wrapper.insertBefore(box, wrapper.firstChild);
    }
  }
  return box;
}

export function renderAutoDetectedVouchers() {
  const box = ensureAutoVoucherContainer();
  if (!box) return;

  if (!cartActiveVouchers.length) {
    box.innerHTML = '';
    return;
  }

  const sellerSubtotals = getSellerSubtotalsMap();

  const chipsHtml = cartActiveVouchers.map(v => {
    const shopSub = sellerSubtotals[v.seller_id] || 0;
    const minSpend = Number(v.min_spend || 0);
    const isEligible = shopSub >= minSpend;
    const isApplied = appliedVoucherObj && String(appliedVoucherObj.id) === String(v.id);
    const shopName = state.allSellers.find(s => s.user_id === v.seller_id)?.shop_name || v.shop_name || 'Shop';
    const discLabel = v.discount_type === 'percent'
      ? `${Number(v.discount_value)}% OFF`
      : `${formatPeso(v.discount_value)} OFF`;
    const missingAmt = Math.max(0, minSpend - shopSub);

    if (isEligible) {
      return `
        <div onclick="selectAutoVoucher('${escapeHtml(v.id)}')"
          style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.55rem 0.75rem;margin-bottom:0.4rem;border-radius:8px;cursor:pointer;border:1.5px solid ${isApplied ? '#15803d' : '#4ade80'};background:${isApplied ? '#dcfce7' : '#ffffff'};transition:all 0.15s;">
          <div style="min-width:0;">
            <div style="font-size:0.78rem;font-weight:800;color:var(--primary-deep);">
              🎟️ ${escapeHtml(v.code)} — <span style="color:#15803d;">${discLabel}</span>
            </div>
            <div style="font-size:0.71rem;color:var(--text-secondary);">
              🏪 ${escapeHtml(shopName)} • Min. spend ${formatPeso(minSpend)} (Unlocked!)
            </div>
          </div>
          <button type="button" class="sm ${isApplied ? 'success-btn' : 'shop-cta'}" style="flex-shrink:0;">
            ${isApplied ? '✓ Applied' : 'Click to Apply'}
          </button>
        </div>
      `;
    } else {
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;margin-bottom:0.4rem;border-radius:8px;border:1px dashed #cbd5e1;background:#f8fafc;opacity:0.85;">
          <div style="min-width:0;">
            <div style="font-size:0.76rem;font-weight:700;color:#475569;">
              🔒 ${escapeHtml(v.code)} — ${discLabel} (${escapeHtml(shopName)})
            </div>
            <div style="font-size:0.7rem;color:#b45309;font-weight:600;">
              Add ${formatPeso(missingAmt)} more from this shop to unlock (Min. ${formatPeso(minSpend)})
            </div>
          </div>
          <span class="badge" style="font-size:0.65rem;flex-shrink:0;">Locked</span>
        </div>
      `;
    }
  }).join('');

  box.innerHTML = `
    <div style="font-size:0.74rem;font-weight:800;color:var(--primary-deep);margin-bottom:0.35rem;text-transform:uppercase;letter-spacing:0.03em;">
      ✨ Available Shop Vouchers (1-Click Apply)
    </div>
    ${chipsHtml}
  `;
}

export function selectAutoVoucher(voucherId) {
  const v = cartActiveVouchers.find(item => String(item.id) === String(voucherId));
  if (!v) return;

  const sellerSubtotals = getSellerSubtotalsMap();
  const shopSub = sellerSubtotals[v.seller_id] || 0;
  if (shopSub < Number(v.min_spend || 0)) {
    return showToast(`Minimum spend of ${formatPeso(v.min_spend)} required for this shop.`, 'warning');
  }

  // Toggle off if already selected
  if (appliedVoucherObj && String(appliedVoucherObj.id) === String(v.id)) {
    appliedVoucherObj = null;
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
      msgEl.textContent = `✓ Voucher "${v.code}" applied!`;
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
    msgEl.textContent = `✓ Voucher "${found.code}" applied!`;
  }
  renderAutoDetectedVouchers();
  recalculateCartCheckoutTotals();
  showToast(`Voucher "${found.code}" applied!`);
}

export function renderCartModal() {
  const container = document.getElementById('cart-items-container');
  const checkoutSec = document.getElementById('checkout-section');

  if (!state.cart.length) {
    appliedVoucherObj = null;
    state.appliedCheckoutVoucher = null;
    container.innerHTML = `<div class="empty-state">Your shopping cart is empty. Browse fresh harvests &amp; gadgets!</div>`;
    checkoutSec.classList.add('hidden');
    return;
  }

  checkoutSec.classList.remove('hidden');
  if (state.currentProfile?.full_name && !document.getElementById('checkout-name').value) {
    document.getElementById('checkout-name').value = state.currentProfile.full_name;
  }

  container.innerHTML = state.cart.map((item, idx) => {
    const isFree = item.is_free_shipping === true;
    const displayShopName = state.allSellers.find(s => s.user_id === item.seller_id)?.shop_name || item.shop_name || 'Verified Shop';
    return `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 0;border-bottom:1px solid var(--border);">
        <img src="${escapeHtml(item.image_url || PLACEHOLDER_IMG)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" />
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title)}</div>
          <div style="font-size:0.74rem;color:var(--primary-dark);font-weight:600;">
            🏪 ${escapeHtml(displayShopName)}
            ${isFree ? '<span class="badge ship-free" style="margin-left:0.35rem;font-size:0.65rem;">🚚 Free Shipping</span>' : ''}
          </div>
          <div style="font-size:0.82rem;font-weight:700;margin-top:0.15rem;">${formatPeso(item.price)} × ${item.qty}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.35rem;">
          <button class="secondary sm" onclick="updateCartItemQty(${idx}, -1)">−</button>
          <span style="font-weight:700;min-width:20px;text-align:center;">${item.qty}</span>
          <button class="secondary sm" onclick="updateCartItemQty(${idx}, 1)">+</button>
          <button class="danger-outline sm" onclick="removeCartItem(${idx})">✕</button>
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
  // Filter items that require shipping (exclude items toggled as Free Shipping by seller)
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

  let shippingTotal = 0;
  Object.entries(grouped).forEach(([sid, items]) => {
    shippingTotal += computeShippingForSellerGroup(sid, items, brgy);
  });

  // Auto-validate applied voucher if quantity dropped below min_spend
  let discountTotal = 0;
  const sellerSubtotals = getSellerSubtotalsMap();
  if (appliedVoucherObj) {
    const targetShopSub = sellerSubtotals[appliedVoucherObj.seller_id] || 0;
    if (targetShopSub >= Number(appliedVoucherObj.min_spend || 0) && targetShopSub > 0) {
      discountTotal = computeVoucherDiscountAmount(appliedVoucherObj, targetShopSub);
    } else {
      appliedVoucherObj = null;
      state.appliedCheckoutVoucher = null;
      const msgEl = document.getElementById('checkout-voucher-msg');
      if (msgEl) msgEl.textContent = '';
      renderAutoDetectedVouchers();
    }
  }

  const discountRow = document.getElementById('checkout-discount-row');
  const discountValEl = document.getElementById('checkout-discount-val');
  if (discountRow && discountValEl) {
    if (discountTotal > 0) {
      discountRow.classList.remove('hidden');
      discountValEl.textContent = `-${formatPeso(discountTotal)}`;
    } else {
      discountRow.classList.add('hidden');
      discountValEl.textContent = '-₱0.00';
    }
  }

  const grandTotal = Math.max(0, subtotal - discountTotal + shippingTotal);
  document.getElementById('checkout-subtotal').textContent = formatPeso(subtotal);
  document.getElementById('checkout-shipping').textContent = formatPeso(shippingTotal);
  document.getElementById('checkout-grand-total').textContent = formatPeso(grandTotal);
}

Object.assign(window, {
  addToCartById,
  addFromPdpToCart,
  quickBuyNowById,
  buyNowFromPdp,
  openCartModal,
  closeCartModal,
  updateCartItemQty,
  removeCartItem,
  selectAutoVoucher,
  applyCheckoutVoucher,
  recalculateCartCheckoutTotals
});
