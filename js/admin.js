// =========================================================
// ADMIN PANEL: SELLER APPROVALS & 10% COMMISSION OVERSIGHT
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

  document.getElementById('admin-sellers-tbody').innerHTML = state.adminSellers.map(s => `
    <tr>
      <td>${escapeHtml(s.user_id?.slice(0, 8))}</td>
      <td><strong>${escapeHtml(s.shop_name)}</strong></td>
      <td>${escapeHtml(s.phone || '')} • ${escapeHtml(s.location || '')}</td>
      <td><span class="badge status-${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></td>
      <td>
        <div style="display:flex;gap:0.35rem;">
          <button class="success-btn sm" onclick="updateSellerApproval('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', 'approved')">Approve</button>
          <button class="danger-outline sm" onclick="updateSellerApproval('${escapeHtml(s.id)}', '${escapeHtml(s.user_id)}', 'rejected')">Reject</button>
        </div>
      </td>
    </tr>
  `).join('');

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
  await supabaseClient.from('sellers').update({ status }).eq('id', sellerRowId);
  if (status === 'approved') {
    await supabaseClient.from('profiles').update({ role: 'seller' }).eq('id', userId);
    await createNotification(userId, 'Seller Application Approved!', 'Your shop is now verified. Open Seller Centre to start listing products.');
  }
  showToast(`Seller marked as ${status}.`);
  await loadAdminDashboard();
}

Object.assign(window, {
  updateSellerApproval
});
