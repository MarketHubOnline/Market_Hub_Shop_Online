// =========================================================
// SELLER APPLICATION, SELLER CENTRE (4 TABS) & INCOME PIE CHART
// =========================================================
import { supabaseClient, COMMISSION_RATE, CATEGORIES, state } from './config.js';
import { escapeHtml, formatPeso, getProductImages, compressImageToDataUrl, showToast } from './utils.js';
import { openAuthModal, loadUserSession } from './auth.js';
import { loadMarketplaceData } from './marketplace.js';

export function openSellerApplyModal() {
  if (!state.currentUser) return openAuthModal('signin');
  document.getElementById('seller-apply-modal').classList.remove('hidden');
}

export function closeSellerApplyModal() {
  document.getElementById('seller-apply-modal').classList.add('hidden');
}

export async function submitSellerApplication(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;

  const payload = {
    user_id: state.currentUser.id,
    shop_name: document.getElementById('apply-shop-name').value.trim(),
    phone: document.getElementById('apply-shop-phone').value.trim(),
    location: document.getElementById('apply-shop-location').value.trim(),
    description: document.getElementById('apply-shop-desc').value.trim(),
    status: 'pending'
  };

  const { error } = await supabaseClient.from('sellers').upsert(payload, { onConflict: 'user_id' });
  if (error) return showToast(error.message, 'error');

  closeSellerApplyModal();
  showToast('Seller application submitted! Awaiting admin approval.');
  await loadUserSession();
}

