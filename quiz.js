/**
 * quiz.js — KriptoEdu Checkpoint Kuis System
 * RAH-17: Sistem gembok kuis interaktif di tengah materi
 *
 * Fitur:
 *  - 3 kuis checkpoint yang mengunci materi di bawahnya
 *  - Progress tersimpan di localStorage (tidak hilang saat reload)
 *  - Animasi reward bintang saat jawaban benar
 *  - Efek unlock + scroll otomatis ke materi berikutnya
 *  - Shake animation + pesan gagal saat salah
 *  - Tombol retry tanpa reload halaman
 */

// ─── DATA SOAL ────────────────────────────────────────────────────────────────
const QUIZ_DATA = [
  {
    id: 'q1',
    theme: 'blue',
    badge: '🔐 Kuis Keamanan',
    number: 1,
    unlocks: 'lock-bitcoin',
    question: 'Kamu baru saja membuat wallet MetaMask dan mendapatkan seed phrase. Apa yang sebaiknya kamu lakukan?',
    options: [
      { text: 'Screenshot dan simpan di Google Photos supaya aman', correct: false },
      { text: 'Tulis tangan di kertas dan simpan di tempat aman. Jangan bagikan ke siapapun!', correct: true },
      { text: 'Kirim ke email sendiri agar mudah diakses kapan saja', correct: false },
      { text: 'Simpan di notes HP dan backup ke cloud', correct: false },
    ],
    explanation: '🌟 Tepat! Seed phrase adalah kunci master wallet kamu. Satu-satunya cara aman adalah tulis tangan di kertas dan simpan offline. Jangan pernah simpan secara digital atau bagikan ke siapapun — tidak ada layanan legitimate yang akan memintanya.',
  },
  {
    id: 'q2',
    theme: 'purple',
    badge: '🌐 Kuis Jaringan',
    number: 2,
    unlocks: 'lock-materi',
    question: 'Temanmu minta kamu kirim USDT ke alamatnya. Dia bilang "kirim lewat jaringan BEP-20 ya". Apa bedanya dengan ERC-20?',
    options: [
      { text: 'Tidak ada bedanya, keduanya sama saja dan bisa dipakai bergantian', correct: false },
      { text: 'ERC-20 adalah jaringan Ethereum, BEP-20 adalah jaringan Binance Smart Chain. Biaya dan kecepatan berbeda', correct: true },
      { text: 'BEP-20 lebih canggih dan bisa menggantikan semua fungsi ERC-20', correct: false },
      { text: 'ERC-20 hanya untuk Bitcoin, BEP-20 untuk semua altcoin', correct: false },
    ],
    explanation: '🌟 Keren! ERC-20 berjalan di atas jaringan Ethereum (ETH dipakai untuk biaya gas), sementara BEP-20 berjalan di Binance Smart Chain (BNB untuk biaya gas). Pastikan selalu pilih jaringan yang sama dengan tujuan — salah jaringan bisa bikin koin hilang permanen!',
  },
  {
    id: 'q3',
    theme: 'gold',
    badge: '💼 Kuis Wallet',
    number: 3,
    unlocks: 'lock-features',
    question: 'Kamu punya 10 ETH hasil kerja keras selama setahun. Mana strategi penyimpanan yang paling aman untuk jangka panjang?',
    options: [
      { text: 'Biarkan saja di exchange karena exchange punya keamanan tinggi', correct: false },
      { text: 'Pindahkan ke cold wallet (Ledger/Trezor) dan simpan seed phrase-nya secara offline', correct: true },
      { text: 'Bagi ke beberapa exchange berbeda supaya risikonya tersebar', correct: false },
      { text: 'Simpan di hot wallet MetaMask karena lebih mudah dipantau', correct: false },
    ],
    explanation: '🌟 Jawaban terbaik! Cold wallet menyimpan private key offline sehingga tidak bisa diretas secara remote. Ingat: exchange bisa bangkrut, di-hack, atau membekukan akun (contoh: FTX 2022). "Not your keys, not your coins" — kalau koin ada di exchange, kamu hanya pegang IOU.',
  },
];

