// =========================================================
// NOTIFICATIONS, LIVE BUYER-SELLER CHAT & APP BOOTSTRAP
// =========================================================
import { supabaseClient, state } from './config.js';
import { escapeHtml, showToast } from './utils.js';
import { openAuthModal, loadUserSession } from './auth.js';
import { initPwaHandlers } from './navigation.js';
import { initCategoriesUI } from './marketplace.js';
import './productDetail.js';
import './cart.js';
import './checkout.js';
import './orders.js';
import './seller.js';
import './admin.js';

export async function createNotification(userId, title, message) {
  if (!supabaseClient || !userId) return;
  await supabaseClient.from('notifications').insert({
    user_id: userId,
    title,
    message,
    is_read: false
  });
}

export async function loadNotifications() {
  if (!supabaseClient || !state.currentUser) return;
  const { data } = await supabaseClient
    .from('notifications')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('created_at', { ascending: false })
    .limit(25);
  state.notifications = data || [];
  renderNotifications();
}

export function renderNotifications() {
  const unread = state.notifications.filter(n => !n.is_read).length;
  const badge = document.getElementById('notif-badge');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);

  const list = document.getElementById('notif-list');
  if (!state.notifications.length) {
    list.innerHTML = `<div style="padding:1rem;text-align:center;color:var(--muted);font-size:0.82rem;">No notifications yet.</div>`;
    return;
  }

  list.innerHTML = state.notifications.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotificationRead('${escapeHtml(n.id)}')">
      <div class="notif-item-top">
        <span class="notif-title">${escapeHtml(n.title)}</span>
        <span class="notif-time">${new Date(n.created_at).toLocaleDateString()}</span>
      </div>
      <div class="notif-desc">${escapeHtml(n.message)}</div>
    </div>
  `).join('');
}

export function toggleNotifDropdown(e) {
  e.stopPropagation();
  document.getElementById('notif-dropdown').classList.toggle('hidden');
}

export async function markNotificationRead(id) {
  if (!supabaseClient) return;
  await supabaseClient.from('notifications').update({ is_read: true }).eq('id', id);
  await loadNotifications();
}

export async function markAllNotificationsRead() {
  if (!supabaseClient || !state.currentUser) return;
  await supabaseClient.from('notifications').update({ is_read: true }).eq('user_id', state.currentUser.id);
  await loadNotifications();
}

export async function clearAllNotifications() {
  if (!supabaseClient || !state.currentUser) return;
  if (!state.notifications.length) {
    return showToast('Notification history is already empty.', 'warning');
  }
  if (!confirm('Clear all your notification history permanently from the database?')) return;

  const { error } = await supabaseClient
    .from('notifications')
    .delete()
    .eq('user_id', state.currentUser.id);

  if (error) {
    return showToast(error.message || 'Failed to clear notifications.', 'error');
  }

  state.notifications = [];
  renderNotifications();
  showToast('Notification history cleared!');
}

export async function loadChatMessages() {
  if (!supabaseClient || !state.currentUser) return;
  const { data } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`sender_id.eq.${state.currentUser.id},receiver_id.eq.${state.currentUser.id}`)
    .order('created_at', { ascending: true });
  state.chatMessages = data || [];
  renderChatThreads();
  if (state.activeChatPartnerId) renderActiveChatFeed();
}

export function openChatHub() {
  if (!state.currentUser) return openAuthModal('signin');
  loadChatMessages();
  document.getElementById('chat-modal').classList.remove('hidden');
}

export function openDirectChat(partnerId, partnerName, productContext = '') {
  if (!state.currentUser) return openAuthModal('signin');
  if (partnerId === state.currentUser.id) return showToast('You cannot chat with yourself.', 'warning');
  state.activeChatPartnerId = partnerId;
  document.getElementById('chat-modal-title').textContent = `💬 Chat with ${partnerName}`;
  if (productContext) {
    document.getElementById('chat-message-input').value = `Hi! Is "${productContext}" still available?`;
  }
  loadChatMessages();
  document.getElementById('chat-modal').classList.remove('hidden');
}

export function closeChatModal() {
  document.getElementById('chat-modal').classList.add('hidden');
}

export function renderChatThreads() {
  const col = document.getElementById('chat-threads-list');
  const partners = new Map();

  state.chatMessages.forEach(m => {
    const otherId = m.sender_id === state.currentUser.id ? m.receiver_id : m.sender_id;
    const otherName = m.sender_id === state.currentUser.id ? (m.receiver_name || 'User') : (m.sender_name || 'User');
    partners.set(otherId, { id: otherId, name: otherName, lastMsg: m.content });
  });

  if (state.activeChatPartnerId && !partners.has(state.activeChatPartnerId)) {
    const shop = state.allSellers.find(s => s.user_id === state.activeChatPartnerId);
    partners.set(state.activeChatPartnerId, { id: state.activeChatPartnerId, name: shop?.shop_name || 'Seller', lastMsg: 'Start a conversation' });
  }

  if (!partners.size) {
    col.innerHTML = `<div style="padding:0.9rem;font-size:0.78rem;color:var(--muted);">No conversations yet. Click "Chat Seller" on any product!</div>`;
    return;
  }

  col.innerHTML = Array.from(partners.values()).map(p => `
    <div class="chat-thread-item ${state.activeChatPartnerId === p.id ? 'active' : ''}" onclick="selectChatThread('${escapeHtml(p.id)}', '${escapeHtml(p.name)}')">
      <strong style="font-size:0.83rem;display:block;">${escapeHtml(p.name)}</strong>
      <span style="font-size:0.73rem;color:var(--muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.lastMsg)}</span>
    </div>
  `).join('');
}

export function selectChatThread(partnerId, partnerName) {
  state.activeChatPartnerId = partnerId;
  document.getElementById('chat-modal-title').textContent = `💬 Chat with ${partnerName}`;
  renderChatThreads();
  renderActiveChatFeed();
}

export function renderActiveChatFeed() {
  const feed = document.getElementById('chat-messages-feed');
  const threadMsgs = state.chatMessages.filter(m =>
    (m.sender_id === state.currentUser.id && m.receiver_id === state.activeChatPartnerId) ||
    (m.sender_id === state.activeChatPartnerId && m.receiver_id === state.currentUser.id)
  );

  if (!threadMsgs.length) {
    feed.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:0.82rem;margin-top:2rem;">Send your first message below!</div>`;
    return;
  }

  feed.innerHTML = threadMsgs.map(m => {
    const isMine = m.sender_id === state.currentUser.id;
    return `
      <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
        <div>${escapeHtml(m.content)}</div>
        <span class="chat-bubble-meta">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `;
  }).join('');
  feed.scrollTop = feed.scrollHeight;
}

export async function sendChatMessage(e) {
  e.preventDefault();
  if (!supabaseClient || !state.currentUser || !state.activeChatPartnerId) return;
  const input = document.getElementById('chat-message-input');
  const content = input.value.trim();
  if (!content) return;

  const shop = state.allSellers.find(s => s.user_id === state.activeChatPartnerId);
  const myName = state.currentSellerRecord?.shop_name || state.currentProfile?.full_name || state.currentUser.email.split('@')[0];

  input.value = '';
  const { error } = await supabaseClient.from('messages').insert({
    sender_id: state.currentUser.id,
    sender_name: myName,
    receiver_id: state.activeChatPartnerId,
    receiver_name: shop?.shop_name || 'Member',
    content
  });

  if (error) return showToast(error.message, 'error');
  await loadChatMessages();
}

Object.assign(window, {
  toggleNotifDropdown,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
  openChatHub,
  openDirectChat,
  closeChatModal,
  selectChatThread,
  sendChatMessage
});

// =========================================================
// BOOTSTRAP APPLICATION
// =========================================================
initPwaHandlers();
initCategoriesUI();
loadUserSession();
