// =========================================================
// MULTI-SELLER CHECKOUT, VOUCHER DISCOUNT, COD & QR PAYMENT
// =========================================================
import { supabaseClient, COMMISSION_RATE, state } from './config.js';
import { escapeHtml, formatPeso, showToast } from './utils.js';
import { openAuthModal } from './auth.js';
import { saveCartToStorage, closeCartModal, computeShippingForSellerGroup } from './cart.js';
import { loadMarketplaceData } from './marketplace.js';
import { switchView } from './navigation.js';
import { createNotification } from './chat.js';

let appliedCheckoutVoucher = null;

export function selectPaymentMethod(method) {
  state.selectedPaymentMethod = method;
  document.getElementById('pay-card-cod').classList.toggle('active', method === 'COD');
  document.getElementById('pay-card-qr').classList.toggle('active', method === 'QR');
  document.getElementById('checkout-qr-panel').classList.toggle('hidden', method !== 'QR');
}

export async function applyCheckoutVoucher() {
  if (!supabaseClient) return;
  const codeInput = document.getElementById('checkout-voucher-code');
  const msgEl = document.getElementById('checkout-voucher-msg');
  const code = (codeInput?.value || '').trim().toUpperCase();

  if (!code) {
    appliedCheckoutVoucher = null;
    if (msgEl) msgEl.textContent = '';
    if (typeof window.recalculateCartCheckoutTotals === 'function') window.recalculateCartCheckoutTotals();
    return showToast('Enter a shop voucher code first.', 'warning');
  }

  const { data: voucher, error } = await supabaseClient
    .from('vouchers')
    .select('*')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !voucher) {
    appliedCheckoutVoucher = null;
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Invalid or inactive voucher code.'; }
    return;
  }

  if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
    appliedCheckoutVoucher = null;
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ This voucher has already expired.'; }
    return;
  }

  if (Number(voucher.used_count || 0) >= Number(voucher.usage_limit || 0)) {
    appliedCheckoutVoucher = null;
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = '❌ Voucher redemption limit reached.'; }
    return;
  }

  // Check kung may items sa cart galing sa shop na nag-issue ng voucher
  const sellerItems = state.cart.filter(i => i.seller_id === voucher.seller_id);
  const sellerSub = sellerItems.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);

  if (!sellerItems.length) {
    appliedCheckoutVoucher = null;
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = `❌ Voucher "${code}" is only valid for ${voucher.shop_name}.`; }
    return;
  }

  if (sellerSub < Number(voucher.min_spend || 0)) {
    appliedCheckoutVoucher = null;
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = `❌ Minimum spend of ${formatPeso(voucher.min_spend)} at ${voucher.shop_name} required.`; }
    return;
  }

  const rawDisc = voucher.discount_type === 'percent'
    ? sellerSub * (Number(voucher.discount_value) / 100)
    : Number(voucher.discount_value);
  const discountAmt = Math.min(sellerSub, Number(rawDisc.toFixed(2)));

  appliedCheckoutVoucher = { ...voucher, computedDiscount: discountAmt };

  if (msgEl) {
    msgEl.style.color = 'var(--primary-dark)';
    msgEl.textContent = `✅ Applied "${code}" (${voucher.shop_name}): −${formatPeso(discountAmt)} discount!`;
  }

  // I-update ang display ng Grand Total sa checkout summary
  const sub = state.cart.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  const brgy = document.getElementById('checkout-barangay')?.value.trim() || '';
  const grouped = {};
  state.cart.forEach(it => { (grouped[it.seller_id] ||= []).push(it); });
  let shipTotal = 0;
  Object.entries(grouped).forEach(([sid, items]) => {
    shipTotal += computeShippingForSellerGroup(sid, items, brgy);
  });

  const discRow = document.getElementById('checkout-discount-row');
  const discVal = document.getElementById('checkout-discount-val');
  if (discRow && discVal) {
    discRow.classList.remove('hidden');
    discVal.textContent = '-' + formatPeso(discountAmt);
  }
  const grandEl = document.getElementById('checkout-grand-total');
  if (grandEl) grandEl.textContent = formatPeso(Math.max(0, sub + shipTotal - discountAmt));

  showToast(`Voucher applied! Saved ${formatPeso(discountAmt)}`);
}

