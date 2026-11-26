// =========================================================
// AUTHENTICATION, USER SESSION & ROLE BADGES
// =========================================================
import { supabaseClient, state } from './config.js';
import { showToast } from './utils.js';
import { loadMarketplaceData, loadDemoFallbackData } from './marketplace.js';
import { updateCartBadge } from './cart.js';
import { loadNotifications, loadChatMessages } from './chat.js';
import { switchView } from './navigation.js';

let authMode = 'signin';

export function openAuthModal(mode = 'signin') {
  switchAuthTab(mode);
  document.getElementById('auth-modal')?.classList.remove('hidden');
}

export function closeAuthModal() {
  document.getElementById('auth-modal')?.classList.add('hidden');
}

export function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-signin')?.classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup')?.classList.toggle('active', mode === 'signup');
  document.getElementById('signup-name-wrap')?.classList.toggle('hidden', mode !== 'signup');
  const submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
}

export async function signInWithGoogle() {
  if (!supabaseClient) return showToast('Configure Supabase URL & Key first.', 'error');
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) showToast(error.message, 'error');
}

export async function handleAuthSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) return showToast('Configure Supabase URL & Key first.', 'error');
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const fullName = document.getElementById('auth-fullname').value.trim();
  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;

  try {
    if (authMode === 'signup') {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName || email.split('@')[0] } }
      });
      if (error) throw error;
      if (data.user) {
        await supabaseClient.from('profiles').upsert({
          id: data.user.id,
          email,
          full_name: fullName || email.split('@')[0],
          role: 'buyer'
        });
      }
      showToast('Account created! You are now signed in.');
      closeAuthModal();
      await loadUserSession();
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast('Welcome back to MarketHub!');
      closeAuthModal();
      await loadUserSession();
    }
  } catch (err) {
    showToast(err.message || 'Authentication failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

export async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  state.currentUser = null;
  state.currentProfile = null;
  state.currentSellerRecord = null;
  updateAuthUI();
  switchView('marketplace');
  showToast('Signed out.');
}

export async function loadUserSession() {
  if (!supabaseClient) {
    loadDemoFallbackData();
    return;
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  state.currentUser = session?.user || null;

  if (state.currentUser) {
    let { data: prof, error: profErr } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', state.currentUser.id)
      .maybeSingle();

    if (profErr) {
      console.error('Profile fetch error:', profErr);
    }

    if (!prof && !profErr) {
      const newProf = {
        id: state.currentUser.id,
        email: state.currentUser.email,
        full_name:
          state.currentUser.user_metadata?.full_name ||
          state.currentUser.user_metadata?.name ||
          state.currentUser.email.split('@')[0],
        role: 'buyer'
      };
      const { data: inserted } = await supabaseClient
        .from('profiles')
        .upsert(newProf, { onConflict: 'id' })
        .select('*')
        .maybeSingle();
      prof = inserted || newProf;
    }

    state.currentProfile = prof || {
      id: state.currentUser.id,
      email: state.currentUser.email,
      full_name:
        state.currentUser.user_metadata?.full_name ||
        state.currentUser.user_metadata?.name ||
        state.currentUser.email.split('@')[0],
      role: 'buyer'
    };

    const { data: sellerRec } = await supabaseClient
      .from('sellers')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .maybeSingle();
    state.currentSellerRecord = sellerRec || null;

    await Promise.all([loadNotifications(), loadChatMessages()]);
  } else {
    state.currentProfile = null;
    state.currentSellerRecord = null;
  }

  updateAuthUI();
  await loadMarketplaceData();
}

export function updateAuthUI() {
  const loggedIn = !!state.currentUser;
  document.getElementById('auth-btn')?.classList.toggle('hidden', loggedIn);
  document.getElementById('logout-btn')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('user-pill')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('role-badge')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-orders-btn')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-chat-btn')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('notif-wrapper')?.classList.toggle('hidden', !loggedIn);

  const role = String(state.currentProfile?.role || 'buyer').trim().toLowerCase();
  const isApprovedSeller = role === 'seller' || state.currentSellerRecord?.status === 'approved';
  const isAdmin = role === 'admin';

  document.getElementById('nav-seller-btn')?.classList.toggle('hidden', !(loggedIn && (isApprovedSeller || isAdmin)));
  document.getElementById('nav-apply-seller-btn')?.classList.toggle('hidden', !(loggedIn && !isApprovedSeller && !isAdmin));
  document.getElementById('nav-admin-btn')?.classList.toggle('hidden', !(loggedIn && isAdmin));

  if (loggedIn) {
    const display =
      state.currentProfile?.full_name ||
      state.currentUser.user_metadata?.full_name ||
      state.currentUser.user_metadata?.name ||
      state.currentUser.email.split('@')[0];

    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar-initial');
    if (nameEl) nameEl.textContent = display;
    if (avatarEl) avatarEl.textContent = display.charAt(0).toUpperCase();

    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = isAdmin ? 'ADMIN' : (isApprovedSeller ? 'SELLER' : 'BUYER');
      badge.className = `badge ${isAdmin ? 'admin' : (isApprovedSeller ? 'seller' : '')}`;
    }
  }
  updateCartBadge();
}

Object.assign(window, {
  openAuthModal,
  closeAuthModal,
  switchAuthTab,
  signInWithGoogle,
  handleAuthSubmit,
  signOut
});
