// =========================================================
// SELLER APPLICATION, SELLER CENTRE (5 TABS) & INCOME ANALYTICS
// =========================================================
import { supabaseClient, COMMISSION_RATE, CATEGORIES, state } from './config.js';
import {
  escapeHtml,
  formatPeso,
  getProductImages,
  uploadCompressedImageToBucket,
  deleteImagesFromBucket,
  showToast
} from './utils.js';
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
  ['home', 'my-products', 'products', 'income', 'shipping'].forEach(t => {
    document.getElementById(`seller-tab-${t}`)?.classList.toggle('hidden', t !== tab);
    document.getElementById(`seller-nav-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'my-products') renderSellerProductsTable();
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
    const shipFee = Number(o.shipping_fee || 0);
    const prodSub = Number(o.subtotal_amount ?? Math.max(0, Number(o.total_amount || 0) - shipFee));
    const comm = Number(o.admin_commission ?? (prodSub * COMMISSION_RATE));
    const netOrder = Number(o.seller_net_earnings ?? (Number(o.total_amount || 0) - comm));

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
            <div style="font-weight:800;font-size:1rem;color:var(--primary-dark);">Total: ${formatPeso(o.total_amount)}</div>
            <div style="font-size:0.74rem;color:var(--green);font-weight:700;">Net After Admin Fee: ${formatPeso(netOrder)}</div>
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

// =========================================================
// INCOME MONITORING: CAPITAL + NET PROFIT (LESS ADMIN FEE),
// SEPARATE RIDER SHIPPING, & DAILY TO MONTHLY PRODUCT SALES
// =========================================================
let incomeGroupMode = 'daily';

export function handleIncomePeriodChange() {
  const period = document.getElementById('income-period-filter')?.value || 'all';
  const dateInput = document.getElementById('income-custom-date');
  const monthInput = document.getElementById('income-custom-month');

  dateInput?.classList.toggle('hidden', period !== 'custom');
  monthInput?.classList.toggle('hidden', period !== 'custom');

  if (period === 'custom') {
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
  }
  renderSellerIncomeAnalytics();
}

export function setIncomeGroupMode(mode) {
  incomeGroupMode = mode;
  const btnDaily = document.getElementById('btn-group-daily');
  const btnMonthly = document.getElementById('btn-group-monthly');
  if (btnDaily && btnMonthly) {
    btnDaily.className = mode === 'daily' ? 'shop-cta sm' : 'secondary sm';
    btnMonthly.className = mode === 'monthly' ? 'shop-cta sm' : 'secondary sm';
  }
  renderSellerIncomeAnalytics();
}

function filterOrdersBySelectedPeriod(orders) {
  const period = document.getElementById('income-period-filter')?.value || 'all';
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA');
  const currentMonthStr = todayStr.slice(0, 7);

  if (period === 'today') {
    return orders.filter(o => new Date(o.created_at).toLocaleDateString('en-CA') === todayStr);
  }
  if (period === '7days') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return orders.filter(o => new Date(o.created_at) >= sevenDaysAgo);
  }
  if (period === 'month') {
    return orders.filter(o => new Date(o.created_at).toLocaleDateString('en-CA').startsWith(currentMonthStr));
  }
  if (period === 'custom') {
    const customDate = document.getElementById('income-custom-date')?.value;
    const customMonth = document.getElementById('income-custom-month')?.value;
    return orders.filter(o => {
      const dStr = new Date(o.created_at).toLocaleDateString('en-CA');
      if (customDate) return dStr === customDate;
      if (customMonth) return dStr.startsWith(customMonth);
      return true;
    });
  }
  return orders;
}

export function renderSellerIncomeAnalytics() {
  const nonCancelledOrders = state.sellerOrders.filter(o => o.status !== 'cancelled');
  const activeOrders = filterOrdersBySelectedPeriod(nonCancelledOrders);
  const myProds = state.allProducts.filter(p => p.seller_id === state.currentUser?.id);

  const prodCatalogMap = new Map();
  myProds.forEach(p => prodCatalogMap.set(String(p.id), p));

  const productPerfMap = new Map();
  myProds.forEach(p => {
    productPerfMap.set(String(p.id), {
      id: String(p.id),
      title: p.title || 'Unnamed Product',
      ratingAvg: Number(p.rating_avg || 0),
      ratingCount: Number(p.rating_count || 0),
      unitsSold: 0,
      productSales: 0,
      totalCapital: 0,
      adminFee: 0,
      netProfit: 0,
      sellerPayout: 0
    });
  });

  const periodSummaryMap = new Map();

  let totalProductSales = 0;
  let totalCapitalCost = 0;
  let totalRiderShipping = 0;
  let totalAdminFee = 0;
  let totalNetProfit = 0;
  let totalSellerPayout = 0;

  let deliveredPayout = 0;
  let deliveredNetProfit = 0;
  let pendingPayout = 0;
  let pendingNetProfit = 0;

  const orderRowsHtml = activeOrders.map(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    const riderShipFee = Number(o.shipping_fee || 0);
    const grossTotal = Number(o.total_amount || 0);
    const prodSales = Number(o.subtotal_amount ?? Math.max(0, grossTotal - riderShipFee));

    let orderCapital = 0;
    items.forEach(item => {
      const qty = Number(item.qty || 1);
      const itemPrice = Number(item.price || 0);
      const itemLineSales = itemPrice * qty;

      const catalogProd = prodCatalogMap.get(String(item.product_id || item.id));
      const unitCost = Number(item.cost_price ?? catalogProd?.cost_price ?? 0);
      const itemLineCost = unitCost * qty;
      const itemLineComm = itemLineSales * COMMISSION_RATE;
      const itemLineNetProfit = itemLineSales - itemLineCost - itemLineComm;
      const itemLineSellerPayout = itemLineCost + itemLineNetProfit;

      orderCapital += itemLineCost;

      const key = String(item.product_id || item.id || item.title);
      if (!productPerfMap.has(key)) {
        productPerfMap.set(key, {
          id: key,
          title: item.title || 'Product',
          ratingAvg: Number(catalogProd?.rating_avg || 0),
          ratingCount: Number(catalogProd?.rating_count || 0),
          unitsSold: 0,
          productSales: 0,
          totalCapital: 0,
          adminFee: 0,
          netProfit: 0,
          sellerPayout: 0
        });
      }
      const perf = productPerfMap.get(key);
      perf.unitsSold += qty;
      perf.productSales += itemLineSales;
      perf.totalCapital += itemLineCost;
      perf.adminFee += itemLineComm;
      perf.netProfit += itemLineNetProfit;
      perf.sellerPayout += itemLineSellerPayout;
    });

    const orderAdminFee = Number(o.admin_commission ?? (prodSales * COMMISSION_RATE));
    const orderNetProfit = prodSales - orderCapital - orderAdminFee;
    const orderSellerPayout = prodSales - orderAdminFee;

    totalProductSales += prodSales;
    totalCapitalCost += orderCapital;
    totalRiderShipping += riderShipFee;
    totalAdminFee += orderAdminFee;
    totalNetProfit += orderNetProfit;
    totalSellerPayout += orderSellerPayout;

    if (o.status === 'delivered') {
      deliveredPayout += orderSellerPayout;
      deliveredNetProfit += orderNetProfit;
    } else {
      pendingPayout += orderSellerPayout;
      pendingNetProfit += orderNetProfit;
    }

    const dObj = new Date(o.created_at);
    const periodKey = incomeGroupMode === 'monthly'
      ? dObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
      : dObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const sortStamp = incomeGroupMode === 'monthly'
      ? dObj.toISOString().slice(0, 7)
      : dObj.toISOString().slice(0, 10);

    if (!periodSummaryMap.has(periodKey)) {
      periodSummaryMap.set(periodKey, {
        label: periodKey,
        sortStamp,
        orderCount: 0,
        capital: 0,
        netProfit: 0,
        adminFee: 0,
        sellerPayout: 0,
        riderShipping: 0,
        itemQtyMap: {}
      });
    }
    const bucket = periodSummaryMap.get(periodKey);
    bucket.orderCount += 1;
    bucket.capital += orderCapital;
    bucket.netProfit += orderNetProfit;
    bucket.adminFee += orderAdminFee;
    bucket.sellerPayout += orderSellerPayout;
    bucket.riderShipping += riderShipFee;
    items.forEach(it => {
      const t = it.title || 'Item';
      bucket.itemQtyMap[t] = (bucket.itemQtyMap[t] || 0) + Number(it.qty || 1);
    });

    return `
      <tr>
        <td><strong>#${escapeHtml(String(o.id).slice(0, 8).toUpperCase())}</strong></td>
        <td>${dObj.toLocaleDateString()}</td>
        <td><span class="badge status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
        <td>${formatPeso(prodSales)}</td>
        <td style="color:#475569;">${formatPeso(orderCapital)}</td>
        <td style="color:var(--danger);">-${formatPeso(orderAdminFee)}</td>
        <td style="color:${orderNetProfit >= 0 ? 'var(--primary-dark)' : 'var(--danger)'};font-weight:700;">${formatPeso(orderNetProfit)}</td>
        <td style="background:#f0fdf4;color:var(--primary-deep);font-weight:800;">${formatPeso(orderSellerPayout)}</td>
        <td style="color:#0284c7;font-weight:600;">${formatPeso(riderShipFee)}</td>
      </tr>
    `;
  });

  const grossCollectedFromBuyers = totalProductSales + totalRiderShipping;

  document.getElementById('inc-kpi-seller-payout').textContent = formatPeso(totalSellerPayout);
  document.getElementById('inc-kpi-capital').textContent = formatPeso(totalCapitalCost);
  document.getElementById('inc-kpi-net-tubo').textContent = formatPeso(totalNetProfit);
  document.getElementById('inc-kpi-commission').textContent = '-' + formatPeso(totalAdminFee);
  document.getElementById('inc-kpi-shipping').textContent = formatPeso(totalRiderShipping);

  document.getElementById('ledger-product-sales').textContent = formatPeso(totalProductSales);
  document.getElementById('ledger-commission-deduct').textContent = '-' + formatPeso(totalAdminFee);
  document.getElementById('ledger-seller-payout').textContent = formatPeso(totalSellerPayout);
  document.getElementById('ledger-capital-cost').textContent = formatPeso(totalCapitalCost);
  document.getElementById('ledger-net-tubo').textContent = formatPeso(totalNetProfit);
  document.getElementById('ledger-shipping-sales').textContent = formatPeso(totalRiderShipping);
  document.getElementById('ledger-gross-total').textContent = formatPeso(grossCollectedFromBuyers);
  document.getElementById('ledger-delivered-payout').textContent = formatPeso(deliveredPayout);
  document.getElementById('ledger-delivered-net').textContent = formatPeso(deliveredNetProfit);
  document.getElementById('ledger-pending-payout').textContent = formatPeso(pendingPayout);
  document.getElementById('ledger-pending-net').textContent = formatPeso(pendingNetProfit);

  const ctx = document.getElementById('seller-income-pie-chart');
  if (ctx && window.Chart) {
    if (state.incomePieChartInstance) state.incomePieChartInstance.destroy();
    const safeNetProfit = Math.max(0, totalNetProfit);
    const hasData = (safeNetProfit + totalCapitalCost + totalAdminFee + totalRiderShipping) > 0;
    state.incomePieChartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Net Profit', 'Capital Cost', 'Admin Fee (10%)', 'Rider Shipping (Separate)'],
        datasets: [{
          data: hasData ? [safeNetProfit, totalCapitalCost, totalAdminFee, totalRiderShipping] : [1, 0, 0, 0],
          backgroundColor: ['#16a34a', '#64748b', '#f59e0b', '#0ea5e9'],
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

  const periodTbody = document.getElementById('seller-period-summary-tbody');
  const sortedPeriods = Array.from(periodSummaryMap.values()).sort((a, b) => b.sortStamp.localeCompare(a.sortStamp));

  if (!sortedPeriods.length) {
    periodTbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);">No sales recorded for the selected date or month.</td></tr>`;
  } else {
    periodTbody.innerHTML = sortedPeriods.map(row => {
      const topEntry = Object.entries(row.itemQtyMap).sort((a, b) => b[1] - a[1])[0];
      const topProdLabel = topEntry ? `${escapeHtml(topEntry[0])} (${topEntry[1]} sold)` : '—';
      return `
        <tr>
          <td><strong>${escapeHtml(row.label)}</strong></td>
          <td>${row.orderCount}</td>
          <td><span class="badge ship-free">🔥 ${topProdLabel}</span></td>
          <td style="color:#475569;">${formatPeso(row.capital)}</td>
          <td style="color:${row.netProfit >= 0 ? 'var(--primary-dark)' : 'var(--danger)'};font-weight:700;">${formatPeso(row.netProfit)}</td>
          <td style="color:var(--danger);">-${formatPeso(row.adminFee)}</td>
          <td style="background:#f0fdf4;color:var(--primary-deep);font-weight:800;">${formatPeso(row.sellerPayout)}</td>
          <td style="color:#0284c7;font-weight:600;">${formatPeso(row.riderShipping)}</td>
        </tr>
      `;
    }).join('');
  }

  const rateTbody = document.getElementById('seller-product-rate-tbody');
  const rankedProducts = Array.from(productPerfMap.values()).sort((a, b) => b.unitsSold - a.unitsSold || b.netProfit - a.netProfit);

  if (!rankedProducts.length) {
    rateTbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);">No products or sales data available yet.</td></tr>`;
  } else {
    rateTbody.innerHTML = rankedProducts.map((p, idx) => {
      const rankBadge = idx === 0 && p.unitsSold > 0
        ? '<span class="badge seller">🥇 #1 Best Seller</span>'
        : idx === 1 && p.unitsSold > 0
          ? '<span class="badge">🥈 #2</span>'
          : idx === 2 && p.unitsSold > 0
            ? '<span class="badge">🥉 #3</span>'
            : `#${idx + 1}`;
      const starDisplay = p.ratingCount > 0
        ? `<strong style="color:#d97706;">${p.ratingAvg.toFixed(1)} ★</strong> <span style="font-size:0.72rem;color:var(--muted);">(${p.ratingCount})</span>`
        : `<span style="font-size:0.74rem;color:var(--muted);">No ratings</span>`;

      return `
        <tr>
          <td>${rankBadge}</td>
          <td><strong>${escapeHtml(p.title)}</strong></td>
          <td>${starDisplay}</td>
          <td><strong>${p.unitsSold}</strong> sold</td>
          <td>${formatPeso(p.productSales)}</td>
          <td style="color:#475569;">${formatPeso(p.totalCapital)}</td>
          <td style="color:var(--danger);">-${formatPeso(p.adminFee)}</td>
          <td style="color:${p.netProfit >= 0 ? 'var(--primary-dark)' : 'var(--danger)'};font-weight:700;">${formatPeso(p.netProfit)}</td>
          <td style="background:#f0fdf4;color:var(--primary-deep);font-weight:800;">${formatPeso(p.sellerPayout)}</td>
        </tr>
      `;
    }).join('');
  }

  const tbody = document.getElementById('seller-income-table-body');
  if (!orderRowsHtml.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);">No orders found for the selected filter.</td></tr>`;
  } else {
    tbody.innerHTML = orderRowsHtml.join('');
  }
}

