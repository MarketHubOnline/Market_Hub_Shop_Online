// =========================================================
// MARKETPLACE CATEGORIES, SHOPS MALL STRIP, SORTING & GRID
// =========================================================
import { supabaseClient, CATEGORIES, state } from './config.js';
import { escapeHtml, formatPeso, getProductImages } from './utils.js';
import { switchView } from './navigation.js';
import { openDirectChat } from './chat.js';

export function initCategoriesUI() {
  const sideList = document.getElementById('sidebar-cat-list');
  const mobileStrip = document.getElementById('mobile-cat-strip');
  const prodCatSelect = document.getElementById('prod-category');

  sideList.innerHTML = CATEGORIES.map(cat => `
    <button class="sidebar-cat-item ${state.selectedCategory === cat ? 'active' : ''}" onclick="selectCategory('${escapeHtml(cat)}')">
      ${escapeHtml(cat)}
    </button>
  `).join('');

  mobileStrip.innerHTML = CATEGORIES.map(cat => `
    <button class="mobile-cat-pill ${state.selectedCategory === cat ? 'active' : ''}" onclick="selectCategory('${escapeHtml(cat)}')">
      ${escapeHtml(cat)}
    </button>
  `).join('');

  if (prodCatSelect) {
    prodCatSelect.innerHTML = CATEGORIES.filter(c => c !== 'All Categories')
      .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
}

export function selectCategory(cat) {
  state.selectedCategory = cat;
  initCategoriesUI();
  if (!document.getElementById('view-product-detail').classList.contains('hidden')) {
    switchView('marketplace');
  }
  renderProducts();
}

export function quickTagCategory(cat) {
  state.selectedShopId = 'all';
  updateShopSelectionUI();
  selectCategory(cat);
}

export function quickTagSearch(term) {
  document.getElementById('search-input').value = term;
  state.selectedCategory = 'All Categories';
  state.selectedShopId = 'all';
  initCategoriesUI();
  updateShopSelectionUI();
  switchView('marketplace');
  renderProducts();
}

export function quickTagFreeShip() {
  document.getElementById('filter-free-ship').checked = true;
  switchView('marketplace');
  renderProducts();
}

export function handleHeaderSearchInput() {
  if (!document.getElementById('view-marketplace').classList.contains('hidden')) {
    renderProducts();
  }
}

export function triggerHeaderSearch() {
  switchView('marketplace');
  renderProducts();
}

export function setSortMode(mode) {
  state.sortMode = mode;
  state.priceSortMode = '';
  document.getElementById('price-sort-select').value = '';
  ['popular', 'latest', 'sales'].forEach(m => {
    document.getElementById(`sort-btn-${m}`)?.classList.toggle('active', m === mode);
  });
  renderProducts();
}

export function setPriceSort(val) {
  state.priceSortMode = val;
  if (val) {
    ['popular', 'latest', 'sales'].forEach(m => document.getElementById(`sort-btn-${m}`)?.classList.remove('active'));
  }
  renderProducts();
}

export function resetAllMarketplaceFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-free-ship').checked = false;
  document.getElementById('filter-in-stock').checked = false;
  state.selectedCategory = 'All Categories';
  state.selectedShopId = 'all';
  state.sortMode = 'popular';
  state.priceSortMode = '';
  document.getElementById('price-sort-select').value = '';
  initCategoriesUI();
  updateShopSelectionUI();
  setSortMode('popular');
}

export async function loadMarketplaceData() {
  if (!supabaseClient) {
    loadDemoFallbackData();
    return;
  }
  try {
    const [{ data: prods }, { data: sellers }, { data: revs }] = await Promise.all([
      supabaseClient.from('products').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('sellers').select('*').eq('status', 'approved'),
      supabaseClient.from('reviews').select('*').order('created_at', { ascending: false })
    ]);

    state.allProducts = prods || [];
    state.allSellers = sellers || [];
    state.allReviews = revs || [];
    renderVerifiedShops();
    renderProducts();
  } catch (err) {
    console.error(err);
  }
}

