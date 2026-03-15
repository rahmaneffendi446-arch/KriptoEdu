/**
 * wallet.js: KriptoEdu Wallet Connector
 *
 * Strategi deteksi wallet (4 lapis, sync-first):
 *
 * Lapis 1 — window.ethereum langsung (SYNC, selalu ada jika wallet terinstall)
 *            Ini cara paling reliable untuk desktop extension.
 *
 * Lapis 2 — window.ethereum.providers[] (SYNC)
 *            Saat 2+ wallet terinstall, wallet pertama membuat array ini
 *            agar semua provider bisa diakses, bukan hanya yang "menang".
 *
 * Lapis 3 — window.bitkeep.ethereum (SYNC, Bitget dedicated slot)
 *            Bitget menyimpan provider-nya di sini agar tidak bentrok
 *            dengan MetaMask yang sudah ada di window.ethereum.
 *
 * Lapis 4 — EIP-6963 (ASYNC, enhancement)
 *            Nama + ikon resmi dari wallet. Dipakai untuk UI yang lebih cantik.
 *            Tidak bisa diandalkan sebagai satu-satunya sumber karena timing.
 *
 * Alur saat user klik Connect Wallet:
 *  - Cek sync dulu (Lapis 1-3). Jika ditemukan, langsung proses.
 *  - Jika sync kosong, tunggu 300ms untuk EIP-6963 (Lapis 4).
 *  - 0 wallet total → modal panduan install
 *  - 1 wallet       → langsung connect tanpa picker
 *  - 2+ wallet      → picker modal, user pilih satu
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPPORTED_CHAIN_ID   = '0x1';
const SUPPORTED_CHAIN_NAME = 'Ethereum Mainnet';

// ── EIP-6963: pasang listener sedini mungkin ──────────────────────────────────
const _eip6963Wallets = new Map(); // uuid → { info, provider }

window.addEventListener('eip6963:announceProvider', (e) => {
  const { info, provider } = e.detail || {};
  if (info?.uuid && provider) _eip6963Wallets.set(info.uuid, { info, provider });
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

// ── STATE ─────────────────────────────────────────────────────────────────────
let walletState = {
  address:     null,
  chainId:     null,
  isConnected: false,
};

let _activeProvider   = null;
let _activeWalletName = '';

// ── UTILS ─────────────────────────────────────────────────────────────────────

/** 0xAbCd1234...5678 — 6 awal + '...' + 4 akhir */
function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr || '';
  return addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
}

/** Tebak nama wallet dari property yang di-inject ke provider */
function _detectName(p) {
  if (!p) return 'Browser Wallet';
  // Urutan penting: cek yang paling spesifik dulu
  if (p.isBitKeep || p.isBitkeepChrome || p.isBitget)   return 'Bitget Wallet';
  if (p.isBraveWallet)                                   return 'Brave Wallet';
  if (p.isCoinbaseWallet || p.isCoinbaseBrowser)         return 'Coinbase Wallet';
  if (p.isRabby)                                         return 'Rabby';
  if (p.isOKExWallet || p.isOkxWallet)                   return 'OKX Wallet';
  if (p.isTrust || p.isTrustWallet)                      return 'Trust Wallet';
  if (p.isPhantom)                                       return 'Phantom';
  if (p.isMetaMask)                                      return 'MetaMask';
  return 'Browser Wallet';
}

/**
 * Kumpulkan semua wallet yang terdeteksi.
 * Bisa dipanggil kapan saja — deteksi sync tidak memerlukan await.
 */
