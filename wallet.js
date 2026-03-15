/**
 * wallet.js: KriptoEdu Wallet Connector
 * Multi-wallet picker menggunakan EIP-6963 (standar industri modern)
 *
 * EIP-6963 adalah standar resmi Ethereum yang digunakan secara internal
 * oleh Web3Modal, RainbowKit, dan semua dApp profesional. Cara kerjanya:
 *  1. Halaman dispatch event 'eip6963:requestProvider'
 *  2. Setiap wallet extension yang terinstall merespons dengan
 *     'eip6963:announceProvider', mengirimkan { info, provider }
 *     di mana info berisi nama resmi dan ikon wallet tersebut
 *  3. Kita kumpulkan semua respons dan tampilkan sebagai picker
 *
 * Wallet yang didukung secara otomatis (jika terinstall):
 *  MetaMask, Bitget Wallet, Coinbase Wallet, Brave Wallet,
 *  Rainbow, Trust Wallet, Zerion, Rabby, OKX Wallet, dan lainnya.
 *
 * Fallback: window.ethereum untuk wallet lama yang belum support EIP-6963.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPPORTED_CHAIN_ID   = '0x1';
const SUPPORTED_CHAIN_NAME = 'Ethereum Mainnet';

// ── EIP-6963 WALLET DISCOVERY ─────────────────────────────────────────────────
// Map UUID ke wallet agar tidak duplikat jika wallet announce lebih dari sekali
const _discoveredWallets = new Map();

// Pasang listener sebelum dispatch agar tidak ada announce yang terlewat
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail || {};
  // info.uuid = identifier unik, info.name = nama wallet, info.icon = base64 SVG/PNG
  if (info && info.uuid && provider) {
    _discoveredWallets.set(info.uuid, { info, provider });
  }
});

// Minta semua wallet extension yang terinstall untuk announce diri
window.dispatchEvent(new Event('eip6963:requestProvider'));

// ── STATE ─────────────────────────────────────────────────────────────────────
// walletState dibaca oleh donation.js, jangan rename propertinya
let walletState = {
  address:     null,
  chainId:     null,
  isConnected: false,
};

// Provider dari wallet yang sedang aktif (bisa berbeda dengan window.ethereum)
let _activeProvider   = null;
let _activeWalletName = '';

// ── UTILS ─────────────────────────────────────────────────────────────────────

/**
 * Singkat alamat wallet: 6 karakter awal + '...' + 4 karakter akhir
 * Input : '0xAbCd1234567890EfGh'
 * Output: '0xAbCd...EfGh'
 */
function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr || '';
  return addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────

let _toastTimer;

function showToast(message, type = 'info') {
  const toast = document.getElementById('wallet-toast');
  const msg   = document.getElementById('wallet-toast-msg');
  const icon  = document.getElementById('wallet-toast-icon');
  if (!toast) return;

  const map = {
    success: { i: '✅', bg: 'bg-green-500/20',  bd: 'border-green-500/40',  tx: 'text-green-300'  },
    error:   { i: '❌', bg: 'bg-red-500/20',    bd: 'border-red-500/40',    tx: 'text-red-300'    },
    warning: { i: '⚠️', bg: 'bg-yellow-500/20', bd: 'border-yellow-500/40', tx: 'text-yellow-300' },
    info:    { i: 'ℹ️', bg: 'bg-blue-500/20',   bd: 'border-blue-500/40',   tx: 'text-blue-300'   },
  };
  const c = map[type] || map.info;

  toast.className = `fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-md shadow-xl transition-all duration-300 ${c.bg} ${c.bd}`;
  msg.className   = `text-sm font-semibold ${c.tx}`;
  icon.textContent = c.i;
  msg.textContent  = message;
  toast.style.opacity       = '1';
  toast.style.transform     = 'translateY(0)';
  toast.style.pointerEvents = 'auto';

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  const t = document.getElementById('wallet-toast');
  if (!t) return;
  t.style.opacity       = '0';
  t.style.transform     = 'translateY(16px)';
  t.style.pointerEvents = 'none';
}

// ── UI UPDATE ─────────────────────────────────────────────────────────────────

/**
 * Refresh tampilan wallet di seluruh UI.
 * Alamat diambil LIVE dari _activeProvider (provider wallet yang dipilih user),
 * bukan dari window.ethereum, sehingga selalu sinkron dengan akun aktif.
 *
 * Format: substring(0,6) + '...' + substring(length-4)
 */
