/**
 * wallet.js: KriptoEdu Wallet Connector
 *
 * Strategi deteksi (4 lapis, sync-first, semua dibungkus try-catch):
 *
 * Lapis 1 — window.ethereum            (SYNC, selalu ada jika wallet terinstall)
 * Lapis 2 — window.ethereum.providers[] (SYNC, saat 2+ wallet bentrok)
 * Lapis 3 — window.bitkeep.ethereum     (SYNC, slot khusus Bitget)
 * Lapis 4 — EIP-6963                   (ASYNC, untuk nama + ikon resmi)
 *
 * Setiap lapis dibungkus try-catch individual agar error satu lapis
 * tidak membuat lapis lain ikut gagal.
 *
 * Jaminan tombol: setelah connect berhasil, label tombol langsung
 * dirender SYNCHRONOUSLY dengan alamat yang sudah di-slice.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPPORTED_CHAIN_ID   = '0x1';
const SUPPORTED_CHAIN_NAME = 'Ethereum Mainnet';

// ── EIP-6963: pasang listener SEBELUM apapun ──────────────────────────────────
const _eip6963Wallets = new Map(); // uuid → { info, provider }

try {
  window.addEventListener('eip6963:announceProvider', (e) => {
    try {
      const { info, provider } = e.detail || {};
      if (info?.uuid && provider) _eip6963Wallets.set(info.uuid, { info, provider });
    } catch (_) {}
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
} catch (_) {}

// ── STATE ─────────────────────────────────────────────────────────────────────
let walletState = {
  address:     null,
  chainId:     null,
  isConnected: false,
};

let _activeProvider   = null;
let _activeWalletName = '';

// ── UTILS ─────────────────────────────────────────────────────────────────────

/** 0xAbCd...5678 — 6 karakter awal + '...' + 4 karakter akhir */
function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr || '';
  return addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
}

/**
 * Deteksi nama wallet dari property yang di-inject.
 * Seluruh akses property dibungkus try-catch karena beberapa wallet
 * menggunakan Proxy/getter yang bisa throw.
 */
function _detectName(p) {
  try {
    if (!p) return 'Browser Wallet';
    if (p.isBitKeep || p.isBitkeepChrome || p.isBitget) return 'Bitget Wallet';
    if (p.isBraveWallet)                                 return 'Brave Wallet';
    if (p.isCoinbaseWallet || p.isCoinbaseBrowser)       return 'Coinbase Wallet';
    if (p.isRabby)                                       return 'Rabby';
    if (p.isOKExWallet || p.isOkxWallet)                 return 'OKX Wallet';
    if (p.isTrust || p.isTrustWallet)                    return 'Trust Wallet';
    if (p.isPhantom)                                     return 'Phantom';
    if (p.isMetaMask)                                    return 'MetaMask';
  } catch (_) {}
  return 'Browser Wallet';
}

/**
 * Kumpulkan semua provider yang tersedia.
 *
 * Deduplikasi hanya by object identity (seenProviders Set).
 * Sengaja TIDAK deduplikasi by nama — dua wallet berbeda boleh
 * punya nama yang sama (misalnya dua ekstensi "Browser Wallet"),
 * dan kita tidak mau membuang salah satunya.
 *
 * Setiap lapis dibungkus try-catch individual.
 */
