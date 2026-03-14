/**
 * walletconnect.js — KriptoEdu WalletConnect Integration
 * RAH-12: Integrasi WalletConnect untuk koneksi wallet dari HP
 *
 * Menggunakan WalletConnect v1 via CDN (tidak butuh bundler)
 * Mendukung: Trust Wallet, Rainbow, MetaMask Mobile,
 *            Coinbase Wallet, Argent, dan 100+ mobile wallet lainnya.
 *
 * Setup:
 *   Ganti INFURA_ID dengan Infura Project ID kamu dari infura.io
 *   (gratis, daftar di https://infura.io)
 */

// ─── CONFIG ─────────────────────────────────────────────────────────────────
/**
 * Ganti dengan Infura Project ID kamu (gratis di infura.io)
 * Atau ganti RPC_URLS dengan public RPC endpoint pilihanmu
 */
const WC_INFURA_ID     = 'YOUR_INFURA_PROJECT_ID';
const WC_CHAIN_ID      = 1; // Ethereum Mainnet
const WC_BRIDGE_URL    = 'https://bridge.walletconnect.org';

/** RPC fallback jika tidak pakai Infura */
const WC_RPC_URLS = {
  1: 'https://rpc.ankr.com/eth', // Ankr public RPC (gratis, tanpa API key)
};

// ─── STATE ──────────────────────────────────────────────────────────────────
let wcProvider   = null;  // WalletConnect provider instance
let wcConnecting = false; // Prevent double-click

// ─── LOAD SDK ───────────────────────────────────────────────────────────────

/**
 * Muat WalletConnect provider SDK dari CDN secara dinamis
 * Hanya di-load saat user memilih opsi WalletConnect
 */
function loadWalletConnectSDK() {
  return new Promise((resolve, reject) => {
    if (window.WalletConnectProvider) return resolve();

    const script   = document.createElement('script');
    script.src     = 'https://cdn.jsdelivr.net/npm/@walletconnect/web3-provider@1.8.0/dist/umd/index.min.js';
    script.async   = true;
    script.onload  = resolve;
    script.onerror = () => reject(new Error('Gagal memuat WalletConnect SDK. Cek koneksi internetmu.'));
    document.head.appendChild(script);
  });
}

// ─── CONNECT ────────────────────────────────────────────────────────────────

/**
 * Inisialisasi WalletConnect provider & tampilkan QR modal
 */
async function connectViaWalletConnect() {
  if (wcConnecting) return;
  wcConnecting = true;

  closeWalletPickerModal();

  if (typeof showToast === 'function') {
    showToast('Memuat WalletConnect... sebentar ya! ⏳', 'info');
  }

  try {
    // 1. Load SDK
    await loadWalletConnectSDK();

    // 2. Buat provider baru
    wcProvider = new window.WalletConnectProvider.default({
      infuraId: WC_INFURA_ID !== 'YOUR_INFURA_PROJECT_ID' ? WC_INFURA_ID : undefined,
      rpc:      WC_RPC_URLS,
      bridge:   WC_BRIDGE_URL,
      chainId:  WC_CHAIN_ID,
      qrcodeModalOptions: {
        mobileLinks: [
          'metamask',
          'trust',
          'rainbow',
          'argent',
          'imtoken',
          'pillar',
          'coin98',
          'math',
          'bitkeep',
          'tokenpocket',
        ],
        desktopLinks: [],
      },
    });

    // 3. Setup event listeners SEBELUM enable
    wcProvider.on('accountsChanged', (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnectWalletConnect();
      } else {
        walletState.address = accounts[0];
        sessionStorage.setItem('wallet_address',   accounts[0]);
        sessionStorage.setItem('wallet_connected', 'true');
        sessionStorage.setItem('wallet_provider',  'walletconnect');
        if (typeof updateWalletUI === 'function') updateWalletUI();
        if (typeof showToast === 'function') {
          showToast(`Akun berganti ke ${shortenAddress(accounts[0])} 🔄`, 'info');
        }
      }
    });

    wcProvider.on('chainChanged', (chainId) => {
      walletState.chainId = '0x' + parseInt(chainId).toString(16);
      const supported = walletState.chainId === SUPPORTED_CHAIN_ID;
      if (typeof showToast === 'function') {
        showToast(
          supported
            ? 'Jaringan berhasil diganti ke Ethereum Mainnet ✅'
            : `Peringatan: kamu berada di jaringan lain. Gunakan Ethereum Mainnet. ⚠️`,
          supported ? 'success' : 'warning'
        );
      }
    });

    wcProvider.on('disconnect', (code, reason) => {
      disconnectWalletConnect();
    });

    // 4. Tampilkan QR modal & tunggu konfirmasi
    if (typeof showToast === 'function') {
      showToast('Scan QR code dengan wallet HP kamu 📱', 'info');
    }

    const accounts = await wcProvider.enable();

    if (!accounts || accounts.length === 0) {
      throw new Error('Tidak ada akun yang terdeteksi.');
    }

    // 5. Update shared state
    const chainIdHex = '0x' + parseInt(wcProvider.chainId).toString(16);

    walletState.address     = accounts[0];
    walletState.chainId     = chainIdHex;
    walletState.isConnected = true;
    walletState.provider    = 'walletconnect';

    sessionStorage.setItem('wallet_connected', 'true');
    sessionStorage.setItem('wallet_address',   accounts[0]);
    sessionStorage.setItem('wallet_provider',  'walletconnect');

    if (typeof updateWalletUI === 'function') updateWalletUI();

    const isMainnet = chainIdHex === SUPPORTED_CHAIN_ID;
    if (typeof showToast === 'function') {
      showToast(
        isMainnet
          ? `📱 Wallet terhubung via WalletConnect! ${shortenAddress(accounts[0])} ✨`
          : `📱 WalletConnect terhubung, tapi kamu di jaringan lain. Ganti ke Ethereum Mainnet. ⚠️`,
        isMainnet ? 'success' : 'warning'
      );
    }

    // Tampilkan badge WalletConnect di hero
    showWalletConnectBadge(accounts[0]);

  } catch (err) {
    if (err.message && err.message.includes('User closed modal')) {
      if (typeof showToast === 'function') {
        showToast('QR modal ditutup. Coba lagi kalau mau connect! 😊', 'warning');
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('WalletConnect gagal: ' + (err.message || 'Error tidak diketahui'), 'error');
      }
    }
    // Cleanup provider jika gagal
    if (wcProvider) {
      try { await wcProvider.disconnect(); } catch (_) {}
      wcProvider = null;
    }
  } finally {
    wcConnecting = false;
  }
}