function _gatherWallets() {
  const result       = [];
  const seenObjects  = new Set(); // deduplikasi by object identity
  const seenNames    = new Set(); // deduplikasi by nama (case-insensitive)

  function _add(provider, name, icon, id) {
    if (!provider)                        return; // tidak ada provider
    if (seenObjects.has(provider))        return; // provider sama sudah ada
    const lower = name.toLowerCase();
    if (seenNames.has(lower))             return; // nama sama sudah ada
    seenObjects.add(provider);
    seenNames.add(lower);
    result.push({ id: id || `w-${result.length}`, name, icon: icon || null, provider });
  }

  // ── Lapis 1: window.ethereum langsung ─────────────────────────────────────
  // Ini selalu sync. Jika MetaMask atau Bitget satu-satunya wallet, ada di sini.
  if (window.ethereum) {
    _add(window.ethereum, _detectName(window.ethereum), null, 'injected');
  }

  // ── Lapis 2: window.ethereum.providers[] ──────────────────────────────────
  // Saat 2+ wallet terinstall, keduanya menaruh provider di array ini.
  // Ini cara resmi browser untuk expose multiple injected wallets.
  if (Array.isArray(window.ethereum?.providers)) {
    window.ethereum.providers.forEach((p, i) => {
      _add(p, _detectName(p), null, `providers-${i}`);
    });
  }

  // ── Lapis 3: window.bitkeep.ethereum ──────────────────────────────────────
  // Bitget menyimpan provider di sini sebagai jalur tersendiri.
  // Dicek dengan beberapa variasi nama property karena versi Bitget berbeda.
  const bitkeepSlots = [
    window.bitkeep?.ethereum,
    window.bitgetWallet?.ethereum,
    window.isBitKeep?.ethereum,
  ];
  bitkeepSlots.forEach((p, i) => {
    if (p) _add(p, 'Bitget Wallet', null, `bitkeep-${i}`);
  });

  // ── Lapis 4: EIP-6963 ──────────────────────────────────────────────────────
  // Async announce — mungkin sudah ada di map, mungkin belum.
  // Keunggulannya: nama + ikon resmi. Kita override nama & ikon jika ada.
  for (const { info, provider } of _eip6963Wallets.values()) {
    if (seenObjects.has(provider)) {
      // Provider sudah ada, update nama & ikon ke versi resmi dari wallet
      const entry = result.find(w => w.provider === provider);
      if (entry) {
        entry.name = info.name;
        entry.icon = info.icon || null;
        seenNames.delete(entry.name.toLowerCase());
        seenNames.add(info.name.toLowerCase());
      }
    } else {
      // Provider baru dari EIP-6963 (wallet yang tidak inject window.ethereum)
      _add(provider, info.name, info.icon, info.uuid);
    }
  }

  return result;
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

  toast.className       = `fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-md shadow-xl transition-all duration-300 ${c.bg} ${c.bd}`;
  msg.className         = `text-sm font-semibold ${c.tx}`;
  icon.textContent      = c.i;
  msg.textContent       = message;
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
 * Render UI berdasarkan walletState saat ini.
 *
 * Dua tahap:
 * 1. SYNC: Langsung render dengan walletState.address yang sudah ada.
 *    Ini yang penting — tombol berubah SEGERA setelah connect.
 * 2. ASYNC (opsional): Refresh dari provider untuk pastikan alamat fresh.
 */
async function updateWalletUI() {
  const btn   = document.getElementById('wallet-btn');
  const label = document.getElementById('wallet-btn-label');
  const dot   = document.getElementById('wallet-btn-dot');
  const badge = document.getElementById('wallet-address-badge');
  if (!btn) return;

  // ── Tahap 1: render SYNC langsung ─────────────────────────────────────────
  // Jika walletState.address sudah ada (misalnya baru saja di-set oleh
  // _connectWith), langsung tampilkan tanpa menunggu provider query.
  if (walletState.isConnected && walletState.address) {
    _renderConnected(btn, label, dot, badge, shortenAddress(walletState.address));
  } else if (!walletState.isConnected) {
    _renderDisconnected(btn, label, dot, badge);
  }

  // ── Tahap 2: refresh async dari provider ──────────────────────────────────
  // Hanya untuk memastikan alamat tetap fresh jika user ganti akun di MetaMask.
  if (walletState.isConnected && _activeProvider) {
    try {
      const live = await _activeProvider.request({ method: 'eth_accounts' });
      if (live?.length > 0) {
        if (live[0] !== walletState.address) {
          // Alamat berubah (user ganti akun), update UI
          walletState.address = live[0];
          sessionStorage.setItem('wallet_address', live[0]);
          _renderConnected(btn, label, dot, badge, shortenAddress(live[0]));
        }
      } else {
        // Provider tidak punya akun aktif, disconnect
        _clearState();
        _renderDisconnected(btn, label, dot, badge);
      }
    } catch (_) { /* gagal query, tidak masalah — UI sudah dirender di Tahap 1 */ }
  }
}

/** Render tombol + badge saat TERHUBUNG */
function _renderConnected(btn, label, dot, badge, short) {
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
      ${_activeWalletName ? `<span class="text-green-600 text-xs">&middot; ${_activeWalletName}</span>` : ''}`;
    badge.className = 'mt-6 inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm px-4 py-2 rounded-full';
    badge.classList.remove('hidden');
  }
}

/** Render tombol saat TIDAK TERHUBUNG */
function _renderDisconnected(btn, label, dot, badge) {
  btn.className = 'hidden md:inline-flex items-center gap-2 bg-crypto-purple hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 cursor-pointer';
  if (label) label.innerHTML = '<span>🔗 Connect Wallet</span>';
  if (dot)   dot.className   = 'w-2 h-2 rounded-full bg-white/50';
  if (badge) badge.classList.add('hidden');
}

// ── CONNECT: ENTRY POINT ──────────────────────────────────────────────────────

/**
 * Dipanggil saat user klik tombol Connect Wallet.
 *
 * Strategi: cek sync dulu (window.ethereum tersedia langsung).
 * Jika kosong, broadcast EIP-6963 dan tunggu 300ms.
 */
function connectWallet() {
  // Re-broadcast agar EIP-6963 wallet yang belum announce sempat respond
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  // Cek sync LANGSUNG — ini yang paling penting untuk desktop extension
  const wallets = _gatherWallets();

  if (wallets.length > 0) {
    // Wallet sudah ada secara sync, proses langsung tanpa delay
    _processWallets(wallets);
    return;
  }

  // Tidak ada wallet secara sync. Mungkin EIP-6963 late announce.
  // Tampilkan loading hint dan tunggu 300ms.
  const btn = document.getElementById('wallet-btn');
  const lbl = document.getElementById('wallet-btn-label');
  const origInner = lbl ? lbl.innerHTML : '';
  if (lbl) lbl.innerHTML = '<span>Mendeteksi wallet...</span>';

  setTimeout(() => {
    if (lbl) lbl.innerHTML = origInner; // restore
    const retryWallets = _gatherWallets();
    if (retryWallets.length > 0) {
      _processWallets(retryWallets);
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
  document.getElementById('wallet-picker-modal')?.remove();
  window._walletPickerList = wallets;

  const buttons = wallets.map((w, i) => {
    const safeName = w.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let iconHtml;
    if (w.icon) {
      iconHtml = `<img src="${w.icon}" alt="${safeName}" class="w-10 h-10 rounded-xl object-contain flex-shrink-0" />`;
    } else {
      const emojiMap = {
        'MetaMask':        '🦊',
        'Bitget Wallet':   '💼',
        'Coinbase Wallet': '🔵',
        'Brave Wallet':    '🦁',
        'Trust Wallet':    '🛡️',
        'Rabby':           '🐰',
        'OKX Wallet':      '⭕',
        'Rainbow':         '🌈',
        'Phantom':         '👻',
      };
      const emoji = emojiMap[w.name] || '🔗';
      iconHtml = `<div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-2xl flex-shrink-0">${emoji}</div>`;
    }

    return `
      <button
        onclick="if(window._walletPickerList){_connectWith(window._walletPickerList[${i}]);} _closePickerModal();"
        class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl
               bg-white/5 hover:bg-crypto-purple/15
               border border-white/10 hover:border-crypto-purple/40
               transition-all duration-150 text-left group"
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
          class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition text-xl leading-none">
          &times;
        </button>
      </div>
      <div class="p-4 space-y-2.5 max-h-80 overflow-y-auto">
        ${buttons}
      </div>
      <div class="px-6 pb-5 pt-2">
        <p class="text-slate-600 text-xs text-center">
          Tidak melihat walletmu? Pastikan extension-nya aktif di browser.
        </p>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function _closePickerModal() {
  document.getElementById('wallet-picker-modal')?.remove();
  document.body.style.overflow = '';
  delete window._walletPickerList;
}

// ── CONNECT DENGAN PROVIDER SPESIFIK ─────────────────────────────────────────

async function _connectWith(wallet) {
  const { name, provider } = wallet;

  const btn = document.getElementById('wallet-btn');
  const lbl = document.getElementById('wallet-btn-label');
  if (btn) btn.disabled = true;
  if (lbl) lbl.innerHTML = `<span>Menghubungkan ${name}...</span>`;

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) throw new Error('Tidak ada akun yang dipilih.');

    const chainId = await provider.request({ method: 'eth_chainId' });

    // Simpan semua state sebelum updateWalletUI
    _activeProvider   = provider;
    _activeWalletName = name;

    walletState.address     = accounts[0];
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    sessionStorage.setItem('wallet_connected',     'true');
    sessionStorage.setItem('wallet_address',       accounts[0]);
    sessionStorage.setItem('wallet_provider_name', name);

    _attachListeners(provider);

    // updateWalletUI — Tahap 1 (sync) akan langsung tampilkan alamat
    await updateWalletUI();

    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`${name} terhubung, tapi jaringan bukan Mainnet. Ganti ke ${SUPPORTED_CHAIN_NAME} ya! ⚠️`, 'warning');
    } else {
      showToast(`✅ ${name} terhubung! ${shortenAddress(accounts[0])}`, 'success');
    }

  } catch (err) {
    const code = err?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      showToast('Koneksi dibatalkan 😅', 'warning');
    } else if (code === -32002) {
      showToast(`Buka ${name} dan setujui permintaan koneksi`, 'info');
    } else {
      showToast('Gagal connect: ' + (err?.message || 'Error tidak diketahui'), 'error');
    }
    // Reset UI jika gagal
    walletState.isConnected = false;
    walletState.address     = null;
    _activeProvider         = null;
    _activeWalletName       = '';
  } finally {
    if (btn) btn.disabled = false;
    // Render ulang untuk pastikan state tombol benar
    updateWalletUI();
  }
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
  updateWalletUI();
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

  provider.on('accountsChanged', (accounts) => {
    if (!accounts?.length) {
      disconnectWallet();
    } else {
      walletState.address = accounts[0];
      sessionStorage.setItem('wallet_address', accounts[0]);
      updateWalletUI();
      showToast(`Akun berganti ke ${shortenAddress(accounts[0])} 🔄`, 'info');
    }
  });

  provider.on('chainChanged', (chainId) => {
    walletState.chainId = chainId;
    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`Jaringan berubah! Gunakan ${SUPPORTED_CHAIN_NAME} ya. ⚠️`, 'warning');
    } else {
      showToast('Beralih ke Ethereum Mainnet ✅', 'success');
    }
  });

  provider.on('disconnect', () => disconnectWallet());
}

// ── MODAL: TIDAK ADA WALLET ───────────────────────────────────────────────────

function _showNoWalletModal() {
  document.getElementById('no-wallet-modal')?.remove();

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
  const wasSaved  = sessionStorage.getItem('wallet_connected');
  const savedAddr = sessionStorage.getItem('wallet_address');

  if (!wasSaved || !savedAddr) return;

  // Re-broadcast EIP-6963 lalu tunggu sebentar
  window.dispatchEvent(new Event('eip6963:requestProvider'));
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
    } catch (_) { /* skip */ }
  }

  if (!found) {
    sessionStorage.removeItem('wallet_connected');
    sessionStorage.removeItem('wallet_address');
    sessionStorage.removeItem('wallet_provider_name');
    return;
  }

  try {
    const chainId = await found.provider.request({ method: 'eth_chainId' });

    _activeProvider   = found.provider;
    _activeWalletName = found.name;

    walletState.address     = savedAddr;
    walletState.chainId     = chainId;
    walletState.isConnected = true;

    _attachListeners(found.provider);
    await updateWalletUI();

    showToast(`${found.name} ${shortenAddress(savedAddr)} terhubung kembali 🔗`, 'success');
  } catch (_) {
    sessionStorage.removeItem('wallet_connected');
    sessionStorage.removeItem('wallet_address');
    sessionStorage.removeItem('wallet_provider_name');
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function initWallet() {
  ['wallet-btn', 'wallet-btn-mobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handleWalletButtonClick);
  });

  updateWalletUI();

  // Restore session dengan delay sedikit (beri wallet waktu inject)
  setTimeout(restoreSession, 150);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}
