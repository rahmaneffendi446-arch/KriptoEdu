/**
 * wallet.js — KriptoEdu Wallet Connector
 * Mendukung MetaMask (browser extension) +
 * WalletConnect via walletconnect.js (QR mobile)
 *
 * Fitur:
 *  - Deteksi MetaMask / injected wallet
 *  - Wallet picker modal (MetaMask vs WalletConnect)
 *  - Connect & Disconnect wallet
 *  - Tampilkan alamat singkat (0x1234...abcd)
 *  - Handle: connected / not installed / wrong network
 *  - Toast notification feedback
 *  - Persist state via sessionStorage
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SUPPORTED_CHAIN_ID   = '0x1'; // Ethereum Mainnet
const SUPPORTED_CHAIN_NAME = 'Ethereum Mainnet';

// ─── STATE ───────────────────────────────────────────────────────────────────
let walletState = {
  address:     null,
  chainId:     null,
  isConnected: false,
  provider:    null, // 'metamask' | 'walletconnect' | null
};

// ─── UTILS ───────────────────────────────────────────────────────────────────

function shortenAddress(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function isMetaMaskInstalled() {
  return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
}

// ─── TOAST NOTIFICATION ──────────────────────────────────────────────────────

let toastTimeout;

function showToast(message, type = 'info') {
  const toast    = document.getElementById('wallet-toast');
  const toastMsg = document.getElementById('wallet-toast-msg');
  const toastIcon = document.getElementById('wallet-toast-icon');
  if (!toast) return;

  const config = {
    success: { icon: '✅', bg: 'bg-green-500/20',  border: 'border-green-500/40',  text: 'text-green-300'  },
    error:   { icon: '❌', bg: 'bg-red-500/20',    border: 'border-red-500/40',    text: 'text-red-300'    },
    warning: { icon: '⚠️', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40', text: 'text-yellow-300' },
    info:    { icon: 'ℹ️', bg: 'bg-blue-500/20',   border: 'border-blue-500/40',   text: 'text-blue-300'   },
  };
  const c = config[type] || config.info;

  toast.className = `fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl border backdrop-blur-md shadow-xl transition-all duration-300 ${c.bg} ${c.border}`;
  toastMsg.className = `text-sm font-semibold ${c.text}`;
  toastIcon.textContent = c.icon;
  toastMsg.textContent  = message;
  toast.style.opacity       = '1';
  toast.style.transform     = 'translateY(0)';
  toast.style.pointerEvents = 'auto';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => hideToast(), 3500);
}

function hideToast() {
  const toast = document.getElementById('wallet-toast');
  if (!toast) return;
  toast.style.opacity       = '0';
  toast.style.transform     = 'translateY(16px)';
  toast.style.pointerEvents = 'none';
}

// ─── UI UPDATE ────────────────────────────────────────────────────────────────

function updateWalletUI() {
  const btn          = document.getElementById('wallet-btn');
  const btnLabel     = document.getElementById('wallet-btn-label');
  const btnDot       = document.getElementById('wallet-btn-dot');
  const addressBadge = document.getElementById('wallet-address-badge');
  if (!btn) return;

  if (walletState.isConnected && walletState.address) {
    const isWC    = walletState.provider === 'walletconnect';
    const dotColor = isWC ? 'bg-blue-400 group-hover:bg-red-400' : 'bg-green-400 group-hover:bg-red-400';
    const borderColor = isWC
      ? 'border border-blue-500/40 hover:border-red-500/40 text-blue-400 hover:text-red-400 bg-blue-500/10 hover:bg-red-500/15'
      : 'border border-green-500/40 hover:border-red-500/40 text-green-400 hover:text-red-400 bg-green-500/15 hover:bg-red-500/15';

    btn.className = `hidden md:inline-flex items-center gap-2 ${borderColor} text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 cursor-pointer group`;
    btnLabel.innerHTML = `
      <span class="group-hover:hidden">${isWC ? '📱 ' : ''}${shortenAddress(walletState.address)}</span>
      <span class="hidden group-hover:inline">Disconnect</span>
    `;
    if (btnDot) btnDot.className = `w-2 h-2 rounded-full ${dotColor} transition-colors animate-pulse`;

    if (addressBadge && walletState.provider !== 'walletconnect') {
      addressBadge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
        <span>${shortenAddress(walletState.address)}</span>
      `;
      addressBadge.className = 'mt-6 inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-mono px-4 py-2 rounded-full';
      addressBadge.classList.remove('hidden');
    }
  } else {
    btn.className = 'hidden md:inline-flex items-center gap-2 bg-crypto-purple hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 cursor-pointer';
    if (btnLabel) btnLabel.innerHTML = '<span>🔗 Connect Wallet</span>';
    if (btnDot)   btnDot.className   = 'w-2 h-2 rounded-full bg-white/50';
    if (addressBadge) addressBadge.classList.add('hidden');
  }
}

// ─── METAMASK CONNECT ────────────────────────────────────────────────────────

/**
 * Hubungkan wallet MetaMask (browser extension)
 */
