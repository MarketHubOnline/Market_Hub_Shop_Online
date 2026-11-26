// =========================================================
// VIEW ROUTING & PWA INSTALL PROMPT HANDLERS
// =========================================================
import { state } from './config.js';
import { loadSellerDashboard } from './seller.js';
import { loadAdminDashboard } from './admin.js';
import { loadBuyerOrders } from './orders.js';

export function initPwaHandlers() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.classList.remove('hidden');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.addEventListener('click', () => {
    document.getElementById('notif-dropdown')?.classList.add('hidden');
  });
}

export async function triggerPwaInstall() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  document.getElementById('pwa-install-btn')?.classList.add('hidden');
}

export function switchView(viewName) {
  ['view-marketplace', 'view-product-detail', 'view-seller', 'view-admin', 'view-orders'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById(`view-${viewName}`)?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (viewName === 'seller') loadSellerDashboard();
  if (viewName === 'admin') loadAdminDashboard();
  if (viewName === 'orders') loadBuyerOrders();
}

Object.assign(window, {
  triggerPwaInstall,
  switchView
});