export function switchSellerTab(tab) {
  ['home', 'income', 'products', 'shipping'].forEach(t => {
    document.getElementById(`seller-tab-${t}`)?.classList.toggle('hidden', t !== tab);
    document.getElementById(`seller-nav-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'income') renderSellerIncomeAnalytics();
}

export async function loadSellerDashboard() {
  if (!supabaseClient || !state.currentUser) return;

  const [{ data: sRec }, { data: sOrders }] = await Promise.all([
    supabaseClient.from('sellers').select('*').eq('user_id', state.currentUser.id).maybeSingle(),
    supabaseClient.from('orders').select('*').eq('seller_id', state.currentUser.id).order('created_at', { ascending: false })
  ]);

  state.currentSellerRecord = sRec || state.currentSellerRecord;
  state.sellerOrders = sOrders || [];

  if (state.currentSellerRecord) {
    document.getElementById('seller-shop-subtitle').textContent = `${state.currentSellerRecord.shop_name} • ${state.currentSellerRecord.location || ''}`;
    document.getElementById('ship-shop-name').value = state.currentSellerRecord.shop_name || '';
    document.getElementById('ship-shop-phone').value = state.currentSellerRecord.phone || '';
    document.getElementById('ship-shop-location').value = state.currentSellerRecord.location || '';
    document.getElementById('ship-default-fee').value = Number(state.currentSellerRecord.default_shipping_fee || 0);
    document.getElementById('ship-qr-account').value = state.currentSellerRecord.qr_account_info || '';
    state.tempBarangayRules = Array.isArray(state.currentSellerRecord.barangay_rates) ? [...state.currentSellerRecord.barangay_rates] : [];
    state.tempSellerQrUrl = state.currentSellerRecord.qr_image_url || '';
    renderBarangayRules();
    renderSellerQrPreview();
  }

  const myProds = state.allProducts.filter(p => p.seller_id === state.currentUser.id);
  document.getElementById('seller-kpi-pending').textContent = state.sellerOrders.filter(o => o.status === 'pending').length;
  document.getElementById('seller-kpi-active').textContent = state.sellerOrders.filter(o => ['confirmed', 'shipped'].includes(o.status)).length;
  document.getElementById('seller-kpi-delivered').textContent = state.sellerOrders.filter(o => o.status === 'delivered').length;
  document.getElementById('seller-kpi-listings').textContent = myProds.length;

  renderSellerOrders();
  renderSellerProductsTable();
  renderSellerIncomeAnalytics();
}

export function renderSellerOrders() {
  const filter = document.getElementById('seller-order-status-filter').value;
  const list = document.getElementById('seller-orders-list');
  const filtered = filter === 'all' ? state.sellerOrders : state.sellerOrders.filter(o => o.status === filter);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">No customer orders found for this filter.</div>`;
    return;
  }

  list.innerHTML = filtered.map(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    const comm = Number(o.admin_commission ?? (Number(o.total_amount) * COMMISSION_RATE));
    const net = Number(o.seller_net_earnings ?? (Number(o.total_amount) - comm));

    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:0.9rem;margin-bottom:0.75rem;background:#fafdfb;">
        <div class="row-between">
          <div>
            <strong>Order #${escapeHtml(String(o.id).slice(0, 8).toUpperCase())}</strong>
            <span class="badge status-${escapeHtml(o.status)}" style="margin-left:0.35rem;">${escapeHtml(o.status)}</span>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.2rem;">
              Buyer: <strong>${escapeHtml(o.buyer_name)}</strong> (${escapeHtml(o.buyer_phone)})
            </div>
            <div style="font-size:0.78rem;color:var(--muted);">📍 ${escapeHtml(o.delivery_address)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800;font-size:1rem;color:var(--primary-dark);">Gross: ${formatPeso(o.total_amount)}</div>
            <div style="font-size:0.74rem;color:var(--green);font-weight:700;">Net Profit: ${formatPeso(net)}</div>
            <div style="font-size:0.72rem;color:var(--muted);">
              ${escapeHtml(o.payment_method)} • Ref: <strong>${escapeHtml(o.payment_reference || 'N/A')}</strong> (${escapeHtml(o.payment_status || 'unpaid')})
            </div>
          </div>
        </div>

        <div style="margin:0.55rem 0;padding:0.45rem 0.65rem;background:#fff;border-radius:6px;border:1px solid var(--border);font-size:0.81rem;">
          ${items.map(i => `<div>• ${escapeHtml(i.title)} × <strong>${i.qty}</strong> — ${formatPeso(Number(i.price) * Number(i.qty))}</div>`).join('')}
        </div>

        <div class="row-between" style="margin-top:0.6rem;">
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            ${o.payment_method === 'QR' && o.payment_status !== 'verified'
              ? `<button class="success-btn sm" onclick="verifyQrPayment('${escapeHtml(o.id)}')">✓ Verify QR Payment</button>`
              : ''}
            <button class="secondary sm" onclick="openReceiptModal('${escapeHtml(o.id)}', 'seller')">🧾 Delivery Receipt</button>
            <button class="secondary sm" onclick="openDirectChat('${escapeHtml(o.buyer_id)}', '${escapeHtml(o.buyer_name)}')">💬 Chat Buyer</button>
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center;">
            <select onchange="updateSellerOrderStatus('${escapeHtml(o.id)}', this.value)" style="width:auto;padding:0.32rem 0.55rem;font-size:0.78rem;">
              <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
              <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Shipped</option>
              <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Delivered</option>
              <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export async function verifyQrPayment(orderId) {
  const { error } = await supabaseClient.from('orders').update({ payment_status: 'verified' }).eq('id', orderId);
  if (error) return showToast(error.message, 'error');
  showToast('QR Payment verified!');
  await loadSellerDashboard();
}

export async function updateSellerOrderStatus(orderId, newStatus) {
  const updates = { status: newStatus };
  if (newStatus === 'delivered') updates.payment_status = 'paid';
  const { error } = await supabaseClient.from('orders').update(updates).eq('id', orderId);
  if (error) return showToast(error.message, 'error');
  showToast(`Order marked as ${newStatus}.`);
  await loadSellerDashboard();
}

export function renderSellerIncomeAnalytics() {
  const activeOrders = state.sellerOrders.filter(o => o.status !== 'cancelled');
  let productSales = 0;
  let shippingSales = 0;
  let totalCommission = 0;
  let totalNet = 0;
  let deliveredNet = 0;
  let pendingNet = 0;

  activeOrders.forEach(o => {
    const sub = Number(o.subtotal_amount ?? (Number(o.total_amount) - Number(o.shipping_fee || 0)));
    const ship = Number(o.shipping_fee || 0);
    const gross = Number(o.total_amount || 0);
    const comm = Number(o.admin_commission ?? (gross * COMMISSION_RATE));
    const net = Number(o.seller_net_earnings ?? (gross - comm));

    productSales += sub;
    shippingSales += ship;
    totalCommission += comm;
    totalNet += net;
    if (o.status === 'delivered') deliveredNet += net;
    else pendingNet += net;
  });

  const grossVolume = productSales + shippingSales;

  document.getElementById('inc-kpi-gross').textContent = formatPeso(grossVolume);
  document.getElementById('inc-kpi-shipping').textContent = formatPeso(shippingSales);
  document.getElementById('inc-kpi-commission').textContent = '-' + formatPeso(totalCommission);
  document.getElementById('inc-kpi-net').textContent = formatPeso(totalNet);

  document.getElementById('ledger-product-sales').textContent = formatPeso(productSales);
  document.getElementById('ledger-shipping-sales').textContent = formatPeso(shippingSales);
  document.getElementById('ledger-gross-total').textContent = formatPeso(grossVolume);
  document.getElementById('ledger-commission-deduct').textContent = '-' + formatPeso(totalCommission);
  document.getElementById('ledger-net-profit').textContent = formatPeso(totalNet);
  document.getElementById('ledger-delivered-net').textContent = formatPeso(deliveredNet);
  document.getElementById('ledger-pending-net').textContent = formatPeso(pendingNet);

  const ctx = document.getElementById('seller-income-pie-chart');
  if (ctx && window.Chart) {
    if (state.incomePieChartInstance) state.incomePieChartInstance.destroy();
    const netProductShare = Math.max(0, productSales - totalCommission);
    state.incomePieChartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Net Product Earnings', 'Delivery Fees Collected', 'Admin Commission (10%)'],
        datasets: [{
          data: grossVolume > 0 ? [netProductShare, shippingSales, totalCommission] : [1, 0, 0],
          backgroundColor: ['#16a34a', '#0ea5e9', '#f59e0b'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } }
        }
      }
    });
  }

  const tbody = document.getElementById('seller-income-table-body');
  if (!activeOrders.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);">No completed or active orders yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = activeOrders.map(o => {
    const gross = Number(o.total_amount || 0);
    const comm = Number(o.admin_commission ?? (gross * COMMISSION_RATE));
    const net = Number(o.seller_net_earnings ?? (gross - comm));
    return `
      <tr>
        <td><strong>#${escapeHtml(String(o.id).slice(0, 8).toUpperCase())}</strong></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td><span class="badge status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
        <td>${escapeHtml(o.payment_method || 'COD')}</td>
        <td>${formatPeso(gross)}</td>
        <td style="color:var(--danger);">-${formatPeso(comm)}</td>
        <td style="color:var(--primary-dark);font-weight:700;">${formatPeso(net)}</td>
      </tr>
    `;
  }).join('');
}