// =========================================================
// PRODUCT POST, CAPITAL/PROFIT CALCULATOR, STOCKS & FREE SHIP
// =========================================================
export function toggleProductShippingFeeInput() {
  const isFree = document.getElementById('prod-is-free-ship').value === 'true';
  const feeInput = document.getElementById('prod-shipping-fee');
  const feeWrap = document.getElementById('prod-shipping-fee-wrap');
  if (isFree) {
    feeInput.value = 0;
    feeInput.disabled = true;
    feeWrap.style.opacity = '0.55';
  } else {
    feeInput.disabled = false;
    feeWrap.style.opacity = '1';
  }
}

export function updateProductProfitPreview() {
  const price = Number(document.getElementById('prod-price').value || 0);
  const cost = Number(document.getElementById('prod-cost-price')?.value || 0);
  const comm = price * COMMISSION_RATE;
  const netProfit = price - cost - comm;

  document.getElementById('prev-sell-price').textContent = formatPeso(price);
  if (document.getElementById('prev-cost-price')) {
    document.getElementById('prev-cost-price').textContent = formatPeso(cost);
  }
  document.getElementById('prev-comm-fee').textContent = formatPeso(comm);
  const netEl = document.getElementById('prev-net-unit');
  netEl.textContent = formatPeso(netProfit);
  netEl.style.color = netProfit >= 0 ? 'var(--primary-dark)' : 'var(--danger)';
}

