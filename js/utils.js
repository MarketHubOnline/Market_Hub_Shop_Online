// =========================================================
// SHARED UTILITY & FORMATTING HELPERS
// =========================================================
import { PLACEHOLDER_IMG } from './config.js';

export function showToast(msg, type = 'success') {
  const box = document.getElementById('toast-container');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${escapeHtml(msg)}</span><button style="background:transparent;padding:0;color:#fff;font-size:0.9rem;" onclick="this.parentElement.remove()">✕</button>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatPeso(num) {
  const n = Number(num || 0);
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getProductImages(prod) {
  const imgs = [];
  if (prod.image_url) imgs.push(prod.image_url);
  if (Array.isArray(prod.extra_images)) {
    prod.extra_images.forEach(u => { if (u && !imgs.includes(u)) imgs.push(u); });
  }
  if (imgs.length === 0) imgs.push(PLACEHOLDER_IMG);
  return imgs.slice(0, 2);
}

export function compressImageToDataUrl(file, maxDim = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
