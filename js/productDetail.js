// =========================================================
// EXPANDED PRODUCT DETAIL PAGE (PDP) & REVIEWS DISPLAY
// =========================================================
import { state } from './config.js';
import { escapeHtml, formatPeso, getProductImages } from './utils.js';
import { switchView } from './navigation.js';
import { selectCategory, updateShopSelectionUI, renderVerifiedShops, renderProducts } from './marketplace.js';
import { openDirectChat } from './chat.js';

export function openExpandedProduct(productId) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;
  state.activePdpProduct = prod;
  state.reviewStarFilter = 'all';

  const seller = state.allSellers.find(s => s.user_id === prod.seller_id);
  const shopName = seller?.shop_name || prod.shop_name || 'Verified Seller';
  const imgs = getProductImages(prod);
  const stockNum = Number(prod.stock ?? 99);
  const outOfStock = stockNum <= 0;

  document.getElementById('pdp-crumb-category').textContent = prod.category || 'General';
  document.getElementById('pdp-crumb-shop').textContent = shopName;
  document.getElementById('pdp-crumb-title').textContent = prod.title;

  document.getElementById('pdp-main-image').src = imgs[0];
  document.getElementById('pdp-thumbs').innerHTML = imgs.map((src, idx) => `
    <div class="pdp-thumb ${idx === 0 ? 'active' : ''}" onclick="selectPdpThumb(this, '${escapeHtml(src)}')">
      <img src="${escapeHtml(src)}" alt="Thumb ${idx + 1}" />
    </div>
  `).join('');

  document.getElementById('pdp-title').textContent = prod.title;
  document.getElementById('pdp-price').textContent = formatPeso(prod.price);
  document.getElementById('pdp-sold-count').textContent = Number(prod.sold_count || 0);

  const isFree = prod.is_free_shipping === true || Number(prod.shipping_fee || 0) === 0;
  const shipFee = isFree ? 0 : Number(prod.shipping_fee || 0);
  const shipPill = document.getElementById('pdp-ship-pill');
  shipPill.textContent = isFree ? 'Free Delivery' : `Shipping: ${formatPeso(shipFee)}`;
  shipPill.className = `badge ${isFree ? 'ship-free' : 'ship-paid'}`;

  document.getElementById('pdp-shipping-detail').textContent = isFree
    ? '₱0.00 (Free Standard Delivery)'
    : `${formatPeso(shipFee)} Base Item Shipping`;
  document.getElementById('pdp-area-detail').textContent = `Coverage: ${prod.delivery_area || seller?.location || 'All Areas'}`;

  const brgyRates = Array.isArray(seller?.barangay_rates) ? seller.barangay_rates : [];
  document.getElementById('pdp-brgy-rates-preview').textContent = !isFree && brgyRates.length
    ? 'Barangay Rates: ' + brgyRates.map(r => `${r.name} (${Number(r.fee) === 0 ? 'Free' : formatPeso(r.fee)})`).join(' • ')
    : '';

  const qtyInput = document.getElementById('pdp-qty');
  qtyInput.value = outOfStock ? 0 : 1;
  qtyInput.max = Math.max(1, stockNum);
  document.getElementById('pdp-stock-label').textContent = outOfStock
    ? 'Out of stock'
    : `${stockNum} pieces available`;

  document.getElementById('pdp-add-cart-btn').disabled = outOfStock;
  document.getElementById('pdp-buy-now-btn').disabled = outOfStock;

  const shopProducts = state.allProducts.filter(p => p.seller_id === prod.seller_id);
  const shopSoldTotal = shopProducts.reduce((sum, item) => sum + Number(item.sold_count || 0), 0);
  const shopReviews = state.allReviews.filter(r => shopProducts.some(sp => String(sp.id) === String(r.product_id)));
  const shopAvg = shopReviews.length
    ? (shopReviews.reduce((s, r) => s + Number(r.rating || 5), 0) / shopReviews.length).toFixed(1)
    : '5.0';

  document.getElementById('pdp-shop-avatar').textContent = shopName.charAt(0).toUpperCase();
  document.getElementById('pdp-shop-name').textContent = shopName;
  document.getElementById('pdp-shop-rating-stat').textContent = `${shopAvg} ★`;
  document.getElementById('pdp-shop-products-stat').textContent = shopProducts.length;
  document.getElementById('pdp-shop-sold-stat').textContent = shopSoldTotal;

  document.getElementById('pdp-spec-category').textContent = prod.category || 'General';
  document.getElementById('pdp-spec-stock').textContent = `${stockNum} available`;
  document.getElementById('pdp-spec-area').textContent = prod.delivery_area || seller?.location || 'All Areas';
  document.getElementById('pdp-spec-shipping').textContent = isFree ? 'Free Delivery' : formatPeso(shipFee);
  document.getElementById('pdp-description').textContent = prod.description || 'Fresh quality item from a verified MarketHub seller.';

  const otherShopItems = shopProducts.filter(p => String(p.id) !== String(prod.id)).slice(0, 4);
  const topPicksEl = document.getElementById('pdp-top-picks-list');
  topPicksEl.innerHTML = otherShopItems.length
    ? otherShopItems.map(item => `
        <div class="top-pick-item" onclick="openExpandedProduct('${escapeHtml(item.id)}')">
          <img src="${escapeHtml(getProductImages(item)[0])}" alt="${escapeHtml(item.title)}" />
          <div class="top-pick-name">${escapeHtml(item.title)}</div>
          <div class="top-pick-price">${formatPeso(item.price)}</div>
        </div>
      `).join('')
    : `<div style="font-size:0.78rem;color:var(--muted);">No other items in this shop yet.</div>`;

  renderPdpReviews();
  switchView('product-detail');
}