export function triggerSlotFile(slotIdx) {
  document.getElementById(`slot-file-${slotIdx}`).click();
}

export async function handleSlotFileChange(slotIdx, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    showToast('Compressing & uploading photo...', 'success');
    const folder = `products/${state.currentUser?.id || 'seller'}`;
    const publicUrl = await uploadCompressedImageToBucket(file, folder, 900, 0.78);
    state.productPhotoSlots[slotIdx] = publicUrl;
    refreshPhotoSlotsUI();
    showToast('Photo uploaded to Storage!');
  } catch (err) {
    showToast(err.message || 'Could not upload image.', 'error');
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
  const isFreeShip = document.getElementById('prod-is-free-ship').value === 'true';
  const shipFeeVal = isFreeShip ? 0 : Number(document.getElementById('prod-shipping-fee').value || 0);

  const payload = {
    seller_id: state.currentUser.id,
    shop_name: state.currentSellerRecord?.shop_name || state.currentProfile?.full_name || 'Seller Shop',
    title: document.getElementById('prod-title').value.trim(),
    category: document.getElementById('prod-category').value,
    cost_price: Number(document.getElementById('prod-cost-price').value || 0),
    price: Number(document.getElementById('prod-price').value),
    stock: parseInt(document.getElementById('prod-stock').value, 10) || 0,
    delivery_area: document.getElementById('prod-area').value.trim() || state.currentSellerRecord?.location || 'All Areas',
    is_free_shipping: isFreeShip,
    shipping_fee: shipFeeVal,
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
    await loadSellerDashboard();
    switchSellerTab('my-products');
  } catch (err) {
    showToast(err.message || 'Failed to save product', 'error');
  } finally {
    btn.disabled = false;
  }
}

