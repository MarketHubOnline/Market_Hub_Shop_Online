// =========================================================
// ADMIN PANEL: SELLER APPROVALS, SUSPEND, TERMINATE & 10% COMMISSION
// =========================================================
import { supabaseClient, COMMISSION_RATE, state } from './config.js';
import { escapeHtml, formatPeso, showToast } from './utils.js';
import { createNotification } from './chat.js';

export async function loadAdminDashboard() {
  if (!supabaseClient) return;
  const [{ data: sellers }, { data: orders }, { data: profiles }] = await Promise.all([
    supabaseClient.from('sellers').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('orders').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('profiles').select('id')
  ]);

  state.adminSellers = sellers || [];
  state.adminOrders = orders || [];

  const activeOrders = state.adminOrders.filter(o => o.status !== 'cancelled');
  const gmv = activeOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const comm = activeOrders.reduce((s, o) => s + Number(o.admin_commission ?? (Number(o.total_amount || 0) * COMMISSION_RATE)), 0);

  document.getElementById('admin-kpi-gmv').textContent = formatPeso(gmv);
  document.getElementById('admin-kpi-commission').textContent = formatPeso(comm);
  document.getElementById('admin-kpi-pending-sellers').textContent = state.adminSellers.filter(s => s.status === 'pending').length;
  document.getElementById('admin-kpi-users').textContent = (profiles || []).length;

  // Matic itago sa Admin list ang mga 'rejected' applications
  const visibleSellers = state.adminSellers.filter(s => s.status !== 'rejected');

  if (!visibleSellers.length) {
    document.getElementById('admin-sellers-tbody').innerHTML = `
      <tr><td colspan="5" style="text-align:center;color:var(--muted);padding:1rem;">No active or pending seller applications.</td></tr>
    `;
  } else {
    document.getElementById('admin-sellers-tbody').innerHTML = visibleSellers.map(s => {
      const isPending = s.status === 'pending';
      const isApproved = s.status === 'approved';
      const isSuspended = s.status === 'suspended';

      let badgeStyle = '';
      if (isSuspended) badgeStyle = 'background:#fef3c7;color:#b45309;border:1px solid #f59e0b;';

      return `
        <tr>
          <td>${escapeHtml(s.user_id?.slice(0, 8))}</td>
          <td><strong>${escapeHtml(s.shop_name)}</strong></td>
          <td>${escapeHtml(s.phone || '')} • ${escapeHtml(s.location || '')}</td>
          <td><span class="badge status-${escapeHtml(s.status)}" style="${badgeStyle}">${escapeHtml(s.status.toUpperCase())}</span></td>
          <td>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
              ${!isApproved
                ? `<button class="success-btn sm" onclick="updateSellerApproval('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', 'approved')">${isSuspended ? '✓ Reactivate' : '✓ Approve'}</button>`
                : ''}
              ${isPending
                ? `<button class="danger-outline sm" onclick="updateSellerApproval('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', 'rejected')">✕ Reject</button>`
                : ''}
              ${isApproved
                ? `<button class="secondary sm" style="border-color:#f59e0b;color:#b45309;" onclick="updateSellerApproval('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', 'suspended')">⏸ Suspend</button>`
                : ''}
              <button class="danger-outline sm" style="background:#fef2f2;" onclick="terminateAndDeleteSeller('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', '${escapeHtml(s.shop_name)}')" title="Permanently delete shop, products, images & history">
                🗑️ Terminate &amp; Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('admin-orders-tbody').innerHTML = state.adminOrders.map(o => {
    const c = Number(o.admin_commission ?? (Number(o.total_amount || 0) * COMMISSION_RATE));
    return `
      <tr>
        <td><strong>#${escapeHtml(String(o.id).slice(0, 8).toUpperCase())}</strong></td>
        <td>${escapeHtml(o.buyer_name)}</td>
        <td>${escapeHtml(o.shop_name)}</td>
        <td><span class="badge status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
        <td>${formatPeso(o.total_amount)}</td>
        <td style="color:var(--primary-dark);font-weight:700;">${formatPeso(c)}</td>
        <td><button class="secondary sm" onclick="openReceiptModal('${escapeHtml(o.id)}', 'admin')">Receipt</button></td>
      </tr>
    `;
  }).join('');
}

export async function updateSellerApproval(sellerRowId, userId, status) {
  if (status === 'suspended') {
    if (!confirm('Suspend this shop? All their products will be immediately hidden from buyers until reactivated.')) return;
  }
  if (status === 'rejected') {
    if (!confirm('Reject this application? It will be removed from the pending list and notify the applicant.')) return;
  }

  const { error } = await supabaseClient.from('sellers').update({ status }).eq('id', sellerRowId);
  if (error) return showToast(error.message, 'error');

  if (status === 'approved') {
    await supabaseClient.from('profiles').update({ role: 'seller' }).eq('id', userId);
    await createNotification(userId, 'Seller Application Approved!', 'Your shop is now active. Open Seller Centre to manage your products.');
  } else if (status === 'suspended') {
    await supabaseClient.from('profiles').update({ role: 'buyer' }).eq('id', userId);
    await createNotification(userId, 'Shop Account Suspended', 'Your shop has been temporarily suspended due to unpaid admission/fees. Your products are hidden from buyers until settled.');
  } else if (status === 'rejected') {
    await supabaseClient.from('profiles').update({ role: 'buyer' }).eq('id', userId);
    await createNotification(userId, 'Seller Application Rejected', 'Your shop application was rejected by the admin. Check Apply Shop for details or submit a new application.');
  }

  showToast(`Seller status updated to ${status}.`);
  await loadAdminDashboard();
}

export async function terminateAndDeleteSeller(sellerRowId, userId, shopName) {
  const step1 = confirm(`⚠️ TERMINATE SHOP "${shopName}"?\n\nThis will PERMANENTLY DELETE:\n• Shop profile & QR image\n• All products & product photos in Storage\n• All order history & reviews for this shop\n\nThis action CANNOT be undone. Continue?`);
  if (!step1) return;

  try {
    showToast('Cleaning up shop images, products & database history...', 'warning');

    // 1. Kunin lahat ng products at seller record para makuha lahat ng image URLs
    const [{ data: sellerRec }, { data: sellerProds }] = await Promise.all([
      supabaseClient.from('sellers').select('qr_image_url').eq('id', sellerRowId).maybeSingle(),
      supabaseClient.from('products').select('id, image_url, extra_images').eq('seller_id', userId)
    ]);

    const urlsToRemove = [];
    if (sellerRec?.qr_image_url) urlsToRemove.push(sellerRec.qr_image_url);

    const prodIds = (sellerProds || []).map(p => {
      if (p.image_url) urlsToRemove.push(p.image_url);
      if (Array.isArray(p.extra_images)) urlsToRemove.push(...p.extra_images);
      return p.id;
    });

    // 2. Burahin lahat ng images sa Supabase Storage bucket (markethub-images)
    const marker = '/object/public/markethub-images/';
    const filePaths = urlsToRemove
      .filter(u => typeof u === 'string' && u.includes(marker))
      .map(u => decodeURIComponent(u.split(marker)[1]));

    if (filePaths.length > 0) {
      await supabaseClient.storage.from('markethub-images').remove(filePaths).catch(err => {
        console.warn('Storage cleanup warning:', err);
      });
    }

    // 3. Burahin ang reviews ng mga products ng seller
    if (prodIds.length > 0) {
      await supabaseClient.from('reviews').delete().in('product_id', prodIds);
    }

    // 4. Burahin ang orders history, products, at seller record sa database
    await supabaseClient.from('orders').delete().eq('seller_id', userId);
    await supabaseClient.from('products').delete().eq('seller_id', userId);
    const { error: delSellerErr } = await supabaseClient.from('sellers').delete().eq('id', sellerRowId);
    if (delSellerErr) throw delSellerErr;

    // 5. Ibalik sa buyer role ang user profile at mag-notify
    await supabaseClient.from('profiles').update({ role: 'buyer' }).eq('id', userId);
    await createNotification(userId, 'Shop Terminated & Removed', `Your shop "${shopName}" and all associated listings/records have been permanently terminated by the administrator.`);

    showToast(`Shop "${shopName}" and all its files/records have been permanently deleted!`);
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to terminate seller.', 'error');
  }
}

Object.assign(window, {
  updateSellerApproval,
  terminateAndDeleteSeller
});