export function updateProductProfitPreview() {
  const price = Number(document.getElementById('prod-price').value || 0);
  const comm = price * COMMISSION_RATE;
  const net = price - comm;
  document.getElementById('prev-sell-price').textContent = formatPeso(price);
  document.getElementById('prev-comm-fee').textContent = formatPeso(comm);
  document.getElementById('prev-net-unit').textContent = formatPeso(net);
}

export function triggerSlotFile(slotIdx) {
  document.getElementById(`slot-file-${slotIdx}`).click();
}

export async function handleSlotFileChange(slotIdx, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const compressed = await compressImageToDataUrl(file, 900, 0.78);
    state.productPhotoSlots[slotIdx] = compressed;
    refreshPhotoSlotsUI();
  } catch (err) {
    showToast('Could not process image.', 'error');
  }
}

export function removePhotoSlot(slotIdx, event) {
  event.stopPropagation();
  state.productPhotoSlots[slotIdx] = null;
  document.getElementById(`slot-file-${slotIdx}`).value = '';
  refreshPhotoSlotsUI();
}

export function refreshPhotoSlotsUI() {
  [0, 1].forEach(idx => {
    const val = state.productPhotoSlots[idx];
    const imgEl = document.getElementById(`slot-preview-${idx}`);
    const rmBtn = document.getElementById(`slot-remove-${idx}`);
    const phEl = document.getElementById(`slot-placeholder-${idx}`);
    if (val) {
      imgEl.src = val;
      imgEl.classList.remove('hidden');
      rmBtn.classList.remove('hidden');
      phEl.classList.add('hidden');
    } else {
      imgEl.classList.add('hidden');
      rmBtn.classList.add('hidden');
      phEl.classList.remove('hidden');
    }
  });
}