export function editSellerProduct(productId) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;

  switchSellerTab('products');

  document.getElementById('edit-product-id').value = prod.id;
  document.getElementById('prod-title').value = prod.title || '';
  document.getElementById('prod-category').value = prod.category || CATEGORIES[1];
  document.getElementById('prod-cost-price').value = prod.cost_price ?? 0;
  document.getElementById('prod-price').value = prod.price || '';
  document.getElementById('prod-stock').value = prod.stock ?? 0;
  document.getElementById('prod-area').value = prod.delivery_area || '';

  const isFree = prod.is_free_shipping === true || Number(prod.shipping_fee || 0) === 0;
  document.getElementById('prod-is-free-ship').value = isFree ? 'true' : 'false';
  document.getElementById('prod-shipping-fee').value = isFree ? 0 : (prod.shipping_fee ?? 0);
  toggleProductShippingFeeInput();

  document.getElementById('prod-desc').value = prod.description || '';

  const rawImgs = [];
  if (prod.image_url) rawImgs.push(prod.image_url);
  if (Array.isArray(prod.extra_images)) rawImgs.push(...prod.extra_images);
  state.productPhotoSlots = [rawImgs[0] || null, rawImgs[1] || null];
  refreshPhotoSlotsUI();
  updateProductProfitPreview();

  document.getElementById('product-form-heading').textContent = '✏️ Edit Product Listing';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');
  document.getElementById('save-product-btn').textContent = '💾 Update Product';
  document.getElementById('seller-product-form-panel')?.scrollIntoView({ behavior: 'smooth' });
}

