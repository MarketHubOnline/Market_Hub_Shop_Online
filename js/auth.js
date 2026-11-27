// =========================================================
// AUTHENTICATION, USER SESSION & ROLE BADGES
// =========================================================
import { supabaseClient, state } from './config.js';
import { showToast } from './utils.js';
import { loadMarketplaceData, loadDemoFallbackData } from './marketplace.js';
import { updateCartBadge } from './cart.js';
import { loadNotifications, loadChatMessages } from './chat.js';
import { switchView } from './navigation.js';

const SUPER_ADMIN_EMAILS = ['giboaniel@gmail.com'];
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
  const btn = document.getElementById('auth-submit-btn');
  if (btn) btn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
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
      const defaultRole = SUPER_ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'buyer';
      if (data.user) {
        await supabaseClient.from('profiles').upsert({
          id: data.user.id,
          email,
          full_name: fullName || email.split('@')[0],
          role: defaultRole
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
    const userEmail = (state.currentUser.email || '').toLowerCase();
    const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(userEmail);

    let { data: prof } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', state.currentUser.id)
      .maybeSingle();

    if (!prof) {
      const newProf = {
        id: state.currentUser.id,
        email: state.currentUser.email,
        full_name:
          state.currentUser.user_metadata?.full_name ||
          state.currentUser.user_metadata?.name ||
          state.currentUser.email.split('@')[0],
        role: isSuperAdmin ? 'admin' : 'buyer'
      };
      await supabaseClient.from('profiles').upsert(newProf);
      prof = newProf;
    } else if (isSuperAdmin && prof.role !== 'admin') {
      await supabaseClient.from('profiles').update({ role: 'admin' }).eq('id', state.currentUser.id);
      prof.role = 'admin';
    }

    state.currentProfile = prof;

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
  document.getElementById('user-pill')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('role-badge')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-orders-btn')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-chat-btn')?.classList.toggle('hidden', !loggedIn);
  document.getElementById('notif-wrapper')?.classList.toggle('hidden', !loggedIn);

  const userEmail = (state.currentUser?.email || '').toLowerCase();
  const role = String(state.currentProfile?.role || 'buyer').trim().toLowerCase();
  const sellerStatus = state.currentSellerRecord?.status;

  // Kapag suspended o rejected, hindi dapat aktibo ang Seller Centre access maliban kung admin
  const isApprovedSeller = sellerStatus === 'approved' || (role === 'seller' && sellerStatus !== 'suspended' && sellerStatus !== 'rejected');
  const isAdmin = role === 'admin' || SUPER_ADMIN_EMAILS.includes(userEmail);

  document.getElementById('nav-seller-btn')?.classList.toggle('hidden', !(loggedIn && (isApprovedSeller || isAdmin)));
  document.getElementById('nav-apply-seller-btn')?.classList.toggle('hidden', !(loggedIn && !isApprovedSeller && !isAdmin));
  document.getElementById('nav-admin-btn')?.classList.toggle('hidden', !(loggedIn && isAdmin));

  // I-update ang label ng Apply button kung rejected o suspended
  const applyBtn = document.getElementById('nav-apply-seller-btn');
  if (applyBtn && loggedIn && !isApprovedSeller && !isAdmin) {
    if (sellerStatus === 'rejected') {
      applyBtn.innerHTML = '⚠️ Start Selling <span style="background:#ef4444;color:#fff;padding:1px 5px;border-radius:4px;font-size:0.65rem;margin-left:3px;">Rejected</span>';
    } else if (sellerStatus === 'suspended') {
      applyBtn.innerHTML = '⏸ Shop Suspended';
    } else if (sellerStatus === 'pending') {
      applyBtn.innerHTML = '⏳ Application Pending';
    } else {
      applyBtn.textContent = 'Start Selling';
    }
  }

  if (loggedIn) {
    const prof = state.currentProfile || {};
    const display =
      (prof.username && prof.username.trim()) ||
      (prof.full_name && prof.full_name.trim()) ||
      state.currentUser.user_metadata?.full_name ||
      state.currentUser.user_metadata?.name ||
      state.currentUser.email.split('@')[0];

    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar-initial');
    if (nameEl) nameEl.textContent = display;
    if (avatarEl) {
      if (prof.avatar_url) {
        avatarEl.innerHTML = `<img src="${prof.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`;
      } else {
        avatarEl.textContent = display.charAt(0).toUpperCase();
      }
    }

    const badge = document.getElementById('role-badge');
    if (badge) {
      badge.textContent = isAdmin ? 'ADMIN' : (isApprovedSeller ? 'SELLER' : (sellerStatus === 'suspended' ? 'SUSPENDED' : 'BUYER'));
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
  signOut,
  updateAuthUI
});