export function closeExpandedProduct() {
  state.activePdpProduct = null;
  switchView('marketplace');
}

export function selectPdpThumb(el, src) {
  document.getElementById('pdp-main-image').src = src;
  document.querySelectorAll('.pdp-thumb').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

export function adjustPdpQty(delta) {
  if (!state.activePdpProduct) return;
  const input = document.getElementById('pdp-qty');
  const maxStock = Math.max(1, Number(state.activePdpProduct.stock ?? 99));
  let next = (parseInt(input.value, 10) || 1) + delta;
  if (next < 1) next = 1;
  if (next > maxStock) next = maxStock;
  input.value = next;
}

export function clampPdpQty() {
  if (!state.activePdpProduct) return;
  const input = document.getElementById('pdp-qty');
  const maxStock = Math.max(1, Number(state.activePdpProduct.stock ?? 99));
  let val = parseInt(input.value, 10) || 1;
  if (val < 1) val = 1;
  if (val > maxStock) val = maxStock;
  input.value = val;
}

export function filterByPdpCategory() {
  if (!state.activePdpProduct) return;
  selectCategory(state.activePdpProduct.category || 'All Categories');
}

export function filterByPdpShop() {
  if (!state.activePdpProduct) return;
  state.selectedShopId = state.activePdpProduct.seller_id;
  updateShopSelectionUI();
  renderVerifiedShops();
  switchView('marketplace');
  renderProducts();
}

export function openChatFromPdp() {
  if (!state.activePdpProduct) return;
  const seller = state.allSellers.find(s => s.user_id === state.activePdpProduct.seller_id);
  openDirectChat(
    state.activePdpProduct.seller_id,
    seller?.shop_name || state.activePdpProduct.shop_name || 'Seller',
    state.activePdpProduct.title
  );
}

export function setReviewStarFilter(val) {
  state.reviewStarFilter = val;
  ['all', 5, 4, 3, 2, 1].forEach(k => {
    document.getElementById(`rev-filter-${k}`)?.classList.toggle('active', String(k) === String(val));
  });
  renderPdpReviews();
}

export function renderPdpReviews() {
  if (!state.activePdpProduct) return;
  const prodRevs = state.allReviews.filter(r => String(r.product_id) === String(state.activePdpProduct.id));
  const count = prodRevs.length;
  const avg = count ? (prodRevs.reduce((s, r) => s + Number(r.rating || 5), 0) / count) : 0;
  const starsStr = count ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) : '☆☆☆☆☆';

  document.getElementById('pdp-rating-score').textContent = avg.toFixed(1);
  document.getElementById('pdp-rating-stars').textContent = starsStr;
  document.getElementById('pdp-rating-count').textContent = count;
  document.getElementById('pdp-review-big-num').textContent = avg.toFixed(1);
  document.getElementById('pdp-review-big-stars').textContent = starsStr;

  const filtered = state.reviewStarFilter === 'all'
    ? prodRevs
    : prodRevs.filter(r => Number(r.rating) === Number(state.reviewStarFilter));

  const list = document.getElementById('pdp-reviews-list');
  if (!filtered.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--muted);padding:1.25rem;font-size:0.84rem;">No buyer reviews yet for this filter.</div>`;
    return;
  }

  list.innerHTML = filtered.map(r => `
    <div class="review-card">
      <div class="row-between">
        <strong style="font-size:0.84rem;">${escapeHtml(r.buyer_name || 'Verified Buyer')}</strong>
        <span style="font-size:0.74rem;color:var(--muted);">${new Date(r.created_at).toLocaleDateString()}</span>
      </div>
      <div style="color:#f59e0b;font-size:0.85rem;margin:0.15rem 0;">${'★'.repeat(Number(r.rating || 5))}${'☆'.repeat(5 - Number(r.rating || 5))}</div>
      <div style="font-size:0.84rem;color:var(--text-secondary);">${escapeHtml(r.comment || 'Great item!')}</div>
    </div>
  `).join('');
}

Object.assign(window, {
  openExpandedProduct,
  closeExpandedProduct,
  selectPdpThumb,
  adjustPdpQty,
  clampPdpQty,
  filterByPdpCategory,
  filterByPdpShop,
  openChatFromPdp,
  setReviewStarFilter
});