export function loadDemoFallbackData() {
  state.allSellers = [
    { id: 'demo-s1', user_id: 'u1', shop_name: 'Dangay Fresh Harvest', location: 'Brgy. Dangay, Roxas', phone: '0917-555-0101', status: 'approved', default_shipping_fee: 25, barangay_rates: [{ name: 'Brgy. Dangay', fee: 0 }, { name: 'Poblacion Roxas', fee: 20 }] },
    { id: 'demo-s2', user_id: 'u2', shop_name: 'Mindoro Gadget Hub', location: 'Roxas Town Center', phone: '0918-555-0202', status: 'approved', default_shipping_fee: 50, barangay_rates: [{ name: 'Roxas', fee: 30 }, { name: 'Bongabong', fee: 60 }] }
  ];
  state.allProducts = [
    { id: 'demo-p1', seller_id: 'u1', shop_name: 'Dangay Fresh Harvest', title: 'Fresh Bell Pepper Sultan F1 (1kg Pack)', category: 'Fresh Produce & Farm', price: 140, stock: 35, sold_count: 84, shipping_fee: 0, delivery_area: 'Roxas & Neighboring Towns', description: 'Crisp, thick-walled lowland bell peppers harvested fresh every morning in Brgy. Dangay.', image_url: '' },
    { id: 'demo-p2', seller_id: 'u2', shop_name: 'Mindoro Gadget Hub', title: '65W GaN Fast Charger + Braided Type-C Cable', category: 'Gadgets & Accessories', price: 650, stock: 18, sold_count: 42, shipping_fee: 0, delivery_area: 'All Areas', description: 'High-speed 65W dual-port GaN charger with thermal protection for smartphones and laptops.', image_url: '' },
    { id: 'demo-p3', seller_id: 'u1', shop_name: 'Dangay Fresh Harvest', title: 'Farm-Fresh Sili Panigang & Sitaw Bundle', category: 'Fresh Produce & Farm', price: 65, stock: 50, sold_count: 120, shipping_fee: 20, delivery_area: 'Roxas, Oriental Mindoro', description: 'Newly picked green chili and crisp string beans packed same day.', image_url: '' },
    { id: 'demo-p4', seller_id: 'u2', shop_name: 'Mindoro Gadget Hub', title: 'Gaming Phone Cooler Magnetic Radiator RGB', category: 'Smartphones & Tablets', price: 580, stock: 12, sold_count: 29, shipping_fee: 45, delivery_area: 'All Areas', description: 'Instant semiconductor cooling plate for lag-free mobile gaming sessions.', image_url: '' }
  ];
  renderVerifiedShops();
  renderProducts();
}

export function renderVerifiedShops() {
  const list = document.getElementById('mall-shops-list');
  const dropdown = document.getElementById('shop-filter');

  if (!state.allSellers.length) {
    list.innerHTML = `<div style="font-size:0.82rem;color:var(--muted);padding:0.4rem;">No verified shops listed yet.</div>`;
    return;
  }

  list.innerHTML = state.allSellers.map(s => {
    const count = state.allProducts.filter(p => p.seller_id === s.user_id).length;
    const isActive = state.selectedShopId === s.user_id;
    return `
      <div class="mall-shop-tile ${isActive ? 'active' : ''}" onclick="selectShopFilter('${escapeHtml(s.user_id)}')">
        <div class="mall-shop-logo">${escapeHtml((s.shop_name || 'S').charAt(0).toUpperCase())}</div>
        <div class="mall-shop-name">${escapeHtml(s.shop_name)}</div>
        <div class="mall-shop-meta">${count} item${count === 1 ? '' : 's'}</div>
      </div>
    `;
  }).join('');

  dropdown.innerHTML = `<option value="all">All Verified Shops (${state.allSellers.length})</option>` +
    state.allSellers.map(s => `<option value="${escapeHtml(s.user_id)}" ${state.selectedShopId === s.user_id ? 'selected' : ''}>${escapeHtml(s.shop_name)}</option>`).join('');
}

export function selectShopFilter(sellerUserId) {
  state.selectedShopId = (state.selectedShopId === sellerUserId) ? 'all' : sellerUserId;
  updateShopSelectionUI();
  renderVerifiedShops();
  renderProducts();
}

export function handleShopDropdownChange() {
  state.selectedShopId = document.getElementById('shop-filter').value;
  updateShopSelectionUI();
  renderVerifiedShops();
  renderProducts();
}

export function clearShopFilter() {
  state.selectedShopId = 'all';
  updateShopSelectionUI();
  renderVerifiedShops();
  renderProducts();
}

export function updateShopSelectionUI() {
  const banner = document.getElementById('selected-shop-banner');
  const hero = document.getElementById('hero-showcase-banner');
  const clearTop = document.getElementById('clear-shop-top-btn');
  const dropdown = document.getElementById('shop-filter');
  if (dropdown) dropdown.value = state.selectedShopId;

  if (state.selectedShopId === 'all') {
    banner.classList.add('hidden');
    hero.classList.remove('hidden');
    clearTop.classList.add('hidden');
  } else {
    const shop = state.allSellers.find(s => s.user_id === state.selectedShopId);
    banner.classList.remove('hidden');
    hero.classList.add('hidden');
    clearTop.classList.remove('hidden');
    document.getElementById('selected-shop-title').textContent = shop?.shop_name || 'Seller Shop';
    document.getElementById('selected-shop-sub').textContent = `${shop?.location || 'Local Verified Seller'} • ${shop?.phone || ''}`;
    document.getElementById('selected-shop-avatar').textContent = (shop?.shop_name || 'S').charAt(0).toUpperCase();
  }
}