// ─── STATE ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'kriptoedu_quiz_progress';

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function saveProgress(id) {
  const p = loadProgress();
  p[id] = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// ─── THEME CONFIG ──────────────────────────────────────────────────────────────
const THEMES = {
  blue:   { accent: '#1DA1F2', border: 'border-blue-500/30',   bg: 'bg-blue-500/10',   text: 'text-blue-300',   btn: 'bg-blue-500 hover:bg-blue-400',   ring: 'ring-blue-500/40'   },
  purple: { accent: '#7C3AED', border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-300', btn: 'bg-purple-600 hover:bg-purple-500', ring: 'ring-purple-500/40' },
  gold:   { accent: '#F59E0B', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', text: 'text-yellow-300', btn: 'bg-yellow-500 hover:bg-yellow-400 text-gray-900', ring: 'ring-yellow-500/40' },
};

// ─── RENDER QUIZ ──────────────────────────────────────────────────────────────
function renderQuiz(data) {
  const t   = THEMES[data.theme];
  const ctn = document.getElementById(`quiz-${data.id}`);
  if (!ctn) return;

  ctn.innerHTML = `
    <div class="quiz-card relative rounded-3xl border ${t.border} ${t.bg} p-8 md:p-10 overflow-hidden">

      <!-- Decorative glow -->
      <div class="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-30" style="background:${t.accent}"></div>

      <!-- Header -->
      <div class="flex items-center gap-3 mb-6 relative">
        <div class="flex items-center gap-2 ${t.bg} border ${t.border} px-4 py-1.5 rounded-full">
          <span class="text-sm font-black ${t.text}">${data.badge}</span>
        </div>
        <div class="flex-1 h-px bg-white/10"></div>
        <span class="text-slate-500 text-xs font-semibold">${data.number}/3</span>
      </div>

      <!-- Progress bar -->
      <div class="w-full bg-white/5 rounded-full h-1.5 mb-8">
        <div class="h-1.5 rounded-full transition-all duration-500" style="width:${(data.number/3)*100}%;background:${t.accent}"></div>
      </div>

      <!-- Question -->
      <div class="flex items-start gap-4 mb-8">
        <div class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 text-xl font-black ${t.text}" style="background:${t.accent}20">
          ?
        </div>
        <p class="text-white font-semibold text-lg leading-relaxed">${data.question}</p>
      </div>

      <!-- Options -->
      <div class="space-y-3 mb-6" id="options-${data.id}">
        ${data.options.map((opt, i) => `
          <button
            onclick="selectOption('${data.id}', ${i})"
            data-index="${i}"
            data-correct="${opt.correct}"
            class="quiz-option w-full text-left px-5 py-4 rounded-2xl border border-white/10 bg-white/5
                   hover:border-white/30 hover:bg-white/10
                   transition-all duration-200 text-slate-300 text-sm leading-relaxed
                   flex items-start gap-3 group"
          >
            <span class="option-letter w-7 h-7 rounded-full border border-white/20 flex items-center justify-center shrink-0 text-xs font-black text-slate-400 group-hover:border-white/50 transition-colors mt-0.5">
              ${String.fromCharCode(65 + i)}
            </span>
            <span class="option-text">${opt.text}</span>
          </button>
        `).join('')}
      </div>

      <!-- Feedback area (hidden initially) -->
      <div id="feedback-${data.id}" class="hidden mb-4"></div>

      <!-- Submit / Result button -->
      <div id="action-${data.id}">
        <button
          onclick="submitQuiz('${data.id}')"
          id="submit-${data.id}"
          disabled
          class="w-full py-4 rounded-2xl font-black text-lg transition-all duration-200
                 bg-white/5 text-slate-600 cursor-not-allowed border border-white/10"
        >
          Pilih salah satu jawaban dulu ↑
        </button>
      </div>

    </div>
  `;
}

// ─── SELECT OPTION ────────────────────────────────────────────────────────────
let selectedAnswers = {};

function selectOption(quizId, index) {
  const data = QUIZ_DATA.find(q => q.id === quizId);
  const t    = THEMES[data.theme];

  selectedAnswers[quizId] = index;

  // Reset semua option
  document.querySelectorAll(`#options-${quizId} .quiz-option`).forEach(btn => {
    btn.className = btn.className
      .replace(/border-[\w-]+\/[\d]+/g, 'border-white/10')
      .replace(/bg-[\w-]+\/[\d]+/g, 'bg-white/5')
      .replace(/ring-[\d]+/g, '');
    btn.querySelector('.option-letter').className =
      btn.querySelector('.option-letter').className
        .replace(/border-[\w-]+\/[\d]+/g, 'border-white/20')
        .replace(/text-[\w-]+/g, 'text-slate-400');
  });

  // Highlight yang dipilih
  const chosen = document.querySelector(`#options-${quizId} [data-index='${index}']`);
  if (chosen) {
    chosen.classList.add(`border-[${t.accent}]`, 'bg-white/10', 'ring-2');
    chosen.querySelector('.option-letter').classList.add(`text-white`);
    chosen.style.borderColor = t.accent;
    chosen.style.boxShadow   = `0 0 0 2px ${t.accent}40`;
  }

  // Aktifkan tombol submit
  const submitBtn = document.getElementById(`submit-${quizId}`);
  if (submitBtn) {
    submitBtn.disabled   = false;
    submitBtn.className  = submitBtn.className
      .replace('bg-white/5 text-slate-600 cursor-not-allowed border border-white/10', '');
    submitBtn.className += ` ${t.btn} text-white cursor-pointer ring-0`;
    submitBtn.style.background = t.accent;
    submitBtn.textContent = '✓ Konfirmasi Jawaban';
  }
}

// ─── SUBMIT QUIZ ────────────────────────────────────────────────────────────
function submitQuiz(quizId) {
  const data    = QUIZ_DATA.find(q => q.id === quizId);
  const chosen  = selectedAnswers[quizId];
  if (chosen === undefined) return;

  const isCorrect = data.options[chosen].correct;

  // Disable semua options
  document.querySelectorAll(`#options-${quizId} .quiz-option`).forEach(btn => {
    btn.onclick = null;
    btn.style.cursor = 'default';
  });

  // Disable submit
  const submitBtn = document.getElementById(`submit-${quizId}`);
  if (submitBtn) submitBtn.disabled = true;

  if (isCorrect) {
    onCorrect(data, chosen);
  } else {
    onWrong(data, chosen);
  }
}

// ─── CORRECT HANDLER ─────────────────────────────────────────────────────────
function onCorrect(data, chosenIdx) {
  const t = THEMES[data.theme];

  // Highlight jawaban benar (hijau)
  const chosenBtn = document.querySelector(`#options-${data.id} [data-index='${chosenIdx}']`);
  if (chosenBtn) {
    chosenBtn.style.borderColor  = '#10B981';
    chosenBtn.style.background   = 'rgba(16,185,129,0.15)';
    chosenBtn.style.boxShadow    = '0 0 0 2px rgba(16,185,129,0.3)';
  }

  // Feedback box
  const fb = document.getElementById(`feedback-${data.id}`);
  if (fb) {
    fb.className = 'bg-green-500/10 border border-green-500/30 rounded-2xl p-5';
    fb.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-2xl shrink-0">🌟</span>
        <div>
          <p class="font-black text-green-400 mb-1">Jawaban Benar! Keren!</p>
          <p class="text-slate-300 text-sm leading-relaxed">${data.explanation}</p>
        </div>
      </div>
    `;
  }

  // Ganti tombol submit jadi tombol unlock
  const action = document.getElementById(`action-${data.id}`);
  if (action) {
    action.innerHTML = `
      <button
        onclick="unlockSection('${data.id}', '${data.unlocks}')"
        class="w-full py-4 rounded-2xl font-black text-lg text-white
               bg-gradient-to-r from-green-500 to-emerald-400
               hover:opacity-90 transition cursor-pointer
               flex items-center justify-center gap-3
               shadow-lg shadow-green-500/20"
      >
        <span class="text-xl">🔓</span>
        <span>Buka Materi Selanjutnya!</span>
        <span class="text-xl">↓</span>
      </button>
    `;
  }

  // Simpan progress
  saveProgress(data.id);

  // Launch reward stars
  launchStars(document.getElementById(`quiz-${data.id}`));
}

// ─── WRONG HANDLER ───────────────────────────────────────────────────────────
function onWrong(data, chosenIdx) {
  // Highlight jawaban yang dipilih (merah)
  const chosenBtn = document.querySelector(`#options-${data.id} [data-index='${chosenIdx}']`);
  if (chosenBtn) {
    chosenBtn.style.borderColor = '#EF4444';
    chosenBtn.style.background  = 'rgba(239,68,68,0.1)';
    chosenBtn.style.boxShadow   = '0 0 0 2px rgba(239,68,68,0.2)';
    chosenBtn.classList.add('quiz-shake');
    setTimeout(() => chosenBtn.classList.remove('quiz-shake'), 600);
  }

  // Feedback box
  const fb = document.getElementById(`feedback-${data.id}`);
  if (fb) {
    fb.className = 'bg-red-500/10 border border-red-500/30 rounded-2xl p-5';
    fb.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-2xl shrink-0">🤔</span>
        <div>
          <p class="font-black text-red-400 mb-1">Kurang tepat, coba lagi!</p>
          <p class="text-slate-300 text-sm leading-relaxed">Baca ulang materi di atas dan perhatikan baik-baik ya. Kamu pasti bisa!</p>
        </div>
      </div>
    `;
  }

  // Tombol retry
  const action = document.getElementById(`action-${data.id}`);
  if (action) {
    action.innerHTML = `
      <button
        onclick="retryQuiz('${data.id}')"
        class="w-full py-4 rounded-2xl font-black text-lg text-white
               bg-slate-700 hover:bg-slate-600
               transition cursor-pointer
               flex items-center justify-center gap-3"
      >
        <span>🔄</span>
        <span>Coba Lagi</span>
      </button>
    `;
  }
}

// ─── RETRY ─────────────────────────────────────────────────────────────────────
function retryQuiz(quizId) {
  delete selectedAnswers[quizId];
  renderQuiz(QUIZ_DATA.find(q => q.id === quizId));
}

// ─── UNLOCK SECTION ────────────────────────────────────────────────────────────
function unlockSection(quizId, lockId) {
  const lockEl = document.getElementById(lockId);
  if (!lockEl) return;

  // Fade-out animasi gembok
  const gateEl = document.getElementById(`gate-${lockId}`);
  if (gateEl) {
    gateEl.style.transition = 'opacity 0.4s, transform 0.4s';
    gateEl.style.opacity    = '0';
    gateEl.style.transform  = 'scale(0.95)';
    setTimeout(() => gateEl.remove(), 400);
  }

  // Reveal materi
  setTimeout(() => {
    lockEl.style.transition = 'opacity 0.6s, transform 0.5s';
    lockEl.style.opacity    = '0';
    lockEl.style.transform  = 'translateY(20px)';
    lockEl.classList.remove('hidden');
    // Force reflow
    lockEl.getBoundingClientRect();
    lockEl.style.opacity   = '1';
    lockEl.style.transform = 'translateY(0)';

    // Scroll ke materi yang baru dibuka (setelah animasi)
    setTimeout(() => {
      lockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }, 350);

  // Tandai kuis sebagai selesai (tampilkan badge ✅)
  const quizCard = document.getElementById(`quiz-${quizId}`);
  if (quizCard) {
    quizCard.style.transition = 'opacity 0.4s';
    quizCard.style.opacity    = '0.5';
    quizCard.style.pointerEvents = 'none';
  }
}

// ─── REWARD ANIMATION ──────────────────────────────────────────────────────────
function launchStars(container) {
  if (!container) return;
  const rect   = container.getBoundingClientRect();
  const emojis = ['⭐', '🌟', '✨', '🎉', '💫', '🔓'];

  for (let i = 0; i < 18; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.cssText = `
        position: fixed;
        font-size: ${Math.random() * 18 + 14}px;
        left: ${rect.left + Math.random() * rect.width}px;
        top:  ${rect.top  + rect.height * 0.3 + Math.random() * rect.height * 0.4}px;
        pointer-events: none;
        z-index: 99999;
        transform: translate(-50%, -50%);
        transition: all 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        will-change: transform, opacity;
      `;
      document.body.appendChild(el);
      // Force reflow
      el.getBoundingClientRect();
      const vx = (Math.random() - 0.5) * 200;
      const vy = -(Math.random() * 220 + 80);
      el.style.transform = `translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px)) rotate(${Math.random()*360}deg)`;
      el.style.opacity   = '0';
      setTimeout(() => el.remove(), 1300);
    }, i * 55);
  }
}

// ─── GATE (gembok materi) ─────────────────────────────────────────────────────
function renderGate(lockId, label) {
  const gateContainer = document.getElementById(`gate-${lockId}`);
  if (!gateContainer) return;

  gateContainer.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
      <div class="relative">
        <div class="w-20 h-20 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-4xl
                    animate-pulse">
          🔒
        </div>
        <div class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 border-2 border-[#0F172A]
                    flex items-center justify-center text-xs font-black text-white">
          !
        </div>
      </div>
      <div>
        <p class="font-black text-white text-xl mb-1">${label}</p>
        <p class="text-slate-400 text-sm">Jawab kuis di atas untuk membuka materi ini</p>
      </div>
      <div class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-5 py-2">
        <span class="text-slate-500 text-xs">↑ Scroll ke atas dan jawab kuis terlebih dahulu</span>
      </div>
    </div>
  `;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initQuizSystem() {
  const progress = loadProgress();

  QUIZ_DATA.forEach(data => {
    // Render soal kuis
    renderQuiz(data);

    const lockEl   = document.getElementById(data.unlocks);
    const gateEl   = document.getElementById(`gate-${data.unlocks}`);

    if (progress[data.id]) {
      // Sudah pernah benar → langsung unlock, render tanpa animasi
      if (lockEl) {
        lockEl.classList.remove('hidden');
        lockEl.style.opacity = '1';
      }
      if (gateEl) gateEl.remove();

      // Tandai kuis sebagai selesai
      const quizCard = document.getElementById(`quiz-${data.id}`);
      if (quizCard) {
        // Re-render sebagai completed state
        const t = THEMES[data.theme];
        const card = quizCard.querySelector('.quiz-card');
        if (card) {
          const badge = card.querySelector('[class*="quiz-card"]');
          // Tambahkan completed badge
        }
        quizCard.style.opacity = '0.65';
        quizCard.style.pointerEvents = 'none';

        // Inject completed overlay
        const overlay = document.createElement('div');
        overlay.className = 'absolute inset-0 rounded-3xl bg-green-500/5 border border-green-500/20 flex items-center justify-center pointer-events-none z-10';
        overlay.innerHTML = `
          <div class="bg-green-500/20 border border-green-500/40 text-green-400 font-black text-sm px-5 py-2 rounded-full flex items-center gap-2">
            <span>✅</span> Kuis Selesai
          </div>
        `;
        const cardEl = quizCard.querySelector('.quiz-card');
        if (cardEl) {
          cardEl.style.position = 'relative';
          cardEl.appendChild(overlay);
        }
      }
    } else {
      // Belum benar → tampilkan gate
      if (lockEl) lockEl.classList.add('hidden');
      const labels = {
        'lock-bitcoin':  'Materi Bitcoin Terkunci',
        'lock-materi':   'Materi Wallet & Seed Phrase Terkunci',
        'lock-features': 'Fitur Lengkap Terkunci',
      };
      renderGate(data.unlocks, labels[data.unlocks] || 'Materi Terkunci');
    }
  });
}

// Global CSS untuk animasi shake
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes quiz-shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
  }
  .quiz-shake { animation: quiz-shake 0.5s ease; }
`;
document.head.appendChild(styleEl);

// Jalankan setelah DOM siap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuizSystem);
} else {
  initQuizSystem();
}