export async function saveProduct(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;

  const editId = document.getElementById('edit-product-id').value;
  const validPhotos = state.productPhotoSlots.filter(Boolean);
  const payload = {
    seller_id: state.currentUser.id,
    shop_name: state.currentSellerRecord?.shop_name || state.currentProfile?.full_name || 'Seller Shop',
    title: document.getElementById('prod-title').value.trim(),
    category: document.getElementById('prod-category').value,
    price: Number(document.getElementById('prod-price').value),
    stock: parseInt(document.getElementById('prod-stock').value, 10) || 0,
    delivery_area: document.getElementById('prod-area').value.trim() || state.currentSellerRecord?.location || 'All Areas',
    shipping_fee: Number(document.getElementById('prod-shipping-fee').value || 0),
    description: document.getElementById('prod-desc').value.trim(),
    image_url: validPhotos[0] || '',
    extra_images: validPhotos.slice(1)
  };

  const btn = document.getElementById('save-product-btn');
  btn.disabled = true;

  try {
    if (editId) {
      const { error } = await supabaseClient.from('products').update(payload).eq('id', editId);
      if (error) throw error;
      showToast('Product updated!');
    } else {
      const { error } = await supabaseClient.from('products').insert(payload);
      if (error) throw error;
      showToast('New product published!');
    }
    resetProductForm();
    await loadMarketplaceData();
    renderSellerProductsTable();
  } catch (err) {
    showToast(err.message || 'Failed to save product', 'error');
  } finally {
    btn.disabled = false;
  }
}

export function editSellerProduct(productId) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;
  document.getElementById('edit-product-id').value = prod.id;
  document.getElementById('prod-title').value = prod.title || '';
  document.getElementById('prod-category').value = prod.category || CATEGORIES[1];
  document.getElementById('prod-price').value = prod.price || '';
  document.getElementById('prod-stock').value = prod.stock ?? 0;
  document.getElementById('prod-area').value = prod.delivery_area || '';
  document.getElementById('prod-shipping-fee').value = prod.shipping_fee ?? 0;
  document.getElementById('prod-desc').value = prod.description || '';

  const imgs = getProductImages(prod);
  state.productPhotoSlots = [imgs[0] || null, imgs[1] || null];
  refreshPhotoSlotsUI();
  updateProductProfitPreview();

  document.getElementById('product-form-heading').textContent = 'Edit Product Listing';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');
  document.getElementById('save-product-btn').textContent = '💾 Update Product';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function resetProductForm() {
  document.getElementById('product-form').reset();
  document.getElementById('edit-product-id').value = '';
  state.productPhotoSlots = [null, null];
  refreshPhotoSlotsUI();
  updateProductProfitPreview();
  document.getElementById('product-form-heading').textContent = 'Add New Product Listing';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
  document.getElementById('save-product-btn').textContent = '💾 Save & Publish Product';
}

export async function deleteSellerProduct(productId) {
  if (!confirm('Delete this product listing?')) return;
  const { error } = await supabaseClient.from('products').delete().eq('id', productId);
  if (error) return showToast(error.message, 'error');
  showToast('Product deleted.');
  await loadMarketplaceData();
  renderSellerProductsTable();
}