function _gatherWallets() {
  const result       = [];
  const seenProviders = new Set();

  function _add(provider, name, icon, id) {
    try {
      if (!provider) return;
      if (seenProviders.has(provider)) return; // provider object sama, skip
      seenProviders.add(provider);
      result.push({
        id:   id || ('w' + result.length),
        name: name || 'Browser Wallet',
        icon: icon || null,
        provider,
      });
    } catch (_) {}
  }

  // ── Lapis 1: window.ethereum ──────────────────────────────────────────────
  try {
    if (typeof window.ethereum !== 'undefined' && window.ethereum) {
      _add(window.ethereum, _detectName(window.ethereum), null, 'eth');
    }
  } catch (_) {}

  // ── Lapis 2: window.ethereum.providers[] ─────────────────────────────────
  // Dibuat saat 2+ wallet terinstall dan keduanya inject ke window.ethereum.
  // Array ini berisi provider asli masing-masing wallet.
  try {
    const provs = window.ethereum?.providers;
    if (Array.isArray(provs)) {
      provs.forEach((p, i) => {
        try { _add(p, _detectName(p), null, 'provs' + i); } catch (_) {}
      });
    }
  } catch (_) {}

  // ── Lapis 3: slot khusus Bitget ───────────────────────────────────────────
  const bitkeepCandidates = [
    [() => window.bitkeep?.ethereum,      'bk0'],
    [() => window.bitgetWallet?.ethereum, 'bk1'],
    [() => window.isBitKeep?.ethereum,    'bk2'],
  ];
  bitkeepCandidates.forEach(([getter, id]) => {
    try {
      const p = getter();
      if (p) _add(p, 'Bitget Wallet', null, id);
    } catch (_) {}
  });

  // ── Lapis 4: EIP-6963 ─────────────────────────────────────────────────────
  // Upgrade nama & ikon untuk provider yang sudah ada via Lapis 1-3.
  // Tambahkan provider baru yang hanya ada di EIP-6963.
  try {
    for (const { info, provider } of _eip6963Wallets.values()) {
      try {
        if (seenProviders.has(provider)) {
          // Provider sudah ada — upgrade nama & ikon ke versi resmi
          const entry = result.find(w => w.provider === provider);
          if (entry) {
            entry.name = info.name || entry.name;
            entry.icon = info.icon || entry.icon;
          }
        } else {
          // Provider baru dari EIP-6963
          _add(provider, info.name, info.icon, info.uuid);
        }
      } catch (_) {}
    }
  } catch (_) {}

  return result;
}

// ── TOAST ─────────────────────────────────────────────────────────────────────

let _toastTimer;

function showToast(message, type = 'info') {
  try {
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

    toast.className       = `fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-md shadow-xl transition-all duration-300 ${c.bg} ${c.bd}`;
    msg.className         = `text-sm font-semibold ${c.tx}`;
    icon.textContent      = c.i;
    msg.textContent       = message;
    toast.style.opacity       = '1';
    toast.style.transform     = 'translateY(0)';
    toast.style.pointerEvents = 'auto';

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, 3500);
  } catch (_) {}
}

function hideToast() {
  try {
    const t = document.getElementById('wallet-toast');
    if (!t) return;
    t.style.opacity       = '0';
    t.style.transform     = 'translateY(16px)';
    t.style.pointerEvents = 'none';
  } catch (_) {}
}

// ── RENDER HELPERS (SYNC) ─────────────────────────────────────────────────────

/**
 * Render tombol + badge saat TERHUBUNG.
 * Dipanggil SYNCHRONOUSLY, tidak ada await, tidak ada Promise.
 * Ini yang menjamin label tombol PASTI berubah segera setelah connect.
 */
