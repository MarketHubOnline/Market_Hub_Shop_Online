// =========================================================
// SHOPPING CART & BARANGAY SHIPPING FEE CALCULATOR
// =========================================================
import { state, PLACEHOLDER_IMG } from './config.js';
import { escapeHtml, formatPeso, getProductImages, showToast } from './utils.js';
import { renderCheckoutQrSellers } from './checkout.js';

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

  const existing = state.cart.find(c => String(c.product_id) === String(productId));
  if (existing) {
    existing.qty = Math.min(stock, existing.qty + qty);
  } else {
    state.cart.push({
      product_id: prod.id,
      seller_id: prod.seller_id,
      shop_name: prod.shop_name || state.allSellers.find(s => s.user_id === prod.seller_id)?.shop_name || 'Verified Shop',
      title: prod.title,
      price: Number(prod.price),
      shipping_fee: Number(prod.shipping_fee || 0),
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

export function openCartModal() {
  populateBarangaySuggestions();
  renderCartModal();
  document.getElementById('cart-modal').classList.remove('hidden');
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

export function renderCartModal() {
  const container = document.getElementById('cart-items-container');
  const checkoutSec = document.getElementById('checkout-section');

  if (!state.cart.length) {
    container.innerHTML = `<div class="empty-state">Your shopping cart is empty. Browse fresh harvests &amp; gadgets!</div>`;
    checkoutSec.classList.add('hidden');
    return;
  }

  checkoutSec.classList.remove('hidden');
  if (state.currentProfile?.full_name && !document.getElementById('checkout-name').value) {
    document.getElementById('checkout-name').value = state.currentProfile.full_name;
  }

  container.innerHTML = state.cart.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 0;border-bottom:1px solid var(--border);">
      <img src="${escapeHtml(item.image_url || PLACEHOLDER_IMG)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" />
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title)}</div>
        <div style="font-size:0.74rem;color:var(--primary-dark);font-weight:600;">🏪 ${escapeHtml(item.shop_name)}</div>
        <div style="font-size:0.82rem;font-weight:700;margin-top:0.15rem;">${formatPeso(item.price)} × ${item.qty}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.35rem;">
        <button class="secondary sm" onclick="updateCartItemQty(${idx}, -1)">−</button>
        <span style="font-weight:700;min-width:20px;text-align:center;">${item.qty}</span>
        <button class="secondary sm" onclick="updateCartItemQty(${idx}, 1)">+</button>
        <button class="danger-outline sm" onclick="removeCartItem(${idx})">✕</button>
      </div>
    </div>
  `).join('');

  renderCheckoutQrSellers();
  recalculateCartCheckoutTotals();
}

export function updateCartItemQty(idx, delta) {
  if (!state.cart[idx]) return;
  state.cart[idx].qty += delta;
  if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
  saveCartToStorage();
  renderCartModal();
}

export function removeCartItem(idx) {
  state.cart.splice(idx, 1);
  saveCartToStorage();
  renderCartModal();
}

export function computeShippingForSellerGroup(sellerId, items, barangayInput) {
  const seller = state.allSellers.find(s => s.user_id === sellerId);
  const cleanBrgy = (barangayInput || '').trim().toLowerCase();
  if (cleanBrgy && Array.isArray(seller?.barangay_rates)) {
    const match = seller.barangay_rates.find(r => (r.name || '').trim().toLowerCase() === cleanBrgy);
    if (match) return Number(match.fee || 0);
  }
  const itemMaxShip = Math.max(...items.map(i => Number(i.shipping_fee || 0)));
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

  document.getElementById('checkout-subtotal').textContent = formatPeso(subtotal);
  document.getElementById('checkout-shipping').textContent = formatPeso(shippingTotal);
  document.getElementById('checkout-grand-total').textContent = formatPeso(subtotal + shippingTotal);
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
  recalculateCartCheckoutTotals
});