// ─── DISCONNECT ─────────────────────────────────────────────────────────────

/**
 * Putuskan koneksi WalletConnect
 */
async function disconnectWalletConnect() {
  const prevAddr = walletState.address;

  if (wcProvider) {
    try { await wcProvider.disconnect(); } catch (_) {}
    wcProvider = null;
  }

  walletState.address     = null;
  walletState.chainId     = null;
  walletState.isConnected = false;
  walletState.provider    = null;

  sessionStorage.removeItem('wallet_connected');
  sessionStorage.removeItem('wallet_address');
  sessionStorage.removeItem('wallet_provider');

  if (typeof updateWalletUI === 'function') updateWalletUI();
  if (typeof showToast === 'function') {
    showToast(`Wallet ${shortenAddress(prevAddr)} disconnect dari WalletConnect 👋`, 'info');
  }

  hideWalletConnectBadge();
}

// ─── RESTORE SESSION ────────────────────────────────────────────────────────

/**
 * Cek apakah ada sesi WalletConnect yang masih aktif
 */
async function restoreWalletConnectSession() {
  const provider = sessionStorage.getItem('wallet_provider');
  if (provider !== 'walletconnect') return false;

  const savedAddress = sessionStorage.getItem('wallet_address');
  if (!savedAddress) return false;

  try {
    await loadWalletConnectSDK();

    // Buat provider dari sesi tersimpan
    wcProvider = new window.WalletConnectProvider.default({
      infuraId: WC_INFURA_ID !== 'YOUR_INFURA_PROJECT_ID' ? WC_INFURA_ID : undefined,
      rpc:      WC_RPC_URLS,
      bridge:   WC_BRIDGE_URL,
      chainId:  WC_CHAIN_ID,
    });

    // Cek apakah sesi WC masih aktif (tidak perlu enable ulang)
    if (wcProvider.wc && wcProvider.wc.connected) {
      const accounts = wcProvider.wc.accounts || [];
      if (accounts.length > 0) {
        const chainIdHex = '0x' + parseInt(wcProvider.chainId || 1).toString(16);
        walletState.address     = accounts[0];
        walletState.chainId     = chainIdHex;
        walletState.isConnected = true;
        walletState.provider    = 'walletconnect';
        if (typeof updateWalletUI === 'function') updateWalletUI();
        if (typeof showToast === 'function') {
          showToast(`📱 WalletConnect terhubung kembali — ${shortenAddress(accounts[0])} 🔗`, 'success');
        }
        showWalletConnectBadge(accounts[0]);
        return true;
      }
    }
  } catch (_) {
    sessionStorage.removeItem('wallet_provider');
  }
  return false;
}

// ─── WALLET PICKER MODAL ────────────────────────────────────────────────────

/**
 * Inject & tampilkan modal pemilihan wallet
 */
