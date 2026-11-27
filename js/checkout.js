// =========================================================
// MULTI-SELLER CHECKOUT, VOUCHER (DISCOUNT + FREE SHIP), COD & QR PAYMENT
// =========================================================
import { supabaseClient, COMMISSION_RATE, state } from './config.js';
import { escapeHtml, formatPeso, showToast } from './utils.js';
import { openAuthModal } from './auth.js';
import { saveCartToStorage, closeCartModal, computeShippingForSellerGroup, toggleCheckoutAddressEdit } from './cart.js';
import { loadMarketplaceData } from './marketplace.js';
import { switchView } from './navigation.js';
import { createNotification } from './chat.js';

export function selectPaymentMethod(method) {
  state.selectedPaymentMethod = method;
  document.getElementById('pay-card-cod')?.classList.toggle('active', method === 'COD');
  document.getElementById('pay-card-qr')?.classList.toggle('active', method === 'QR');
  document.getElementById('checkout-qr-panel')?.classList.toggle('hidden', method !== 'QR');
}

export function renderCheckoutQrSellers() {
  const box = document.getElementById('checkout-qr-sellers-list');
  if (!box) return;
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

  const recipientName = document.getElementById('checkout-name')?.value.trim() || '';
  const recipientPhone = document.getElementById('checkout-phone')?.value.trim() || '';
  const barangay = document.getElementById('checkout-barangay')?.value.trim() || '';
  const address = document.getElementById('checkout-address')?.value.trim() || '';
  const qrRef = document.getElementById('checkout-qr-ref')?.value.trim() || '';

  if (!recipientName || !recipientPhone || !barangay || !address) {
    toggleCheckoutAddressEdit(true);
    return showToast('Please complete your delivery address first.', 'error');
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
    const shopNotesMap = {};
    document.querySelectorAll('.shop-order-note-input').forEach(inp => {
      const sid = inp.getAttribute('data-seller-id');
      if (sid) shopNotesMap[sid] = inp.value.trim();
    });

    const grouped = {};
    state.cart.forEach(item => {
      if (!grouped[item.seller_id]) grouped[item.seller_id] = [];
      grouped[item.seller_id].push(item);
    });

    const activeVoucher = state.appliedCheckoutVoucher || null;

    for (const [sellerId, items] of Object.entries(grouped)) {
      const rawSubtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
      const rawShippingFee = computeShippingForSellerGroup(sellerId, items, barangay);
      const notes = shopNotesMap[sellerId] || '';

      let itemDiscount = 0;
      let shippingDiscount = 0;
      let usedVoucherCode = '';
      let voucherNoteTag = '';

      if (
        activeVoucher &&
        activeVoucher.seller_id === sellerId &&
        rawSubtotal >= Number(activeVoucher.min_spend || 0)
      ) {
        usedVoucherCode = activeVoucher.code;
        if (activeVoucher.discount_type === 'free_shipping') {
          const cap = Number(activeVoucher.discount_value || 0);
          shippingDiscount = cap > 0 ? Math.min(rawShippingFee, cap) : rawShippingFee;
          voucherNoteTag = `[Voucher ${usedVoucherCode}: Free Shipping -${formatPeso(shippingDiscount)}]`;
        } else if (activeVoucher.discount_type === 'percent') {
          const calc = rawSubtotal * (Number(activeVoucher.discount_value) / 100);
          itemDiscount = Math.min(rawSubtotal, Number(calc.toFixed(2)));
          voucherNoteTag = `[Voucher ${usedVoucherCode}: -${formatPeso(itemDiscount)}]`;
        } else {
          itemDiscount = Math.min(rawSubtotal, Number(activeVoucher.discount_value));
          voucherNoteTag = `[Voucher ${usedVoucherCode}: -${formatPeso(itemDiscount)}]`;
        }
      }

      const discountedSubtotal = Math.max(0, rawSubtotal - itemDiscount);
      const finalShippingFee = Math.max(0, rawShippingFee - shippingDiscount);
      const totalAmount = discountedSubtotal + finalShippingFee;
      const adminCommission = Number((discountedSubtotal * COMMISSION_RATE).toFixed(2));
      const sellerNet = Number((totalAmount - adminCommission).toFixed(2));
      const shopName = items[0]?.shop_name || 'Seller Shop';

      const orderPayload = {
        buyer_id: state.currentUser.id,
        buyer_name: recipientName,
        buyer_phone: recipientPhone,
        delivery_barangay: barangay,
        delivery_address: `${barangay} — ${address}`,
        delivery_notes: voucherNoteTag ? `${notes} ${voucherNoteTag}`.trim() : notes,
        seller_id: sellerId,
        shop_name: shopName,
        items: items,
        subtotal_amount: discountedSubtotal,
        shipping_fee: finalShippingFee,
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

      if (usedVoucherCode && activeVoucher) {
        await supabaseClient
          .from('vouchers')
          .update({ used_count: Number(activeVoucher.used_count || 0) + 1 })
          .eq('id', activeVoucher.id);
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

    state.appliedCheckoutVoucher = null;
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
  openQrZoom,
  placeOrder
});