async function updateWalletUI() {
  const btn   = document.getElementById('wallet-btn');
  const label = document.getElementById('wallet-btn-label');
  const dot   = document.getElementById('wallet-btn-dot');
  const badge = document.getElementById('wallet-address-badge');
  if (!btn) return;

  // Ambil alamat live dari provider aktif (bukan window.ethereum)
  if (walletState.isConnected && _activeProvider) {
    try {
      const liveAccounts = await _activeProvider.request({ method: 'eth_accounts' });

      if (liveAccounts && liveAccounts.length > 0) {
        // Alamat paling baru dari provider, otomatis sinkron jika user ganti akun
        walletState.address = liveAccounts[0];
        sessionStorage.setItem('wallet_address', liveAccounts[0]);
      } else {
        // Provider kosong: user cabut izin atau kunci wallet
        _setDisconnected();
      }
    } catch (_) {
      // Gagal query provider, lanjut render dengan state yang ada
    }
  }

  if (walletState.isConnected && walletState.address) {
    const short = shortenAddress(walletState.address);

    // ── CONNECTED ──────────────────────────────────────────────────────────
    btn.className = [
      'hidden md:inline-flex items-center gap-2',
      'bg-green-500/15 hover:bg-red-500/15',
      'border border-green-500/40 hover:border-red-500/40',
      'text-green-400 hover:text-red-400',
      'text-sm font-semibold px-4 py-2 rounded-full',
      'transition-all duration-200 cursor-pointer group',
    ].join(' ');

    if (label) label.innerHTML = `
      <span class="group-hover:hidden">${short}</span>
      <span class="hidden group-hover:inline">Disconnect</span>`;

    if (dot) dot.className = 'w-2 h-2 rounded-full bg-green-400 group-hover:bg-red-400 transition-colors animate-pulse';

    if (badge) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
        <span class="font-mono">${short}</span>
        ${_activeWalletName ? `<span class="text-green-600 text-xs">${_activeWalletName}</span>` : ''}`;
      badge.className = 'mt-6 inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm px-4 py-2 rounded-full';
      badge.classList.remove('hidden');
    }

  } else {
    // ── DISCONNECTED ───────────────────────────────────────────────────────
    btn.className = 'hidden md:inline-flex items-center gap-2 bg-crypto-purple hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 cursor-pointer';
    if (label) label.innerHTML = '<span>🔗 Connect Wallet</span>';
    if (dot)   dot.className   = 'w-2 h-2 rounded-full bg-white/50';
    if (badge) badge.classList.add('hidden');
  }
}

// ── WALLET PICKER MODAL ───────────────────────────────────────────────────────

/**
 * Tampilkan modal picker dengan semua wallet yang terdeteksi via EIP-6963.
 *
 * Setiap wallet menampilkan:
 *  - Ikon resmi wallet (base64 dari EIP-6963 info.icon)
 *  - Nama wallet (dari info.name)
 *
 * Jika tidak ada EIP-6963 wallet tapi window.ethereum ada (wallet lama),
 * fallback ke connect langsung via window.ethereum.
 * Jika tidak ada wallet sama sekali, tampilkan panduan install.
 */
function showWalletPickerModal() {
  // Tambah delay kecil agar wallet lain punya waktu untuk announce
  // (beberapa wallet memerlukan sedikit waktu setelah page load)
  setTimeout(() => _renderWalletPickerModal(), 50);
}

function _renderWalletPickerModal() {
  const existing = document.getElementById('wallet-picker-modal');
  if (existing) existing.remove();

  // Kumpulkan semua wallet: EIP-6963 + fallback legacy
  const walletList = [..._discoveredWallets.values()];

  // Jika tidak ada EIP-6963 wallet tapi window.ethereum ada (wallet lama)
  if (walletList.length === 0 && typeof window.ethereum !== 'undefined') {
    // Fallback: connect langsung via window.ethereum
    _connectWithProvider(window.ethereum, 'Browser Wallet');
    return;
  }

  // Tidak ada wallet sama sekali
  if (walletList.length === 0) {
    _showNoWalletModal();
    return;
  }

  // Hanya 1 wallet terdeteksi: langsung connect tanpa perlu picker
  if (walletList.length === 1) {
    const { info, provider } = walletList[0];
    _connectWithProvider(provider, info.name);
    return;
  }

  // Lebih dari 1 wallet: tampilkan picker
  const overlay = document.createElement('div');
  overlay.id        = 'wallet-picker-modal';
  overlay.className = 'fixed inset-0 z-[10001] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm px-4 pb-4 sm:pb-0';

  // Render daftar wallet
  const walletButtons = walletList.map(({ info, provider }) => {
    // Escape nama untuk keamanan (hindari XSS)
    const safeName = info.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const iconHtml = info.icon
      ? `<img src="${info.icon}" alt="${safeName}" class="w-10 h-10 rounded-xl object-contain" />`
      : `<div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-2xl">🔗</div>`;

    return `
      <button
        onclick="_pickWallet('${info.uuid}')"
        class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl
               bg-white/5 hover:bg-crypto-purple/20
               border border-white/10 hover:border-crypto-purple/50
               transition-all duration-200 text-left group"
      >
        ${iconHtml}
        <div class="flex-1 min-w-0">
          <p class="font-bold text-white text-base group-hover:text-crypto-purple transition-colors">${safeName}</p>
          <p class="text-slate-500 text-xs mt-0.5">Terdeteksi</p>
        </div>
        <span class="text-slate-600 group-hover:text-crypto-purple transition-colors text-lg">&rarr;</span>
      </button>`;
  }).join('');

  overlay.innerHTML = `
    <div class="absolute inset-0" onclick="_closeWalletPicker()"></div>
    <div class="relative w-full max-w-sm bg-[#0F172A] border border-white/10 rounded-3xl shadow-2xl p-6 z-10">

      <!-- Handle (mobile) -->
      <div class="flex justify-center mb-5">
        <div class="w-10 h-1 bg-white/20 rounded-full"></div>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-xl font-black text-white">Pilih Wallet</h3>
          <p class="text-slate-400 text-xs mt-1">${walletList.length} wallet terdeteksi di browser kamu</p>
        </div>
        <button onclick="_closeWalletPicker()"
          class="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition text-lg">
          &times;
        </button>
      </div>

      <!-- Daftar wallet -->
      <div class="space-y-3 mb-5">
        ${walletButtons}
      </div>

      <!-- Info footer -->
      <p class="text-slate-600 text-xs text-center leading-relaxed">
        Tidak melihat wallet kamu? Pastikan extension-nya sudah aktif di browser.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

/** Dipanggil saat user klik salah satu wallet di picker */
function _pickWallet(uuid) {
  const wallet = _discoveredWallets.get(uuid);
  if (!wallet) return;
  _closeWalletPicker();
  _connectWithProvider(wallet.provider, wallet.info.name);
}

function _closeWalletPicker() {
  const m = document.getElementById('wallet-picker-modal');
  if (m) m.remove();
  document.body.style.overflow = '';
}

// ── CONNECT ───────────────────────────────────────────────────────────────────

/**
 * Connect menggunakan provider spesifik yang dipilih user.
 * Mendukung semua EIP-1193 compatible provider (MetaMask, Bitget, dll).
 */
async function _connectWithProvider(provider, walletName) {
  const btn = document.getElementById('wallet-btn');
  const lbl = document.getElementById('wallet-btn-label');

  if (btn) { btn.disabled = true; }
  if (lbl) { lbl.innerHTML = '<span>Menghubungkan...</span>'; }

  try {
    // Minta izin akses akun (popup dari wallet yang dipilih)
    const accounts = await provider.request({ method: 'eth_requestAccounts' });

    if (!accounts || accounts.length === 0) {
      throw new Error('Tidak ada akun yang dipilih.');
    }

    const chainId = await provider.request({ method: 'eth_chainId' });

    // Set provider aktif dan state
    _activeProvider   = provider;
    _activeWalletName = walletName;

    walletState.address     = accounts[0];
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    sessionStorage.setItem('wallet_connected',    'true');
    sessionStorage.setItem('wallet_address',      accounts[0]);
    sessionStorage.setItem('wallet_provider_name', walletName);

    // Pasang event listeners ke provider yang aktif ini
    _setupActiveProviderListeners(provider);

    // Update UI dengan alamat asli dari provider
    await updateWalletUI();

    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`${walletName} terhubung, tapi kamu di jaringan lain. Ganti ke ${SUPPORTED_CHAIN_NAME} ya! ⚠️`, 'warning');
    } else {
      showToast(`✅ ${walletName} terhubung! ${shortenAddress(accounts[0])}`, 'success');
    }

  } catch (err) {
    if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
      showToast('Koneksi dibatalkan 😅', 'warning');
    } else if (err.code === -32002) {
      showToast(`Buka ${walletName} dan setujui permintaan koneksi`, 'info');
    } else {
      showToast('Gagal connect: ' + (err.message || 'Error tidak diketahui'), 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; }
    updateWalletUI();
  }
}

/** Entry point saat user klik tombol Connect Wallet */
function connectWallet() {
  showWalletPickerModal();
}

// ── DISCONNECT ────────────────────────────────────────────────────────────────

function _setDisconnected() {
  walletState.address     = null;
  walletState.chainId     = null;
  walletState.isConnected = false;
  _activeProvider         = null;
  _activeWalletName       = '';

  sessionStorage.removeItem('wallet_connected');
  sessionStorage.removeItem('wallet_address');
  sessionStorage.removeItem('wallet_provider_name');
}

function disconnectWallet() {
  const prev = walletState.address;
  const name = _activeWalletName;
  _setDisconnected();
  updateWalletUI();
  showToast(`${name ? name + ' ' : ''}Wallet ${shortenAddress(prev)} disconnect. 👋`, 'info');
}

// ── BUTTON HANDLER ────────────────────────────────────────────────────────────

function handleWalletButtonClick() {
  if (walletState.isConnected) {
    disconnectWallet();
  } else {
    connectWallet();
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────

/**
 * Pasang listener ke provider yang sedang aktif saja.
 * Ini penting agar kita tidak bereaksi ke event dari wallet lain
 * yang tidak sedang dipakai user.
 */
function _setupActiveProviderListeners(provider) {
  if (!provider || !provider.on) return;

  // Deteksi ganti akun: update alamat secara otomatis
  provider.on('accountsChanged', (accounts) => {
    if (!accounts || accounts.length === 0) {
      disconnectWallet();
    } else {
      walletState.address = accounts[0];
      sessionStorage.setItem('wallet_address', accounts[0]);
      // updateWalletUI akan fetch ulang dari provider, tampilkan alamat baru
      updateWalletUI();
      showToast(`Akun berganti ke ${shortenAddress(accounts[0])} 🔄`, 'info');
    }
  });

  // Deteksi ganti jaringan
  provider.on('chainChanged', (chainId) => {
    walletState.chainId = chainId;
    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`Jaringan berubah! Gunakan ${SUPPORTED_CHAIN_NAME} ya. ⚠️`, 'warning');
    } else {
      showToast('Beralih ke Ethereum Mainnet ✅', 'success');
    }
  });

  // Beberapa wallet (Coinbase, Bitget) emit event 'disconnect'
  provider.on('disconnect', () => {
    disconnectWallet();
  });
}

// ── NO WALLET INSTALLED ───────────────────────────────────────────────────────

function _showNoWalletModal() {
  const existing = document.getElementById('no-wallet-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'no-wallet-modal';
  overlay.className = 'fixed inset-0 z-[10001] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0';
  overlay.innerHTML = `
    <div class="absolute inset-0" onclick="document.getElementById('no-wallet-modal').remove(); document.body.style.overflow='';"></div>
    <div class="relative w-full max-w-sm bg-[#0F172A] border border-white/10 rounded-3xl shadow-2xl p-7 z-10">

      <div class="flex justify-center mb-5"><div class="w-10 h-1 bg-white/20 rounded-full"></div></div>

      <div class="text-center mb-6">
        <div class="text-5xl mb-3">🔍</div>
        <h3 class="text-xl font-black mb-1">Wallet Tidak Ditemukan</h3>
        <p class="text-slate-400 text-sm">Tidak ada wallet extension yang terdeteksi di browser kamu.</p>
      </div>

      <!-- Opsi install wallet -->
      <div class="space-y-3 mb-5">

        <!-- MetaMask -->
        <a href="https://metamask.io/download/" target="_blank" rel="noopener"
          class="flex items-center gap-4 px-5 py-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/50 hover:bg-orange-500/15 transition group">
          <span class="text-3xl">🦊</span>
          <div class="flex-1">
            <p class="font-bold text-white">MetaMask</p>
            <p class="text-slate-500 text-xs">Install extension gratis</p>
          </div>
          <span class="text-orange-500 text-sm font-bold group-hover:translate-x-0.5 transition-transform">&rarr;</span>
        </a>

        <!-- Bitget Wallet -->
        <a href="https://web3.bitget.com/en/wallet-download" target="_blank" rel="noopener"
          class="flex items-center gap-4 px-5 py-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 hover:border-sky-500/50 hover:bg-sky-500/15 transition group">
          <span class="text-3xl">💼</span>
          <div class="flex-1">
            <p class="font-bold text-white">Bitget Wallet</p>
            <p class="text-slate-500 text-xs">Install extension gratis</p>
          </div>
          <span class="text-sky-500 text-sm font-bold group-hover:translate-x-0.5 transition-transform">&rarr;</span>
        </a>

      </div>

      <!-- Opsi Mobile -->
      <div class="bg-[#1E293B] rounded-2xl p-5 border border-white/5 mb-4">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-xl">📱</span>
          <p class="font-bold text-slate-300 text-sm">Pakai HP? Buka via Browser Wallet</p>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed mb-3">
          Buka aplikasi MetaMask atau Bitget di HP kamu, lalu buka website ini melalui tab <strong class="text-white">Browser</strong> di dalam aplikasinya.
        </p>
        <button
          onclick="copyUrlToClipboard()"
          class="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold py-2.5 rounded-xl transition">
          📋 Salin URL Halaman Ini
        </button>
      </div>

      <button
        onclick="document.getElementById('no-wallet-modal').remove(); document.body.style.overflow='';"
        class="w-full py-2 text-slate-500 hover:text-white text-sm transition">Tutup</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