function openWalletPickerModal() {
  // Inject HTML jika belum ada
  if (!document.getElementById('wallet-picker-modal')) {
    injectWalletPickerModal();
  }
  const modal = document.getElementById('wallet-picker-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }
}

function closeWalletPickerModal() {
  const modal = document.getElementById('wallet-picker-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }
}

function injectWalletPickerModal() {
  const modal = document.createElement('div');
  modal.id = 'wallet-picker-modal';
  modal.className = 'hidden fixed inset-0 z-[10001] items-center justify-center bg-black/70 backdrop-blur-sm px-4';
  modal.innerHTML = `
    <!-- Backdrop -->
    <div class="absolute inset-0" onclick="closeWalletPickerModal()"></div>

    <!-- Card -->
    <div class="relative bg-[#0F172A] border border-white/10 rounded-3xl w-full max-w-sm shadow-2xl p-8 z-10">

      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-xl font-black">🔗 Connect Wallet</h3>
          <p class="text-slate-400 text-sm mt-1">Pilih cara menghubungkan wallet kamu</p>
        </div>
        <button onclick="closeWalletPickerModal()" class="text-slate-500 hover:text-white text-2xl leading-none transition">×</button>
      </div>

      <!-- Option 1: MetaMask -->
      <button
        onclick="closeWalletPickerModal(); connectWallet();"
        class="w-full flex items-center gap-4 bg-[#1E293B] hover:bg-orange-500/10 border border-white/5 hover:border-orange-500/40 rounded-2xl px-5 py-4 mb-3 text-left transition-all group"
      >
        <span class="text-4xl">🦊</span>
        <div class="flex-1">
          <p class="font-bold group-hover:text-orange-400 transition">MetaMask</p>
          <p class="text-slate-500 text-xs">Browser extension (Desktop/HP)</p>
        </div>
        <span class="text-slate-600 group-hover:text-orange-400 transition text-lg">→</span>
      </button>

      <!-- Option 2: WalletConnect -->
      <button
        onclick="connectViaWalletConnect()"
        class="w-full flex items-center gap-4 bg-[#1E293B] hover:bg-blue-500/10 border border-white/5 hover:border-blue-500/40 rounded-2xl px-5 py-4 mb-3 text-left transition-all group"
      >
        <div class="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.09 8.4c3.26-3.26 8.55-3.26 11.82 0l.39.39a.4.4 0 010 .56l-1.34 1.34a.2.2 0 01-.28 0l-.54-.54c-2.28-2.28-5.97-2.28-8.25 0l-.58.58a.2.2 0 01-.28 0L5.59 9.39a.4.4 0 010-.56l.5-.43zm14.6 2.72l1.19 1.19a.4.4 0 010 .56l-5.37 5.37a.4.4 0 01-.56 0l-3.81-3.81a.1.1 0 00-.14 0l-3.81 3.81a.4.4 0 01-.56 0L2.12 12.87a.4.4 0 010-.56l1.19-1.19a.4.4 0 01.56 0l3.81 3.81a.1.1 0 00.14 0l3.81-3.81a.4.4 0 01.56 0l3.81 3.81a.1.1 0 00.14 0l3.81-3.81a.4.4 0 01.65 0z" fill="#3B99FC"/>
          </svg>
        </div>
        <div class="flex-1">
          <p class="font-bold group-hover:text-blue-400 transition">WalletConnect</p>
          <p class="text-slate-500 text-xs">Scan QR dari HP — Trust, Rainbow, dll</p>
        </div>
        <span class="bg-blue-500/20 text-blue-400 text-xs font-bold px-2 py-0.5 rounded-full">📱 HP</span>
      </button>

      <!-- Supported wallets -->
      <div class="mt-5 pt-4 border-t border-white/5">
        <p class="text-slate-500 text-xs text-center mb-3">Wallet yang didukung WalletConnect:</p>
        <div class="flex justify-center gap-3 text-2xl">
          <span title="MetaMask Mobile">🦊</span>
          <span title="Trust Wallet">🛡️</span>
          <span title="Rainbow">🌈</span>
          <span title="Coinbase Wallet">🔵</span>
          <span title="Argent">🔷</span>
          <span title="100+ wallet lainnya">+100</span>
        </div>
      </div>

      <p class="text-slate-600 text-xs text-center mt-4">
        Tidak punya wallet? <a href="https://metamask.io" target="_blank" class="text-crypto-blue hover:underline">Install MetaMask gratis</a>
      </p>
    </div>
  `;
  document.body.appendChild(modal);

  // Tutup dengan Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWalletPickerModal();
  });
}

// ─── WALLETCONNECT BADGE ────────────────────────────────────────────────────

function showWalletConnectBadge(address) {
  const badge = document.getElementById('wallet-address-badge');
  if (badge) {
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
      <span class="text-blue-400">📱 ${shortenAddress(address)}</span>
      <span class="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold">WalletConnect</span>
    `;
    badge.className = 'mt-6 inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-mono px-4 py-2 rounded-full';
    badge.classList.remove('hidden');
  }
}

function hideWalletConnectBadge() {
  const badge = document.getElementById('wallet-address-badge');
  if (badge) badge.classList.add('hidden');
}

// ─── EXPOSE GLOBALS ─────────────────────────────────────────────────────────
window.connectViaWalletConnect  = connectViaWalletConnect;
window.disconnectWalletConnect  = disconnectWalletConnect;
window.openWalletPickerModal    = openWalletPickerModal;
window.closeWalletPickerModal   = closeWalletPickerModal;
