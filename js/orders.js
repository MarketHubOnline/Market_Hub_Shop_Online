// =========================================================
// ACCOUNT CENTER (MY PROFILE, VOUCHERS, PURCHASES & RECEIPTS)
// =========================================================
import { supabaseClient, state } from './config.js';
import { escapeHtml, formatPeso, uploadCompressedImageToBucket, showToast } from './utils.js';
import { loadMarketplaceData } from './marketplace.js';
import { updateAuthUI } from './auth.js';

let tempProfileAvatarUrl = '';

export function openAccountTab(tabName) {
  ['profile', 'address', 'password', 'purchases', 'vouchers'].forEach(t => {
    document.getElementById(`acct-panel-${t}`)?.classList.toggle('hidden', t !== tabName);
    document.getElementById(`acct-nav-${t}`)?.classList.toggle('active', t === tabName);
  });

  if (tabName === 'profile' || tabName === 'address') populateAccountProfileForm();
  if (tabName === 'vouchers') loadAvailableVouchersWallet();
}

export function populateAccountProfileForm() {
  if (!state.currentUser) return;
  const prof = state.currentProfile || {};
  const email = state.currentUser.email || '';
  const defaultUsername = prof.username || email.split('@')[0] || 'member';
  const fullName = prof.full_name || state.currentUser.user_metadata?.full_name || defaultUsername;

  document.getElementById('acct-sidebar-username').textContent = defaultUsername;
  document.getElementById('prof-username').value = defaultUsername;
  document.getElementById('prof-fullname').value = fullName;
  document.getElementById('prof-email').value = email;
  document.getElementById('prof-phone').value = prof.phone || '';
  document.getElementById('prof-birthday').value = prof.birthday || '';

  const genderVal = prof.gender || 'Male';
  document.querySelectorAll('input[name="prof-gender"]').forEach(r => {
    r.checked = r.value === genderVal;
  });

  tempProfileAvatarUrl = prof.avatar_url || '';
  refreshProfileAvatarUI(fullName);

  // Default Address fields
  const brgyEl = document.getElementById('prof-default-barangay');
  const addrEl = document.getElementById('prof-default-address');
  if (brgyEl) brgyEl.value = prof.default_barangay || '';
  if (addrEl) addrEl.value = prof.default_address || '';
}

function refreshProfileAvatarUI(displayName) {
  const initial = (displayName || 'U').charAt(0).toUpperCase();
  const sideImg = document.getElementById('acct-sidebar-avatar-img');
  const sideInit = document.getElementById('acct-sidebar-avatar-initial');
  const mainImg = document.getElementById('prof-avatar-img');
  const mainInit = document.getElementById('prof-avatar-initial');

  if (tempProfileAvatarUrl) {
    if (sideImg) { sideImg.src = tempProfileAvatarUrl; sideImg.classList.remove('hidden'); }
    if (sideInit) sideInit.classList.add('hidden');
    if (mainImg) { mainImg.src = tempProfileAvatarUrl; mainImg.classList.remove('hidden'); }
    if (mainInit) mainInit.classList.add('hidden');
  } else {
    if (sideImg) sideImg.classList.add('hidden');
    if (sideInit) { sideInit.textContent = initial; sideInit.classList.remove('hidden'); }
    if (mainImg) mainImg.classList.add('hidden');
    if (mainInit) { mainInit.textContent = initial; mainInit.classList.remove('hidden'); }
  }
}

export async function handleProfileAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file || !state.currentUser) return;
  try {
    showToast('Uploading profile photo...', 'success');
    const folder = `avatars/${state.currentUser.id}`;
    tempProfileAvatarUrl = await uploadCompressedImageToBucket(file, folder, 500, 0.82);
    refreshProfileAvatarUI(document.getElementById('prof-fullname').value);
    showToast('Photo ready! Click "Save Profile" to apply.');
  } catch (err) {
    showToast(err.message || 'Avatar upload failed.', 'error');
  }
}

