/**
 * btcprice.js — KriptoEdu Live Bitcoin Price Ticker
 * RAH-19
 *
 * Mengambil harga BTC/IDR dari CoinGecko free API.
 * Auto-refresh setiap 60 detik.
 * Menampilkan indikator naik/turun dibanding fetch sebelumnya.
 *
 * Elemen target: #btc-price-ticker (di navbar)
 */

'use strict';

(function () {
  const API_URL      = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=idr&include_24hr_change=true';
  const REFRESH_MS   = 60_000; // refresh tiap 60 detik
  const TICKER_ID    = 'btc-price-ticker';
  const PRICE_ID     = 'btc-price-value';
  const CHANGE_ID    = 'btc-price-change';
  const DOT_ID       = 'btc-price-dot';

  let _lastPrice = null; // harga sebelumnya untuk indikator naik/turun
  let _timer     = null;

  // Format angka ke Rupiah singkat: Rp 1,23 M
  function _formatIDR(num) {
    if (num >= 1_000_000_000) {
      return 'Rp\u00a0' + (num / 1_000_000_000).toFixed(2).replace('.', ',') + '\u00a0M';
    }
    if (num >= 1_000_000) {
      return 'Rp\u00a0' + (num / 1_000_000).toFixed(2).replace('.', ',') + '\u00a0jt';
    }
    return 'Rp\u00a0' + num.toLocaleString('id-ID');
  }

  // Render dot warna sesuai status
  function _setDot(status) {
    const dot = document.getElementById(DOT_ID);
    if (!dot) return;
    const map = {
      loading: 'bg-slate-500',
      ok:      'bg-green-400',
      error:   'bg-red-400',
    };
    dot.className = dot.className
      .replace(/bg-\S+/g, '')
      .trim();
    dot.classList.add(...(map[status] || map.loading).split(' '));
    dot.classList.toggle('animate-pulse', status === 'loading');
  }

  async function fetchPrice() {
    _setDot('loading');

    const priceEl  = document.getElementById(PRICE_ID);
    const changeEl = document.getElementById(CHANGE_ID);

    try {
      const res  = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const json   = await res.json();
      const price  = json?.bitcoin?.idr;
      const pct24h = json?.bitcoin?.idr_24h_change;

      if (!price) throw new Error('Data kosong dari API');

      // Indikator naik / turun vs fetch sebelumnya
      let arrow = '';
      if (_lastPrice !== null) {
        if (price > _lastPrice)      arrow = '\u25B2 '; // ▲
        else if (price < _lastPrice) arrow = '\u25BC '; // ▼
      }
      _lastPrice = price;

      // Update teks harga
      if (priceEl) {
        priceEl.textContent = arrow + _formatIDR(price);
        priceEl.className = priceEl.className
          .replace(/text-\S+/g, '')
          .trim();
        if (arrow === '\u25B2 ')      priceEl.classList.add('text-green-400');
        else if (arrow === '\u25BC ') priceEl.classList.add('text-red-400');
        else                          priceEl.classList.add('text-crypto-gold');
      }

      // Update % 24 jam
      if (changeEl && pct24h !== undefined) {
        const sign   = pct24h >= 0 ? '+' : '';
        changeEl.textContent = sign + pct24h.toFixed(2) + '%';
        changeEl.className = changeEl.className
          .replace(/text-\S+/g, '')
          .trim();
        changeEl.classList.add(pct24h >= 0 ? 'text-green-400' : 'text-red-400');
      }

      _setDot('ok');

    } catch (err) {
      console.warn('[btcprice] Gagal fetch:', err.message);
      if (priceEl) {
        priceEl.textContent = 'Unavailable';
        priceEl.className = priceEl.className.replace(/text-\S+/g, '').trim();
        priceEl.classList.add('text-slate-500');
      }
      if (changeEl) changeEl.textContent = '';
      _setDot('error');
    }
  }

  function initTicker() {
    const ticker = document.getElementById(TICKER_ID);
    if (!ticker) return; // elemen belum ada di DOM

    fetchPrice();
    _timer = setInterval(fetchPrice, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTicker);
  } else {
    initTicker();
  }
})();