function _renderConnected(short) {
  try {
    const btn   = document.getElementById('wallet-btn');
    const label = document.getElementById('wallet-btn-label');
    const dot   = document.getElementById('wallet-btn-dot');
    const badge = document.getElementById('wallet-address-badge');

    if (btn) {
      btn.className = [
        'hidden md:inline-flex items-center gap-2',
        'bg-green-500/15 hover:bg-red-500/15',
        'border border-green-500/40 hover:border-red-500/40',
        'text-green-400 hover:text-red-400',
        'text-sm font-semibold px-4 py-2 rounded-full',
        'transition-all duration-200 cursor-pointer group',
      ].join(' ');
      btn.disabled = false;
    }

    if (label) {
      label.innerHTML = `
        <span class="group-hover:hidden">${short}</span>
        <span class="hidden group-hover:inline">Disconnect</span>`;
    }

    if (dot) {
      dot.className = 'w-2 h-2 rounded-full bg-green-400 group-hover:bg-red-400 transition-colors animate-pulse';
    }

    if (badge) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
        <span class="font-mono">${short}</span>
        ${_activeWalletName ? `<span class="text-green-600 text-xs">&middot; ${_activeWalletName}</span>` : ''}`;
      badge.className = 'mt-6 inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm px-4 py-2 rounded-full';
      badge.classList.remove('hidden');
    }
  } catch (_) {}
}

/**
 * Render tombol saat TIDAK TERHUBUNG.
 * Juga synchronous.
 */
function _renderDisconnected() {
  try {
    const btn   = document.getElementById('wallet-btn');
    const label = document.getElementById('wallet-btn-label');
    const dot   = document.getElementById('wallet-btn-dot');
    const badge = document.getElementById('wallet-address-badge');

    if (btn) {
      btn.className = 'hidden md:inline-flex items-center gap-2 bg-crypto-purple hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 cursor-pointer';
      btn.disabled = false;
    }
    if (label) label.innerHTML = '<span>🔗 Connect Wallet</span>';
    if (dot)   dot.className   = 'w-2 h-2 rounded-full bg-white/50';
    if (badge) badge.classList.add('hidden');
  } catch (_) {}
}

/**
 * Async refresh: ambil alamat terkini dari provider aktif.
 * Hanya untuk sinkronisasi jika user ganti akun di MetaMask.
 * UI sudah dirender oleh _renderConnected/_renderDisconnected sebelumnya.
 */
async function updateWalletUI() {
  if (!walletState.isConnected || !_activeProvider) {
    _renderDisconnected();
    return;
  }

  try {
    const live = await _activeProvider.request({ method: 'eth_accounts' });
    if (live?.length > 0) {
      walletState.address = live[0];
      sessionStorage.setItem('wallet_address', live[0]);
      _renderConnected(shortenAddress(live[0]));
    } else {
      _clearState();
      _renderDisconnected();
    }
  } catch (_) {
    // Provider gagal diquery — render dengan state yang ada
    if (walletState.isConnected && walletState.address) {
      _renderConnected(shortenAddress(walletState.address));
    } else {
      _renderDisconnected();
    }
  }
}

// ── CONNECT: ENTRY POINT ──────────────────────────────────────────────────────

function connectWallet() {
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch (_) {}

  // Cek sync LANGSUNG — window.ethereum tersedia segera jika wallet terinstall
  const wallets = _gatherWallets();

  if (wallets.length > 0) {
    _processWallets(wallets);
    return;
  }

  // Tidak ada wallet sync. Tunggu 300ms untuk EIP-6963 late announce.
  const lbl = document.getElementById('wallet-btn-label');
  const origLabel = lbl ? lbl.innerHTML : '';
  if (lbl) lbl.innerHTML = '<span>Mendeteksi wallet...</span>';

  setTimeout(() => {
    if (lbl && lbl.innerHTML.includes('Mendeteksi')) lbl.innerHTML = origLabel;
    const retried = _gatherWallets();
    if (retried.length > 0) {
      _processWallets(retried);
    } else {
      _showNoWalletModal();
    }
  }, 300);
}

function _processWallets(wallets) {
  if (wallets.length === 1) {
    _connectWith(wallets[0]);
  } else {
    _showPickerModal(wallets);
  }
}

// ── PICKER MODAL ──────────────────────────────────────────────────────────────

function _showPickerModal(wallets) {
  try { document.getElementById('wallet-picker-modal')?.remove(); } catch (_) {}
  window._walletPickerList = wallets;

  const buttons = wallets.map((w, i) => {
    const safeName = (w.name || 'Wallet').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let iconHtml;
    if (w.icon) {
      iconHtml = `<img src="${w.icon}" alt="${safeName}" class="w-10 h-10 rounded-xl object-contain flex-shrink-0" />`;
    } else {
      const emojiMap = {
        'metamask':        '🦊',
        'bitget wallet':   '💼',
        'coinbase wallet': '🔵',
        'brave wallet':    '🦁',
        'trust wallet':    '🛡️',
        'rabby':           '🐰',
        'okx wallet':      '⭕',
        'rainbow':         '🌈',
        'phantom':         '👻',
      };
      const emoji = emojiMap[safeName.toLowerCase()] || '🔗';
      iconHtml = `<div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-2xl flex-shrink-0">${emoji}</div>`;
    }
    return `
      <button
        onclick="try{if(window._walletPickerList)_connectWith(window._walletPickerList[${i}]);}catch(e){} _closePickerModal();"
        class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl bg-white/5 hover:bg-crypto-purple/15 border border-white/10 hover:border-crypto-purple/40 transition-all duration-150 text-left group"
      >
        ${iconHtml}
        <div class="flex-1 min-w-0">
          <p class="font-bold text-white text-sm group-hover:text-crypto-purple transition-colors">${safeName}</p>
          <p class="text-slate-500 text-xs mt-0.5">Terdeteksi &middot; siap digunakan</p>
        </div>
        <span class="text-slate-600 group-hover:text-crypto-purple text-lg transition-colors">&#8250;</span>
      </button>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id        = 'wallet-picker-modal';
  overlay.className = 'fixed inset-0 z-[10002] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm px-4 pb-4 sm:pb-0';
  overlay.innerHTML = `
    <div class="absolute inset-0" onclick="_closePickerModal()"></div>
    <div class="relative w-full max-w-sm bg-[#0F172A] border border-white/10 rounded-3xl shadow-2xl z-10 overflow-hidden">
      <div class="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
        <div>
          <h3 class="text-lg font-black text-white">Pilih Wallet</h3>
          <p class="text-slate-500 text-xs mt-0.5">${wallets.length} wallet terdeteksi</p>
        </div>
        <button onclick="_closePickerModal()"
          class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition text-xl leading-none">&times;</button>
      </div>
      <div class="p-4 space-y-2.5 max-h-80 overflow-y-auto">${buttons}</div>
      <div class="px-6 pb-5 pt-2">
        <p class="text-slate-600 text-xs text-center">Tidak melihat walletmu? Pastikan extension-nya aktif di browser.</p>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function _closePickerModal() {
  try { document.getElementById('wallet-picker-modal')?.remove(); } catch (_) {}
  document.body.style.overflow = '';
  try { delete window._walletPickerList; } catch (_) {}
}

// ── CONNECT DENGAN PROVIDER SPESIFIK ─────────────────────────────────────────

async function _connectWith(wallet) {
  const { name, provider } = wallet;

  // Tampilkan loading di tombol
  const btn = document.getElementById('wallet-btn');
  const lbl = document.getElementById('wallet-btn-label');
  if (btn) btn.disabled = true;
  if (lbl) lbl.innerHTML = `<span>Menghubungkan...</span>`;

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) throw new Error('Tidak ada akun yang dipilih.');

    const chainId = await provider.request({ method: 'eth_chainId' });

    // Simpan state
    _activeProvider   = provider;
    _activeWalletName = name;

    walletState.address     = accounts[0];
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    sessionStorage.setItem('wallet_connected',     'true');
    sessionStorage.setItem('wallet_address',       accounts[0]);
    sessionStorage.setItem('wallet_provider_name', name);

    _attachListeners(provider);

    // ── JAMINAN TOMBOL ───────────────────────────────────────────────────────
    // Panggil _renderConnected SYNCHRONOUSLY dengan alamat yang sudah di-slice.
    // Ini menjamin label tombol berubah SEGERA, tanpa menunggu Promise apapun.
    const short = shortenAddress(accounts[0]);
    _renderConnected(short);
    // ────────────────────────────────────────────────────────────────────────

    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`${name} terhubung, tapi jaringan bukan Mainnet. Ganti ke ${SUPPORTED_CHAIN_NAME} ya! ⚠️`, 'warning');
    } else {
      showToast(`✅ ${name} terhubung! ${short}`, 'success');
    }

  } catch (err) {
    // Reset state jika gagal
    walletState.isConnected = false;
    walletState.address     = null;
    _activeProvider         = null;
    _activeWalletName       = '';

    _renderDisconnected();

    const code = err?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      showToast('Koneksi dibatalkan 😅', 'warning');
    } else if (code === -32002) {
      showToast(`Buka ${name} dan setujui permintaan koneksi`, 'info');
    } else {
      showToast('Gagal connect: ' + (err?.message || 'Error tidak diketahui'), 'error');
    }
  }
  // Tidak ada finally yang memanggil updateWalletUI —
  // agar tidak ada race condition dengan _renderConnected yang sudah dipanggil di atas.
}