export function openSelectedShopChat() {
  if (state.selectedShopId === 'all') return;
  const shop = state.allSellers.find(s => s.user_id === state.selectedShopId);
  openDirectChat(state.selectedShopId, shop?.shop_name || 'Seller');
}

export function renderProducts() {
  const grid = document.getElementById('products-grid');
  const counter = document.getElementById('results-counter');
  const q = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const freeShipOnly = document.getElementById('filter-free-ship')?.checked;
  const inStockOnly = document.getElementById('filter-in-stock')?.checked;

  let filtered = state.allProducts.filter(p => {
    if (state.selectedCategory !== 'All Categories' && p.category !== state.selectedCategory) return false;
    if (state.selectedShopId !== 'all' && p.seller_id !== state.selectedShopId) return false;
    if (freeShipOnly && Number(p.shipping_fee || 0) > 0) return false;
    if (inStockOnly && Number(p.stock || 0) <= 0) return false;
    if (q) {
      const hay = `${p.title || ''} ${p.category || ''} ${p.shop_name || ''} ${p.description || ''} ${p.delivery_area || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (state.priceSortMode === 'price-asc') {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (state.priceSortMode === 'price-desc') {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  } else if (state.sortMode === 'sales') {
    filtered.sort((a, b) => Number(b.sold_count || 0) - Number(a.sold_count || 0));
  } else if (state.sortMode === 'latest') {
    filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  } else {
    filtered.sort((a, b) => (Number(b.sold_count || 0) * 2 + Number(b.stock || 0)) - (Number(a.sold_count || 0) * 2 + Number(a.stock || 0)));
  }

  counter.textContent = `Showing ${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No products matched your filter. Try clearing search or selecting "All Categories".</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const imgs = getProductImages(p);
    const stockNum = Number(p.stock ?? 99);
    const outOfStock = stockNum <= 0;
    const freeShip = Number(p.shipping_fee || 0) === 0;
    const shopName = p.shop_name || state.allSellers.find(s => s.user_id === p.seller_id)?.shop_name || 'Verified Shop';

    return `
      <div class="card" onclick="openExpandedProduct('${escapeHtml(p.id)}')">
        <div class="card-img-wrap">
          <img src="${escapeHtml(imgs[0])}" alt="${escapeHtml(p.title)}" loading="lazy" />
          <span class="card-mall-tag">MALL</span>
          ${outOfStock
            ? `<span class="card-top-badge soldout">SOLD OUT</span>`
            : `<span class="card-top-badge">Stock: ${stockNum}</span>`}
          <div class="card-bottom-overlay">🏪 ${escapeHtml(shopName)}</div>
        </div>
        <div class="card-pure-body">
          <h3 class="card-pure-title">${escapeHtml(p.title)}</h3>
          <div class="card-pure-tags">
            ${freeShip ? `<span class="mini-tag-green">Free Delivery</span>` : `<span class="mini-tag-outline">Ship ${formatPeso(p.shipping_fee)}</span>`}
            <span class="mini-tag-outline">${escapeHtml(p.category || 'Local')}</span>
          </div>
          <div class="card-pure-footer">
            <span class="card-pure-price">${formatPeso(p.price)}</span>
            <span class="card-pure-sold">${Number(p.sold_count || 0)} sold</span>
          </div>
          <div class="card-quick-actions" onclick="event.stopPropagation()">
            <button type="button" class="add-cart-outline" ${outOfStock ? 'disabled' : ''} onclick="addToCartById('${escapeHtml(p.id)}', 1)">
              🛒 Add
            </button>
            <button type="button" class="shop-cta" ${outOfStock ? 'disabled' : ''} onclick="quickBuyNowById('${escapeHtml(p.id)}')">
              ⚡ Buy
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

Object.assign(window, {
  selectCategory,
  quickTagCategory,
  quickTagSearch,
  quickTagFreeShip,
  handleHeaderSearchInput,
  triggerHeaderSearch,
  setSortMode,
  setPriceSort,
  resetAllMarketplaceFilters,
  selectShopFilter,
  handleShopDropdownChange,
  clearShopFilter,
  openSelectedShopChat,
  renderProducts
});