export function renderCheckoutQrSellers() {
  // Auto-fill buyer profile name, phone & default address kung walang laman pa
  if (state.currentProfile) {
    const nEl = document.getElementById('checkout-name');
    const pEl = document.getElementById('checkout-phone');
    const bEl = document.getElementById('checkout-barangay');
    const aEl = document.getElementById('checkout-address');
    if (nEl && !nEl.value && state.currentProfile.full_name) nEl.value = state.currentProfile.full_name;
    if (pEl && !pEl.value && state.currentProfile.phone) pEl.value = state.currentProfile.phone;
    if (bEl && !bEl.value && state.currentProfile.default_barangay) bEl.value = state.currentProfile.default_barangay;
    if (aEl && !aEl.value && state.currentProfile.default_address) aEl.value = state.currentProfile.default_address;
  }

  const box = document.getElementById('checkout-qr-sellers-list');
  const uniqueSellerIds = [...new Set(state.cart.map(c => c.seller_id))];
  box.innerHTML = uniqueSellerIds.map(sid => {
    const seller = state.allSellers.find(s => s.user_id === sid);
    const shopName = seller?.shop_name || 'Seller Shop';
    const qrImg = seller?.qr_image_url;
    const qrAcct = seller?.qr_account_info || seller?.phone || 'Ask seller in chat for QR details';
    return `
      <div class="qr-preview-box" style="margin-bottom:0.5rem;">
        ${qrImg ? `<img src="${escapeHtml(qrImg)}" alt="QR" onclick="openQrZoom('${escapeHtml(shopName)}', '${escapeHtml(qrImg)}')" />` : ''}
        <div>
          <div style="font-weight:700;font-size:0.84rem;">🏪 ${escapeHtml(shopName)}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.15rem;">${escapeHtml(qrAcct)}</div>
          ${qrImg ? `<div style="font-size:0.72rem;color:var(--primary-dark);margin-top:0.2rem;">Tap QR image to enlarge</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

export function openQrZoom(title, src) {
  document.getElementById('qr-zoom-title').textContent = title;
  document.getElementById('qr-zoom-img').src = src;
  document.getElementById('qr-zoom-modal').classList.remove('hidden');
}

export async function placeOrder() {
  if (!state.currentUser) {
    closeCartModal();
    openAuthModal('signin');
    return showToast('Please sign in first to place your order.', 'warning');
  }
  if (!state.cart.length) return;

  const recipientName = document.getElementById('checkout-name').value.trim();
  const recipientPhone = document.getElementById('checkout-phone').value.trim();
  const barangay = document.getElementById('checkout-barangay').value.trim();
  const address = document.getElementById('checkout-address').value.trim();
  const notes = document.getElementById('checkout-notes').value.trim();
  const qrRef = document.getElementById('checkout-qr-ref').value.trim();

  if (!recipientName || !recipientPhone || !barangay || !address) {
    return showToast('Please complete all delivery details.', 'error');
  }
  if (state.selectedPaymentMethod === 'QR' && !qrRef) {
    return showToast('Please enter your QR / E-Wallet payment reference number.', 'error');
  }

  if (!supabaseClient) {
    state.cart = [];
    saveCartToStorage();
    closeCartModal();
    return showToast('Demo Mode: Order placed successfully!');
  }

  const btn = document.getElementById('place-order-btn');
  btn.disabled = true;

  try {
    const grouped = {};
    state.cart.forEach(item => {
      if (!grouped[item.seller_id]) grouped[item.seller_id] = [];
      grouped[item.seller_id].push(item);
    });

    for (const [sellerId, items] of Object.entries(grouped)) {
      const rawSubtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
      const shippingFee = computeShippingForSellerGroup(sellerId, items, barangay);

      let voucherDiscount = 0;
      let usedVoucherCode = '';
      if (appliedCheckoutVoucher && appliedCheckoutVoucher.seller_id === sellerId && rawSubtotal >= Number(appliedCheckoutVoucher.min_spend || 0)) {
        const calc = appliedCheckoutVoucher.discount_type === 'percent'
          ? rawSubtotal * (Number(appliedCheckoutVoucher.discount_value) / 100)
          : Number(appliedCheckoutVoucher.discount_value);
        voucherDiscount = Math.min(rawSubtotal, Number(calc.toFixed(2)));
        usedVoucherCode = appliedCheckoutVoucher.code;
      }

      const discountedSubtotal = Math.max(0, rawSubtotal - voucherDiscount);
      const totalAmount = discountedSubtotal + shippingFee;
      const adminCommission = Number((discountedSubtotal * COMMISSION_RATE).toFixed(2));
      const sellerNet = Number((totalAmount - adminCommission).toFixed(2));
      const shopName = items[0]?.shop_name || 'Seller Shop';

      const orderPayload = {
        buyer_id: state.currentUser.id,
        buyer_name: recipientName,
        buyer_phone: recipientPhone,
        delivery_barangay: barangay,
        delivery_address: `${barangay} — ${address}`,
        delivery_notes: usedVoucherCode ? `${notes} [Voucher ${usedVoucherCode}: -${formatPeso(voucherDiscount)}]`.trim() : notes,
        seller_id: sellerId,
        shop_name: shopName,
        items: items,
        subtotal_amount: discountedSubtotal,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        admin_commission: adminCommission,
        seller_net_earnings: sellerNet,
        payment_method: state.selectedPaymentMethod,
        payment_reference: state.selectedPaymentMethod === 'QR' ? qrRef : 'COD',
        payment_status: state.selectedPaymentMethod === 'QR' ? 'submitted' : 'unpaid',
        status: 'pending'
      };

      const { error: ordErr } = await supabaseClient.from('orders').insert(orderPayload);
      if (ordErr) throw ordErr;

      if (usedVoucherCode && appliedCheckoutVoucher) {
        await supabaseClient
          .from('vouchers')
          .update({ used_count: Number(appliedCheckoutVoucher.used_count || 0) + 1 })
          .eq('id', appliedCheckoutVoucher.id);
      }

      for (const it of items) {
        const p = state.allProducts.find(x => String(x.id) === String(it.product_id));
        if (p) {
          const newStock = Math.max(0, Number(p.stock || 0) - Number(it.qty));
          const newSold = Number(p.sold_count || 0) + Number(it.qty);
          await supabaseClient.from('products').update({ stock: newStock, sold_count: newSold }).eq('id', p.id);
        }
      }

      await createNotification(
        sellerId,
        'New Customer Order Received',
        `${recipientName} ordered ${items.length} item(s) totaling ${formatPeso(totalAmount)} (${state.selectedPaymentMethod})${usedVoucherCode ? ` using voucher ${usedVoucherCode}` : ''}.`
      );
    }

    appliedCheckoutVoucher = null;
    state.cart = [];
    saveCartToStorage();
    closeCartModal();
    showToast('Order placed! You can track it in My Purchases.');
    await loadMarketplaceData();
    switchView('orders', 'purchases');
  } catch (err) {
    showToast(err.message || 'Failed to place order', 'error');
  } finally {
    btn.disabled = false;
  }
}

Object.assign(window, {
  selectPaymentMethod,
  applyCheckoutVoucher,
  openQrZoom,
  placeOrder
});
