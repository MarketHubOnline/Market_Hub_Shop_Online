// =========================================================
// SUPABASE CONFIGURATION, CONSTANTS & SHARED STATE
// =========================================================
export const SUPABASE_URL = 'https://bitgjlitbtntueoemukz.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_oabcYDwri95eL_BCmMEqvA_A-1XfaQB';

export const supabaseClient = (window.supabase && SUPABASE_URL.startsWith('https://'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export const COMMISSION_RATE = 0.10;

export const CATEGORIES = [
  'All Categories',
  'Fresh Produce & Farm',
  'Smartphones & Tablets',
  'Gadgets & Accessories',
  'Groceries & Pantry',
  'Home & Living',
  'Fashion & Apparel',
  'Health & Beauty',
  'Hardware & Tools'
];

export const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%23f0fdf4'/%3E%3Ctext x='50%25' y='48%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='44'%3E🌿📦%3C/text%3E%3Ctext x='50%25' y='62%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='15' fill='%2315803d'%3EMarketHub Item%3C/text%3E%3C/svg%3E";

export const state = {
  currentUser: null,
  currentProfile: null,
  currentSellerRecord: null,
  allProducts: [],
  allSellers: [],
  allReviews: [],
  sellerOrders: [],
  buyerOrders: [],
  adminSellers: [],
  adminOrders: [],
  notifications: [],
  chatMessages: [],
  activeChatPartnerId: null,
  cart: JSON.parse(localStorage.getItem('markethub_cart') || '[]'),
  selectedCategory: 'All Categories',
  selectedShopId: 'all',
  sortMode: 'popular',
  priceSortMode: '',
  activePdpProduct: null,
  reviewStarFilter: 'all',
  selectedReviewStars: 5,
  selectedPaymentMethod: 'COD',
  productPhotoSlots: [null, null],
  tempBarangayRules: [],
  tempSellerQrUrl: '',
  incomePieChartInstance: null,
  deferredInstallPrompt: null
};