export function renderSellerProductsTable() {
  const tbody = document.getElementById('seller-products-tbody');
  const myProds = state.allProducts.filter(p => p.seller_id === state.currentUser?.id);
  document.getElementById('seller-products-count').textContent = `${myProds.length} Item${myProds.length === 1 ? '' : 's'}`;

  if (!myProds.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);">No products published yet. Use the form above to add your first item!</td></tr>`;
    return;
  }

  tbody.innerHTML = myProds.map(p => {
    const net = Number(p.price) * (1 - COMMISSION_RATE);
    return `
      <tr>
        <td><img src="${escapeHtml(getProductImages(p)[0])}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" /></td>
        <td><strong>${escapeHtml(p.title)}</strong></td>
        <td>${escapeHtml(p.category)}</td>
        <td>${formatPeso(p.price)}</td>
        <td style="color:var(--primary-dark);font-weight:700;">${formatPeso(net)}</td>
        <td>${Number(p.stock ?? 0)}</td>
        <td>
          <div style="display:flex;gap:0.35rem;">
            <button class="secondary sm" onclick="editSellerProduct('${escapeHtml(p.id)}')">Edit</button>
            <button class="danger-outline sm" onclick="deleteSellerProduct('${escapeHtml(p.id)}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

export function addBarangayRate() {
  const nameEl = document.getElementById('new-brgy-name');
  const feeEl = document.getElementById('new-brgy-fee');
  const name = nameEl.value.trim();
  const fee = Number(feeEl.value || 0);
  if (!name) return showToast('Enter a barangay or town name.', 'warning');

  const existingIdx = state.tempBarangayRules.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
  if (existingIdx >= 0) state.tempBarangayRules[existingIdx].fee = fee;
  else state.tempBarangayRules.push({ name, fee });

  nameEl.value = '';
  feeEl.value = '';
  renderBarangayRules();
}

export function removeBarangayRate(idx) {
  state.tempBarangayRules.splice(idx, 1);
  renderBarangayRules();
}

export function renderBarangayRules() {
  const box = document.getElementById('brgy-rules-list');
  if (!state.tempBarangayRules.length) {
    box.innerHTML = `<div style="font-size:0.78rem;color:var(--muted);">No custom barangay rates added yet.</div>`;
    return;
  }
  box.innerHTML = state.tempBarangayRules.map((r, i) => `
    <div class="brgy-rule-card">
      <div>
        <strong style="font-size:0.83rem;">📍 ${escapeHtml(r.name)}</strong>
        <div style="font-size:0.76rem;color:var(--primary-dark);font-weight:700;">${Number(r.fee) === 0 ? 'Free Delivery' : formatPeso(r.fee)}</div>
      </div>
      <button type="button" class="danger-outline sm" onclick="removeBarangayRate(${i})">✕</button>
    </div>
  `).join('');
}

export async function handleSellerQrUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.tempSellerQrUrl = await compressImageToDataUrl(file, 650, 0.85);
  renderSellerQrPreview();
}

export function clearSellerQrImage() {
  state.tempSellerQrUrl = '';
  document.getElementById('ship-qr-file').value = '';
  renderSellerQrPreview();
}

export function renderSellerQrPreview() {
  const wrap = document.getElementById('seller-qr-preview-wrap');
  const img = document.getElementById('seller-qr-preview-img');
  if (state.tempSellerQrUrl) {
    img.src = state.tempSellerQrUrl;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

export async function saveSellerShippingAndQr(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;

  const payload = {
    user_id: state.currentUser.id,
    shop_name: document.getElementById('ship-shop-name').value.trim(),
    phone: document.getElementById('ship-shop-phone').value.trim(),
    location: document.getElementById('ship-shop-location').value.trim(),
    default_shipping_fee: Number(document.getElementById('ship-default-fee').value || 0),
    barangay_rates: state.tempBarangayRules,
    qr_account_info: document.getElementById('ship-qr-account').value.trim(),
    qr_image_url: state.tempSellerQrUrl
  };

  const { error } = await supabaseClient.from('sellers').upsert(payload, { onConflict: 'user_id' });
  if (error) return showToast(error.message, 'error');

  showToast('Shipping rates & QR payment settings saved!');
  await loadUserSession();
  await loadSellerDashboard();
}

Object.assign(window, {
  openSellerApplyModal,
  closeSellerApplyModal,
  submitSellerApplication,
  switchSellerTab,
  loadSellerDashboard,
  renderSellerOrders,
  verifyQrPayment,
  updateSellerOrderStatus,
  updateProductProfitPreview,
  triggerSlotFile,
  handleSlotFileChange,
  removePhotoSlot,
  saveProduct,
  editSellerProduct,
  resetProductForm,
  deleteSellerProduct,
  addBarangayRate,
  removeBarangayRate,
  handleSellerQrUpload,
  clearSellerQrImage,
  saveSellerShippingAndQr
});