// ── DISCONNECT ────────────────────────────────────────────────────────────────

function _clearState() {
  const prev = walletState.address;
  const name = _activeWalletName;

  walletState.address     = null;
  walletState.chainId     = null;
  walletState.isConnected = false;
  _activeProvider         = null;
  _activeWalletName       = '';

  sessionStorage.removeItem('wallet_connected');
  sessionStorage.removeItem('wallet_address');
  sessionStorage.removeItem('wallet_provider_name');

  return { prev, name };
}

function disconnectWallet() {
  const { prev, name } = _clearState();
  _renderDisconnected();
  showToast(`${name ? name + ' ' : ''}${shortenAddress(prev)} disconnect. 👋`, 'info');
}

function handleWalletButtonClick() {
  if (walletState.isConnected) {
    disconnectWallet();
  } else {
    connectWallet();
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────

function _attachListeners(provider) {
  if (!provider?.on) return;

  try {
    provider.on('accountsChanged', (accounts) => {
      try {
        if (!accounts?.length) {
          disconnectWallet();
        } else {
          walletState.address = accounts[0];
          sessionStorage.setItem('wallet_address', accounts[0]);
          // Render sync langsung — tidak perlu async updateWalletUI
          _renderConnected(shortenAddress(accounts[0]));
          showToast(`Akun berganti ke ${shortenAddress(accounts[0])} 🔄`, 'info');
        }
      } catch (_) {}
    });

    provider.on('chainChanged', (chainId) => {
      try {
        walletState.chainId = chainId;
        if (chainId !== SUPPORTED_CHAIN_ID) {
          showToast(`Jaringan berubah! Gunakan ${SUPPORTED_CHAIN_NAME} ya. ⚠️`, 'warning');
        } else {
          showToast('Beralih ke Ethereum Mainnet ✅', 'success');
        }
      } catch (_) {}
    });

    provider.on('disconnect', () => { try { disconnectWallet(); } catch (_) {} });
  } catch (_) {}
}

// ── MODAL: TIDAK ADA WALLET ───────────────────────────────────────────────────

function _showNoWalletModal() {
  try { document.getElementById('no-wallet-modal')?.remove(); } catch (_) {}

  const overlay = document.createElement('div');
  overlay.id        = 'no-wallet-modal';
  overlay.className = 'fixed inset-0 z-[10002] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-4 sm:pb-0';
  overlay.innerHTML = `
    <div class="absolute inset-0" onclick="document.getElementById('no-wallet-modal').remove(); document.body.style.overflow='';"></div>
    <div class="relative w-full max-w-sm bg-[#0F172A] border border-white/10 rounded-3xl shadow-2xl p-6 z-10">
      <div class="flex justify-center mb-5"><div class="w-10 h-1 bg-white/20 rounded-full"></div></div>
      <div class="text-center mb-5">
        <div class="text-5xl mb-3">🔍</div>
        <h3 class="text-xl font-black text-white mb-1">Wallet Tidak Ditemukan</h3>
        <p class="text-slate-400 text-sm">Tidak ada wallet extension yang aktif di browser kamu.</p>
      </div>
      <div class="space-y-3 mb-4">
        <a href="https://metamask.io/download/" target="_blank" rel="noopener"
          class="flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/40 transition group">
          <span class="text-2xl">🦊</span>
          <div class="flex-1"><p class="font-bold text-white text-sm">MetaMask</p><p class="text-slate-500 text-xs">Install extension gratis</p></div>
          <span class="text-orange-500 text-sm font-bold">&rarr;</span>
        </a>
        <a href="https://web3.bitget.com/en/wallet-download" target="_blank" rel="noopener"
          class="flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 hover:border-sky-500/40 transition group">
          <span class="text-2xl">💼</span>
          <div class="flex-1"><p class="font-bold text-white text-sm">Bitget Wallet</p><p class="text-slate-500 text-xs">Install extension gratis</p></div>
          <span class="text-sky-400 text-sm font-bold">&rarr;</span>
        </a>
      </div>
      <div class="bg-[#1E293B] rounded-2xl p-4 border border-white/5 mb-4">
        <p class="text-slate-400 text-xs leading-relaxed mb-3">
          <strong class="text-white">Pakai HP?</strong> Buka MetaMask atau Bitget, lalu buka website ini lewat tab <strong class="text-white">Browser</strong> di dalam aplikasinya.
        </p>
        <button onclick="copyUrlToClipboard()"
          class="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold py-2.5 rounded-xl transition">
          📋 Salin URL Halaman Ini
        </button>
      </div>
      <button onclick="document.getElementById('no-wallet-modal').remove(); document.body.style.overflow='';"
        class="w-full py-2 text-slate-500 hover:text-white text-sm transition">Tutup</button>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function copyUrlToClipboard() {
  navigator.clipboard?.writeText(window.location.href)
    .then(() => showToast('URL disalin! Buka di browser wallet kamu 📱', 'success'))
    .catch(() => showToast('URL: ' + window.location.href, 'info'));
}

// ── RESTORE SESSION ───────────────────────────────────────────────────────────

async function restoreSession() {
  try {
    const wasSaved  = sessionStorage.getItem('wallet_connected');
    const savedAddr = sessionStorage.getItem('wallet_address');
    if (!wasSaved || !savedAddr) return;

    // Re-request EIP-6963 dan tunggu sebentar
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (_) {}
    await new Promise(r => setTimeout(r, 150));

    const wallets = _gatherWallets();
    let found = null;

    for (const w of wallets) {
      try {
        const accs = await w.provider.request({ method: 'eth_accounts' });
        if (accs?.length && accs[0].toLowerCase() === savedAddr.toLowerCase()) {
          found = w;
          break;
        }
      } catch (_) {}
    }

    if (!found) {
      sessionStorage.removeItem('wallet_connected');
      sessionStorage.removeItem('wallet_address');
      sessionStorage.removeItem('wallet_provider_name');
      return;
    }

    const chainId = await found.provider.request({ method: 'eth_chainId' });

    _activeProvider   = found.provider;
    _activeWalletName = found.name;

    walletState.address     = savedAddr;
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    _attachListeners(found.provider);
    _renderConnected(shortenAddress(savedAddr));
    showToast(`${found.name} ${shortenAddress(savedAddr)} terhubung kembali 🔗`, 'success');

  } catch (_) {
    sessionStorage.removeItem('wallet_connected');
    sessionStorage.removeItem('wallet_address');
    sessionStorage.removeItem('wallet_provider_name');
    _renderDisconnected();
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function initWallet() {
  try {
    ['wallet-btn', 'wallet-btn-mobile'].forEach(id => {
      try {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handleWalletButtonClick);
      } catch (_) {}
    });

    _renderDisconnected();
    setTimeout(restoreSession, 150);
  } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}