export function resetProductForm() {
  document.getElementById('product-form').reset();
  document.getElementById('edit-product-id').value = '';
  document.getElementById('prod-cost-price').value = 0;
  document.getElementById('prod-is-free-ship').value = 'false';
  toggleProductShippingFeeInput();
  state.productPhotoSlots = [null, null];
  refreshPhotoSlotsUI();
  updateProductProfitPreview();
  document.getElementById('product-form-heading').textContent = '➕ Post New Product';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
  document.getElementById('save-product-btn').textContent = '💾 Save & Publish Product';
}

export async function adjustProductStock(productId, delta) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;
  const newStock = Math.max(0, Number(prod.stock || 0) + delta);
  const { error } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', productId);
  if (error) return showToast(error.message, 'error');
  prod.stock = newStock;
  renderSellerProductsTable();
  showToast(`Stock updated to ${newStock}.`);
}

export async function setDirectProductStock(productId, rawVal) {
  const newStock = Math.max(0, parseInt(rawVal, 10) || 0);
  const { error } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', productId);
  if (error) return showToast(error.message, 'error');
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (prod) prod.stock = newStock;
  renderSellerProductsTable();
  showToast(`Stock set to ${newStock}.`);
}

export async function toggleProductFreeShipping(productId) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  if (!prod) return;

  const currentlyFree = prod.is_free_shipping === true || Number(prod.shipping_fee || 0) === 0;
  const makeFree = !currentlyFree;
  const fallbackFee = Number(state.currentSellerRecord?.default_shipping_fee || 50);
  const newFee = makeFree ? 0 : (fallbackFee > 0 ? fallbackFee : 50);

  const { error } = await supabaseClient
    .from('products')
    .update({ is_free_shipping: makeFree, shipping_fee: newFee })
    .eq('id', productId);

  if (error) return showToast(error.message, 'error');
  prod.is_free_shipping = makeFree;
  prod.shipping_fee = newFee;
  renderSellerProductsTable();
  showToast(makeFree ? 'Item set to Free Shipping!' : `Item set to With Shipping Fee (${formatPeso(newFee)}).`);
}