async function connectWallet() {
  if (!isMetaMaskInstalled()) {
    showToast('MetaMask belum terinstall! Install dulu di metamask.io 🦊', 'warning');
    setTimeout(() => window.open('https://metamask.io/download/', '_blank'), 1500);
    return;
  }

  const btn = document.getElementById('wallet-btn');
  if (btn) {
    btn.disabled = true;
    document.getElementById('wallet-btn-label').innerHTML = '<span>Menghubungkan...</span>';
  }

  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('Tidak ada akun yang dipilih.');

    const chainId = await window.ethereum.request({ method: 'eth_chainId' });

    walletState.address     = accounts[0];
    walletState.chainId     = chainId;
    walletState.isConnected = true;
    walletState.provider    = 'metamask';

    sessionStorage.setItem('wallet_connected', 'true');
    sessionStorage.setItem('wallet_address',   accounts[0]);
    sessionStorage.setItem('wallet_provider',  'metamask');

    updateWalletUI();

    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`Wallet terhubung di jaringan lain (bukan ${SUPPORTED_CHAIN_NAME}). Pastikan network sudah benar.`, 'warning');
    } else {
      showToast(`🦊 Wallet terhubung via MetaMask! ${shortenAddress(accounts[0])} ✨`, 'success');
    }
  } catch (err) {
    if (err.code === 4001) {
      showToast('Koneksi dibatalkan. Kamu harus setujui permintaan di MetaMask ya! 😅', 'warning');
    } else {
      showToast('Gagal terhubung: ' + (err.message || 'Error tidak diketahui'), 'error');
    }
  } finally {
    if (btn) btn.disabled = false;
    updateWalletUI();
  }
}

/**
 * Putuskan koneksi MetaMask
 */
function disconnectWallet() {
  const prevAddress = walletState.address;
  const wasWC       = walletState.provider === 'walletconnect';

  // Jika WalletConnect, delegasikan ke walletconnect.js
  if (wasWC && typeof disconnectWalletConnect === 'function') {
    disconnectWalletConnect();
    return;
  }

  walletState.address     = null;
  walletState.chainId     = null;
  walletState.isConnected = false;
  walletState.provider    = null;

  sessionStorage.removeItem('wallet_connected');
  sessionStorage.removeItem('wallet_address');
  sessionStorage.removeItem('wallet_provider');

  updateWalletUI();
  showToast(`Wallet ${shortenAddress(prevAddress)} berhasil disconnect. Sampai jumpa! 👋`, 'info');
}

/**
 * Klik tombol wallet → tampilkan picker dulu
 */
function handleWalletButtonClick() {
  if (walletState.isConnected) {
    disconnectWallet();
  } else {
    // Buka wallet picker modal (MetaMask | WalletConnect)
    if (typeof openWalletPickerModal === 'function') {
      openWalletPickerModal();
    } else {
      // Fallback: langsung ke MetaMask
      connectWallet();
    }
  }
}

// ─── EVENT LISTENERS (MetaMask) ──────────────────────────────────────────────

function setupMetaMaskListeners() {
  if (!isMetaMaskInstalled()) return;

  window.ethereum.on('accountsChanged', (accounts) => {
    if (walletState.provider !== 'metamask') return;
    if (accounts.length === 0) {
      disconnectWallet();
    } else {
      walletState.address = accounts[0];
      sessionStorage.setItem('wallet_address', accounts[0]);
      updateWalletUI();
      showToast(`Akun berganti ke ${shortenAddress(accounts[0])} 🔄`, 'info');
    }
  });

  window.ethereum.on('chainChanged', (chainId) => {
    if (walletState.provider !== 'metamask') return;
    walletState.chainId = chainId;
    if (chainId !== SUPPORTED_CHAIN_ID) {
      showToast(`Jaringan berubah! Gunakan ${SUPPORTED_CHAIN_NAME} untuk pengalaman terbaik. ⚠️`, 'warning');
    } else {
      showToast('Jaringan berhasil diganti ke Ethereum Mainnet ✅', 'success');
    }
  });
}

// ─── RESTORE SESSION ─────────────────────────────────────────────────────────

async function restoreWalletSession() {
  const wasConnected = sessionStorage.getItem('wallet_connected');
  const savedAddress = sessionStorage.getItem('wallet_address');
  const savedProvider = sessionStorage.getItem('wallet_provider');

  // WalletConnect restore → delegasikan ke walletconnect.js
  if (savedProvider === 'walletconnect') {
    // Sedikit delay agar walletconnect.js sudah di-load
    setTimeout(async () => {
      if (typeof restoreWalletConnectSession === 'function') {
        await restoreWalletConnectSession();
      }
    }, 200);
    return;
  }

  // MetaMask restore
  if (wasConnected && savedAddress && isMetaMaskInstalled()) {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0 && accounts[0].toLowerCase() === savedAddress.toLowerCase()) {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        walletState.address     = accounts[0];
        walletState.chainId     = chainId;
        walletState.isConnected = true;
        walletState.provider    = 'metamask';
        updateWalletUI();
        showToast(`Wallet ${shortenAddress(accounts[0])} terhubung kembali 🔗`, 'success');
      } else {
        sessionStorage.removeItem('wallet_connected');
        sessionStorage.removeItem('wallet_address');
        sessionStorage.removeItem('wallet_provider');
      }
    } catch (_) {
      sessionStorage.removeItem('wallet_connected');
      sessionStorage.removeItem('wallet_address');
      sessionStorage.removeItem('wallet_provider');
    }
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function initWallet() {
  const btn = document.getElementById('wallet-btn');
  if (btn) btn.addEventListener('click', handleWalletButtonClick);

  setupMetaMaskListeners();
  restoreWalletSession();
  updateWalletUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWallet);
} else {
  initWallet();
}