export async function saveUserProfile(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;

  const username = document.getElementById('prof-username').value.trim();
  const fullName = document.getElementById('prof-fullname').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const birthday = document.getElementById('prof-birthday').value || null;
  const gender = document.querySelector('input[name="prof-gender"]:checked')?.value || 'Male';

  const updates = {
    username,
    full_name: fullName,
    phone,
    gender,
    birthday,
    avatar_url: tempProfileAvatarUrl || null
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('id', state.currentUser.id)
    .select()
    .single();

  if (error) return showToast(error.message, 'error');
  state.currentProfile = { ...state.currentProfile, ...data };
  updateAuthUI();
  populateAccountProfileForm();
  showToast('My Profile saved successfully!');
}

export async function saveUserDefaultAddress(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;

  const updates = {
    phone: document.getElementById('prof-phone').value.trim(),
    default_barangay: document.getElementById('prof-default-barangay').value.trim(),
    default_address: document.getElementById('prof-default-address').value.trim()
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('id', state.currentUser.id)
    .select()
    .single();

  if (error) return showToast(error.message, 'error');
  state.currentProfile = { ...state.currentProfile, ...data };
  showToast('Default delivery address saved!');
}

export async function changeUserPassword(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser) return;
  const p1 = document.getElementById('acct-new-pass').value;
  const p2 = document.getElementById('acct-confirm-pass').value;
  if (p1.length < 6) return showToast('Password must be at least 6 characters.', 'warning');
  if (p1 !== p2) return showToast('Passwords do not match.', 'error');

  const { error } = await supabaseClient.auth.updateUser({ password: p1 });
  if (error) return showToast(error.message, 'error');
  document.getElementById('acct-new-pass').value = '';
  document.getElementById('acct-confirm-pass').value = '';
  showToast('Password updated successfully!');
}

export async function loadAvailableVouchersWallet() {
  const grid = document.getElementById('acct-vouchers-grid');
  if (!grid || !supabaseClient) return;

  const { data, error } = await supabaseClient
    .from('vouchers')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state">Could not load vouchers right now.</div>`;
    return;
  }

  const now = new Date();
  const active = (data || []).filter(v => {
    if (v.expires_at && new Date(v.expires_at) < now) return false;
    if (Number(v.used_count || 0) >= Number(v.usage_limit || 0)) return false;
    return true;
  });

  if (!active.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No active shop vouchers available right now. Check back soon!</div>`;
    return;
  }

  grid.innerHTML = active.map(v => {
    const discLabel = v.discount_type === 'percent'
      ? `${Number(v.discount_value)}% OFF`
      : `${formatPeso(v.discount_value)} OFF`;
    const leftCount = Math.max(0, Number(v.usage_limit || 0) - Number(v.used_count || 0));

    return `
      <div style="border:1.5px dashed #16a34a;background:linear-gradient(135deg,#f0fdf4,#ffffff);border-radius:10px;padding:0.9rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <span class="badge seller" style="margin-bottom:0.3rem;display:inline-block;">🏪 ${escapeHtml(v.shop_name)}</span>
          <div style="font-size:1.15rem;font-weight:800;color:var(--primary-dark);">${discLabel}</div>
          <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:0.15rem;">
            Min. Spend: <strong>${formatPeso(v.min_spend)}</strong> • ${leftCount} left
          </div>
          <div style="font-size:0.72rem;color:var(--muted);margin-top:0.15rem;">
            Code: <strong style="color:var(--primary-deep);letter-spacing:0.04em;">${escapeHtml(v.code)}</strong>
            ${v.expires_at ? ` • Valid until ${new Date(v.expires_at).toLocaleDateString()}` : ''}
          </div>
        </div>
        <button type="button" class="shop-cta sm" onclick="copyVoucherCode('${escapeHtml(v.code)}')">📋 Copy Code</button>
      </div>
    `;
  }).join('');
}

export function copyVoucherCode(code) {
  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`Voucher code "${code}" copied! Paste it at Cart Checkout.`);
}

export async function loadBuyerOrders() {
  if (!supabaseClient || !state.currentUser) return;
  populateAccountProfileForm();
  const { data, error } = await supabaseClient
    .from('orders')
    .select('*')
    .eq('buyer_id', state.currentUser.id)
    .order('created_at', { ascending: false });

  if (error) return showToast(error.message, 'error');
  state.buyerOrders = data || [];
  renderBuyerOrders();
}

export function renderBuyerOrders() {
  const container = document.getElementById('buyer-orders-list');
  if (!state.buyerOrders.length) {
    container.innerHTML = `<div class="empty-state">You have no orders yet. Start shopping in the Marketplace!</div>`;
    return;
  }

  const steps = ['pending', 'confirmed', 'shipped', 'delivered'];

  container.innerHTML = state.buyerOrders.map(o => {
    const isCancelled = o.status === 'cancelled';
    const curIdx = steps.indexOf(o.status);
    const itemsList = Array.isArray(o.items) ? o.items : [];

    return `
      <div class="panel">
        <div class="row-between">
          <div>
            <strong>Order #${escapeHtml(String(o.id).slice(0, 8).toUpperCase())}</strong>
            <span class="badge status-${escapeHtml(o.status)}" style="margin-left:0.4rem;">${escapeHtml(o.status)}</span>
            <div style="font-size:0.78rem;color:var(--muted);margin-top:0.2rem;">
              🏪 <strong>${escapeHtml(o.shop_name || 'Seller')}</strong> • ${new Date(o.created_at).toLocaleString()}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.05rem;font-weight:800;color:var(--primary-dark);">${formatPeso(o.total_amount)}</div>
            <div style="font-size:0.74rem;color:var(--muted);">Payment: ${escapeHtml(o.payment_method || 'COD')} (${escapeHtml(o.payment_status || 'pending')})</div>
          </div>
        </div>

        ${isCancelled
          ? `<div class="cancelled-banner">This order was cancelled.</div>`
          : `<div class="order-stepper">
              ${steps.map((st, idx) => `
                <div class="step-item ${idx < curIdx ? 'done' : (idx === curIdx ? 'current' : '')}">
                  <div class="step-dot">${idx < curIdx ? '✓' : idx + 1}</div>
                  <div style="text-transform:capitalize;">${st}</div>
                </div>
              `).join('')}
            </div>`}

        <div style="margin:0.65rem 0;">
          ${itemsList.map(it => `
            <div class="row-between" style="padding:0.45rem 0;border-bottom:1px solid #f1f5f9;">
              <div>
                <span style="font-weight:600;">${escapeHtml(it.title)}</span>
                <span style="color:var(--muted);font-size:0.8rem;"> × ${it.qty}</span>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <strong>${formatPeso(Number(it.price) * Number(it.qty))}</strong>
                ${o.status === 'delivered' ? `<button class="secondary sm" onclick="openReviewModal('${escapeHtml(it.product_id)}', '${escapeHtml(o.id)}', '${escapeHtml(it.title)}')">⭐ Rate</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="row-between" style="margin-top:0.75rem;">
          <div style="font-size:0.78rem;color:var(--text-secondary);">
            📍 Deliver to: <strong>${escapeHtml(o.delivery_address || '')}</strong>
          </div>
          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            <button class="secondary sm" onclick="openReceiptModal('${escapeHtml(o.id)}', 'buyer')">🧾 View Receipt</button>
            <button class="secondary sm" onclick="openDirectChat('${escapeHtml(o.seller_id)}', '${escapeHtml(o.shop_name || 'Seller')}')">💬 Chat Seller</button>
            ${o.status === 'pending' ? `<button class="danger-outline sm" onclick="cancelBuyerOrder('${escapeHtml(o.id)}')">Cancel Order</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export async function cancelBuyerOrder(orderId) {
  if (!confirm('Cancel this pending order?')) return;
  const { error } = await supabaseClient.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
  if (error) return showToast(error.message, 'error');
  showToast('Order cancelled.');
  await loadBuyerOrders();
}

export function openReviewModal(productId, orderId, title) {
  document.getElementById('review-product-id').value = productId;
  document.getElementById('review-order-id').value = orderId;
  document.getElementById('review-product-title').textContent = title;
  document.getElementById('review-comment').value = '';
  selectReviewStars(5);
  document.getElementById('review-modal').classList.remove('hidden');
}

export function closeReviewModal() {
  document.getElementById('review-modal').classList.add('hidden');
}

export function selectReviewStars(n) {
  state.selectedReviewStars = n;
  document.querySelectorAll('#star-picker-row .star-btn').forEach((btn, idx) => {
    btn.classList.toggle('selected', idx < n);
  });
}

export async function submitProductReview() {
  if (!supabaseClient || !state.currentUser) return;
  const productId = document.getElementById('review-product-id').value;
  const orderId = document.getElementById('review-order-id').value;
  const comment = document.getElementById('review-comment').value.trim();

  const { error } = await supabaseClient.from('reviews').insert({
    product_id: productId,
    order_id: orderId,
    buyer_id: state.currentUser.id,
    buyer_name: state.currentProfile?.full_name || 'Verified Buyer',
    rating: state.selectedReviewStars,
    comment
  });

  if (error) return showToast(error.message, 'error');
  closeReviewModal();
  showToast('Thank you for your product review!');
  await loadMarketplaceData();
}

export function openReceiptModal(orderId, source = 'buyer') {
  const pool = source === 'seller' ? state.sellerOrders : (source === 'admin' ? state.adminOrders : state.buyerOrders);
  const o = pool.find(x => String(x.id) === String(orderId));
  if (!o) return;

  const items = Array.isArray(o.items) ? o.items : [];
  const sub = Number(o.subtotal_amount ?? (Number(o.total_amount) - Number(o.shipping_fee || 0)));
  const ship = Number(o.shipping_fee || 0);

  document.getElementById('receipt-content').innerHTML = `
    <div class="receipt-header">
      <div style="font-size:1.15rem;font-weight:800;">🌿 MARKETHUB DELIVERY RECEIPT</div>
      <div style="font-size:0.76rem;color:#475569;">Official Order Waybill &amp; Customer Proof of Purchase</div>
      <div style="font-size:0.8rem;font-weight:700;margin-top:0.3rem;">Order ID: #${escapeHtml(String(o.id).slice(0, 8).toUpperCase())} • Date: ${new Date(o.created_at).toLocaleString()}</div>
    </div>

    <div class="receipt-grid-2">
      <div>
        <div style="font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;">Seller / Merchant</div>
        <strong>${escapeHtml(o.shop_name || 'Verified Seller')}</strong>
      </div>
      <div>
        <div style="font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;">Deliver To (Buyer)</div>
        <strong>${escapeHtml(o.buyer_name)}</strong> (${escapeHtml(o.buyer_phone)})<br/>
        <span>${escapeHtml(o.delivery_address)}</span>
      </div>
    </div>

    <table class="receipt-table">
      <thead>
        <tr>
          <th>Item Description</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Unit Price</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(i => `
          <tr>
            <td>${escapeHtml(i.title)}</td>
            <td style="text-align:center;">${i.qty}</td>
            <td style="text-align:right;">${formatPeso(i.price)}</td>
            <td style="text-align:right;">${formatPeso(Number(i.price) * Number(i.qty))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="receipt-total-box">
      <div class="row-between"><span>Items Subtotal:</span><strong>${formatPeso(sub)}</strong></div>
      <div class="row-between"><span>Delivery Fee:</span><strong>${formatPeso(ship)}</strong></div>
      <div class="row-between" style="font-size:1rem;margin-top:0.35rem;padding-top:0.35rem;border-top:1px solid #94a3b8;">
        <span>TOTAL AMOUNT (${escapeHtml(o.payment_method || 'COD')}):</span>
        <strong>${formatPeso(o.total_amount)}</strong>
      </div>
      <div style="font-size:0.75rem;margin-top:0.35rem;color:#334155;">
        Payment Status: <strong>${escapeHtml((o.payment_status || 'pending').toUpperCase())}</strong> • Ref #: <strong>${escapeHtml(o.payment_reference || 'COD')}</strong>
      </div>
    </div>
  `;

  document.getElementById('receipt-modal').classList.remove('hidden');
}

export function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.add('hidden');
}

Object.assign(window, {
  openAccountTab,
  handleProfileAvatarUpload,
  saveUserProfile,
  saveUserDefaultAddress,
  changeUserPassword,
  loadAvailableVouchersWallet,
  copyVoucherCode,
  cancelBuyerOrder,
  openReviewModal,
  closeReviewModal,
  selectReviewStars,
  submitProductReview,
  openReceiptModal,
  closeReceiptModal
});