export async function deleteSellerProduct(productId) {
  const prod = state.allProducts.find(p => String(p.id) === String(productId));
  const title = prod?.title || 'this product';
  if (!confirm(`Permanently delete "${title}" from your store and database?`)) return;

  try {
    const urlsToRemove = [prod?.image_url, ...(Array.isArray(prod?.extra_images) ? prod.extra_images : [])].filter(Boolean);

    const { error } = await supabaseClient
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', state.currentUser.id);

    if (error) throw error;

    await deleteImagesFromBucket(urlsToRemove);

    showToast('Product permanently deleted from database!');
    await loadMarketplaceData();
    await loadSellerDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to delete product.', 'error');
  }
}

export function renderSellerProductsTable() {
  const tbody = document.getElementById('seller-products-tbody');
  if (!tbody) return;

  const shipFilter = document.getElementById('seller-prod-ship-filter')?.value || 'all';
  const searchTerm = (document.getElementById('seller-prod-search')?.value || '').trim().toLowerCase();
  let myProds = state.allProducts.filter(p => p.seller_id === state.currentUser?.id);

  if (shipFilter === 'free') {
    myProds = myProds.filter(p => p.is_free_shipping === true || Number(p.shipping_fee || 0) === 0);
  } else if (shipFilter === 'paid') {
    myProds = myProds.filter(p => p.is_free_shipping !== true && Number(p.shipping_fee || 0) > 0);
  }

  if (searchTerm) {
    myProds = myProds.filter(p => `${p.title || ''} ${p.category || ''}`.toLowerCase().includes(searchTerm));
  }

  const countBadge = document.getElementById('seller-products-count');
  if (countBadge) countBadge.textContent = `${myProds.length} Item${myProds.length === 1 ? '' : 's'}`;

  if (!myProds.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:1.5rem;">No products found. Click <strong>"➕ Add New Product"</strong> to publish your first item!</td></tr>`;
    return;
  }

  tbody.innerHTML = myProds.map(p => {
    const price = Number(p.price || 0);
    const cost = Number(p.cost_price || 0);
    const comm = price * COMMISSION_RATE;
    const netProfit = price - cost - comm;
    const isFree = p.is_free_shipping === true || Number(p.shipping_fee || 0) === 0;
    const stockVal = Number(p.stock ?? 0);

    return `
      <tr>
        <td><img src="${escapeHtml(getProductImages(p)[0])}" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" /></td>
        <td>
          <strong>${escapeHtml(p.title)}</strong>
          <div style="font-size:0.72rem;color:var(--muted);">${escapeHtml(p.category || '')}</div>
        </td>
        <td style="color:#475569;">${formatPeso(cost)}</td>
        <td><strong>${formatPeso(price)}</strong></td>
        <td style="color:${netProfit >= 0 ? 'var(--primary-dark)' : 'var(--danger)'};font-weight:700;">${formatPeso(netProfit)}</td>
        <td>
          <button type="button" class="sm ${isFree ? 'success-btn' : 'secondary'}" onclick="toggleProductFreeShipping('${escapeHtml(p.id)}')" title="Click to switch between Free Shipping and With Shipping Fee">
            ${isFree ? '🚚 Free Shipping' : `📦 With Fee (${formatPeso(p.shipping_fee)})`}
          </button>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:0.25rem;">
            <button type="button" class="secondary sm" style="padding:0.2rem 0.5rem;" onclick="adjustProductStock('${escapeHtml(p.id)}', -1)">−</button>
            <input type="number" min="0" value="${stockVal}" onchange="setDirectProductStock('${escapeHtml(p.id)}', this.value)" style="width:58px;text-align:center;padding:0.22rem;font-size:0.8rem;" />
            <button type="button" class="secondary sm" style="padding:0.2rem 0.5rem;" onclick="adjustProductStock('${escapeHtml(p.id)}', 1)">+</button>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:0.35rem;">
            <button class="secondary sm" onclick="editSellerProduct('${escapeHtml(p.id)}')">✏️ Edit</button>
            <button class="danger-outline sm" onclick="deleteSellerProduct('${escapeHtml(p.id)}')">🗑️ Delete</button>
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
  try {
    showToast('Uploading QR image...', 'success');
    const folder = `qr/${state.currentUser?.id || 'seller'}`;
    state.tempSellerQrUrl = await uploadCompressedImageToBucket(file, folder, 650, 0.85);
    renderSellerQrPreview();
    showToast('QR image uploaded!');
  } catch (err) {
    showToast(err.message || 'Could not upload QR image.', 'error');
  }
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
  handleIncomePeriodChange,
  setIncomeGroupMode,
  renderSellerIncomeAnalytics,
  toggleProductShippingFeeInput,
  updateProductProfitPreview,
  triggerSlotFile,
  handleSlotFileChange,
  removePhotoSlot,
  saveProduct,
  editSellerProduct,
  resetProductForm,
  adjustProductStock,
  setDirectProductStock,
  toggleProductFreeShipping,
  deleteSellerProduct,
  renderSellerProductsTable,
  addBarangayRate,
  removeBarangayRate,
  handleSellerQrUpload,
  clearSellerQrImage,
  saveSellerShippingAndQr
});