/** Salin URL halaman ke clipboard */
function copyUrlToClipboard() {
  navigator.clipboard?.writeText(window.location.href).then(() => {
    showToast('URL disalin! Buka di browser wallet kamu 📱', 'success');
  }).catch(() => {
    showToast('URL: ' + window.location.href, 'info');
  });
}

// ── RESTORE SESSION ───────────────────────────────────────────────────────────

/**
 * Coba pulihkan session dari sebelumnya tanpa popup.
 * Cocokkan alamat di sessionStorage dengan akun aktif di provider.
 *
 * Karena EIP-6963 listener dipasang sebelum DOMContentLoaded,
 * wallet sudah sempat announce diri sebelum restoreSession dipanggil.
 */
async function restoreSession() {
  const wasSaved    = sessionStorage.getItem('wallet_connected');
  const savedAddr   = sessionStorage.getItem('wallet_address');
  const savedWallet = sessionStorage.getItem('wallet_provider_name');

  if (!wasSaved || !savedAddr) return;

  // Cari provider yang cocok: coba semua EIP-6963 wallet dulu
  const walletList = [..._discoveredWallets.values()];
  let restoredProvider   = null;
  let restoredWalletName = savedWallet || 'Wallet';

  for (const { info, provider } of walletList) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0 &&
          accounts[0].toLowerCase() === savedAddr.toLowerCase()) {
        restoredProvider   = provider;
        restoredWalletName = info.name;
        break;
      }
    } catch (_) { /* provider gagal diquery, skip */ }
  }

  // Fallback ke window.ethereum jika tidak ketemu di EIP-6963
  if (!restoredProvider && typeof window.ethereum !== 'undefined') {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0 &&
          accounts[0].toLowerCase() === savedAddr.toLowerCase()) {
        restoredProvider   = window.ethereum;
        restoredWalletName = savedWallet || 'Browser Wallet';
      }
    } catch (_) { /* ignore */ }
  }

  if (!restoredProvider) {
    // Tidak bisa restore, bersihkan session
    sessionStorage.removeItem('wallet_connected');
    sessionStorage.removeItem('wallet_address');
    sessionStorage.removeItem('wallet_provider_name');
    return;
  }

  try {
    const chainId = await restoredProvider.request({ method: 'eth_chainId' });

    _activeProvider   = restoredProvider;
    _activeWalletName = restoredWalletName;

    walletState.address     = savedAddr;
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    _setupActiveProviderListeners(restoredProvider);
    await updateWalletUI();

    showToast(`${restoredWalletName} ${shortenAddress(savedAddr)} terhubung kembali 🔗`, 'success');

  } catch (_) {
    sessionStorage.removeItem('wallet_connected');
    sessionStorage.removeItem('wallet_address');
    sessionStorage.removeItem('wallet_provider_name');
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function initWallet() {
  // Pasang event listener ke tombol wallet
  ['wallet-btn', 'wallet-btn-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handleWalletButtonClick);
  });

  // Render UI awal (disconnected state)
  updateWalletUI();

  // Re-request announce agar wallet yang lambat tidak terlewat
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  // Restore session setelah sedikit delay
  // (memberi waktu wallet extension untuk announce diri)
  setTimeout(restoreSession, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}
