// =========================================================
// BUYER ORDERS, ORDER TRACKING, REVIEWS & DELIVERY RECEIPT
// =========================================================
import { supabaseClient, state } from './config.js';
import { escapeHtml, formatPeso, showToast } from './utils.js';
import { loadMarketplaceData } from './marketplace.js';

export async function loadBuyerOrders() {
  if (!supabaseClient || !state.currentUser) return;
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
  cancelBuyerOrder,
  openReviewModal,
  closeReviewModal,
  selectReviewStars,
  submitProductReview,
  openReceiptModal,
  closeReceiptModal
});
