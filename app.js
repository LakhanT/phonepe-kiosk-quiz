const $app = document.getElementById("app");

// ---- App init (offline cache only — normal webpage behavior) ----
function initApp() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update?.().catch(() => {}))
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      try {
        location.reload();
      } catch {}
    });
  }
}

// ---- Config ----
async function loadConfig() {
  const res = await fetch("./questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load questions.json");
  const data = await res.json();
  validateConfig(data);
  return data;
}

function validateConfig(data) {
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error("questions.json must include at least one question");
  }
  data.questions.forEach((q, i) => {
    if (!q.clue || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Question ${i + 1} needs clue and at least 2 options`);
    }
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Question ${i + 1} has invalid correctIndex`);
    }
    const word = getAnswerWord(q);
    if (!word || word.length < 2) {
      throw new Error(`Question ${i + 1} answer is too short after normalization`);
    }
    if (word.length > (data.grid?.maxSize ?? 24)) {
      throw new Error(`Question ${i + 1} answer "${word}" exceeds grid maxSize`);
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Puzzle target = the correct quiz answer (normalized). Optional q.answer overrides option text. */
function getAnswerWord(q) {
  if (q.answer) return normalizeAnswer(q.answer);
  return normalizeAnswer(q.options[q.correctIndex]);
}

function getAnswerLabel(q) {
  return q.options[q.correctIndex];
}

function normalizeAnswer(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Puzzle variant rotation (10 variants, no repeat for consecutive players) ----
function getNextVariantIndex(maxVariants) {
  const key = "phonepe_puzzle_variant";
  try {
    let idx = parseInt(sessionStorage.getItem(key) || "0", 10);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    sessionStorage.setItem(key, String((idx + 1) % maxVariants));
    return idx;
  } catch {
    return Math.floor(Math.random() * maxVariants);
  }
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pickDecoys(allDecoys, variant, qIndex, targetWord, question, count = 5) {
  const rng = seededRandom(variant * 97 + qIndex * 13 + 7);
  const forbidden = new Set((cfg?.questions ?? []).map(getAnswerWord));
  const wrongOptions = (question?.options ?? [])
    .filter((_, i) => i !== question.correctIndex)
    .map(normalizeAnswer)
    .filter((w) => w && w !== targetWord && !forbidden.has(w) && w.length <= 14);

  const pool = [...wrongOptions, ...allDecoys.map(normalizeAnswer)]
    .filter((w) => w && w !== targetWord && !forbidden.has(w));
  const unique = [...new Set(pool)];
  const shuffled = unique.sort(() => rng() - 0.5);
  return shuffled.slice(0, count);
}

// ---- Audio ----
let audioCtx;
function beep(type) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = type === "good" ? 740 : 180;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(type === "good" ? 0.22 : 0.12, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (type === "good" ? 0.12 : 0.18));
    o.stop(now + (type === "good" ? 0.14 : 0.22));
  } catch {}
}

// ---- Word search generator ----
const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: -1, dc: 0 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: -1, dc: -1 },
];

function randInt(n, rng = Math.random) {
  return Math.floor(rng() * n);
}
function choice(arr, rng = Math.random) {
  return arr[randInt(arr.length, rng)];
}
function randomLetter(rng = Math.random) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return letters[randInt(letters.length, rng)];
}

function computeGridSize(words, minSize, maxSize) {
  const longest = Math.max(...words.map((a) => a.length));
  const base = Math.max(minSize, longest + 2);
  return Math.min(maxSize, Math.max(base, minSize));
}

function tryPlaceWord(grid, word, wordIndex, rng) {
  const size = grid.length;
  const dir = choice(DIRS, rng);
  const reversed = rng() < 0.5;
  const letters = (reversed ? word.split("").reverse().join("") : word).split("");
  const dr = dir.dr;
  const dc = dir.dc;
  const rMin = dr === -1 ? letters.length - 1 : 0;
  const rMax = dr === 1 ? size - letters.length : size - 1;
  const cMin = dc === -1 ? letters.length - 1 : 0;
  const cMax = dc === 1 ? size - letters.length : size - 1;
  if (rMax < rMin || cMax < cMin) return null;

  const startR = rMin + randInt(rMax - rMin + 1, rng);
  const startC = cMin + randInt(cMax - cMin + 1, rng);
  const cells = [];

  for (let i = 0; i < letters.length; i++) {
    const r = startR + dr * i;
    const c = startC + dc * i;
    const cur = grid[r][c];
    if (cur.letter && cur.letter !== letters[i]) return null;
    cells.push({ r, c });
  }

  for (let i = 0; i < letters.length; i++) {
    const { r, c } = cells[i];
    grid[r][c].letter = letters[i];
    grid[r][c].belongsTo.add(wordIndex);
  }
  return { dir, reversed, start: { r: startR, c: startC }, cells };
}

function generateWordSearch(words, cfgGrid, seed) {
  const normalized = words.map(normalizeAnswer);
  const size = computeGridSize(normalized, cfgGrid.minSize ?? 12, cfgGrid.maxSize ?? 16);
  const rng = seededRandom(seed);

  for (let attempt = 0; attempt < 40; attempt++) {
    const grid = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ letter: "", belongsTo: new Set() })),
    );
    const placements = [];
    let ok = true;

    for (let w = 0; w < normalized.length; w++) {
      let placed = null;
      for (let tries = 0; tries < 300; tries++) {
        placed = tryPlaceWord(grid, normalized[w], w, rng);
        if (placed) break;
      }
      if (!placed) {
        ok = false;
        break;
      }
      placements.push(placed);
    }
    if (!ok) continue;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c].letter) grid[r][c].letter = randomLetter(rng);
      }
    }
    return { size, grid, words: normalized, placements, targetIndex: 0 };
  }
  throw new Error("Failed to generate grid");
}

// ---- State machine ----
const Screen = {
  START: "start",
  QUIZ: "quiz",
  WORDFIND: "wordfind",
  END: "end",
};

let cfg;
let gridAbort = null;
let state = {
  screen: Screen.START,
  questionIndex: 0,
  puzzleVariant: 0,
  totalScore: 0,
  roundScores: [],
  currentRound: null,
  gridData: null,
  feedback: null,
  idleResetTimer: null,
  wordFindTimer: null,
  remainingMs: 15000,
  wordFindStartedAt: 0,
  selecting: false,
  selStart: null,
  selEnd: null,
  locked: false,
};

function clearGridHandlers() {
  if (gridAbort) {
    gridAbort.abort();
    gridAbort = null;
  }
}

function clearTimers() {
  if (state.wordFindTimer) clearInterval(state.wordFindTimer);
  state.wordFindTimer = null;
  if (state.idleResetTimer) clearTimeout(state.idleResetTimer);
  state.idleResetTimer = null;
}

function scheduleIdleReset() {
  if (state.idleResetTimer) clearTimeout(state.idleResetTimer);
  const sec = cfg?.idleResetSeconds ?? 10;
  state.idleResetTimer = setTimeout(() => goStart(), sec * 1000);
}

function nowMs() {
  return Date.now();
}

function startGame() {
  clearTimers();
  const variantCount = cfg.puzzleVariants ?? 10;
  state.questionIndex = 0;
  state.puzzleVariant = getNextVariantIndex(variantCount);
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  state.screen = Screen.QUIZ;
  render();
}

function startWordFind() {
  const q = cfg.questions[state.questionIndex];
  const target = getAnswerWord(q);
  const decoys = pickDecoys(
    cfg.decoyWords ?? [],
    state.puzzleVariant,
    state.questionIndex,
    target,
    q,
  );

  state.locked = true;
  try {
    const seed = state.puzzleVariant * 1000 + state.questionIndex * 37 + 11;
    state.gridData = generateWordSearch([target, ...decoys], cfg.grid ?? {}, seed);
  } catch {
    state.feedback = { type: "bad", text: "Puzzle error — skipping to next question" };
    state.currentRound.word = 0;
    render();
    setTimeout(() => {
      state.feedback = null;
      finishRound();
    }, 1400);
    return;
  }

  state.remainingMs = (cfg.wordFindSeconds ?? 15) * 1000;
  state.wordFindStartedAt = nowMs();
  state.screen = Screen.WORDFIND;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.locked = false;

  clearTimers();
  state.wordFindTimer = setInterval(() => {
    const elapsed = nowMs() - state.wordFindStartedAt;
    state.remainingMs = Math.max(0, (cfg.wordFindSeconds ?? 15) * 1000 - elapsed);
    if (state.remainingMs <= 0) {
      onWordFindTimeout();
    } else {
      updateWordFindTimerUI();
    }
  }, 200);

  render();
}

async function answerQuiz(optionIndex) {
  if (state.locked || state.screen !== Screen.QUIZ) return;
  state.locked = true;

  const q = cfg.questions[state.questionIndex];
  const correct = optionIndex === q.correctIndex;
  const quizPts = correct ? (cfg.quizPoints ?? 10) : 0;

  state.currentRound = { quiz: quizPts, word: 0, quizCorrect: correct };

  if (!correct) {
    beep("bad");
    state.feedback = { type: "bad", text: "Incorrect — moving to next question" };
    render();
    await delay(1400);
    state.feedback = null;
    finishRound();
    return;
  }

  beep("good");
  state.feedback = { type: "good", text: `Correct! +${quizPts} points` };
  render();
  await delay(1100);
  if (state.screen !== Screen.QUIZ) return;
  state.feedback = null;
  startWordFind();
}

function onWordFindTimeout() {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;
  clearTimers();
  state.currentRound.word = 0;
  state.feedback = { type: "bad", text: "Time's up — no word points" };
  render();
  setTimeout(() => {
    state.feedback = null;
    finishRound();
  }, 1400);
}

async function onWordSelected(matchIdx) {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;

  const full = cfg.wordPoints ?? 10;

  if (matchIdx === 0) {
    clearTimers();
    beep("good");
    state.currentRound.word = full;
    state.feedback = { type: "good", text: `Word found! +${full} points` };
    render();
    await delay(1300);
    if (state.screen !== Screen.WORDFIND) return;
    state.feedback = null;
    finishRound();
    return;
  }

  // Wrong word — no points, stay on puzzle and let player retry
  beep("bad");
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.feedback = { type: "bad", text: "Wrong word — try again" };
  render();
  await delay(900);
  if (state.screen !== Screen.WORDFIND) return;
  state.feedback = null;
  state.locked = false;
  render();
}

function finishRound() {
  if (!state.currentRound) return;
  const pts = (state.currentRound.quiz ?? 0) + (state.currentRound.word ?? 0);
  state.totalScore += pts;
  state.roundScores.push({ ...state.currentRound, total: pts });
  state.currentRound = null;
  state.gridData = null;
  state.locked = false;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  clearGridHandlers();
  state.questionIndex++;

  if (state.questionIndex >= cfg.questions.length) {
    endGame();
  } else {
    state.screen = Screen.QUIZ;
    render();
  }
}

function endGame() {
  clearTimers();
  state.screen = Screen.END;
  scheduleIdleReset();
  render();
}

function goStart() {
  clearTimers();
  clearGridHandlers();
  state.screen = Screen.START;
  state.questionIndex = 0;
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  render();
}

// ---- Selection logic ----
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function sign(n) {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}
function cellsOnLine(a, b) {
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  const sdr = sign(dr);
  const sdc = sign(dc);
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  if (!(absR === 0 || absC === 0 || absR === absC)) return [];
  const steps = Math.max(absR, absC);
  const out = [];
  for (let i = 0; i <= steps; i++) out.push({ r: a.r + sdr * i, c: a.c + sdc * i });
  return out;
}
function readWordFromCells(cells, gridData) {
  return cells.map(({ r, c }) => gridData.grid[r][c].letter).join("");
}
function whichWordMatch(selectedWord, gridData) {
  const reversed = selectedWord.split("").reverse().join("");
  return gridData.words.findIndex((w) => w === selectedWord || w === reversed);
}

function flashBad() {
  beep("bad");
  const el = document.querySelector("[data-grid]");
  if (!el) return;
  el.classList.remove("flashBad");
  void el.offsetWidth;
  el.classList.add("flashBad");
}

// ---- Rendering helpers ----
function fmtSeconds(ms) {
  return Math.ceil(ms / 1000);
}
function timerColor(ms, totalMs) {
  const p = ms / totalMs;
  if (p > 0.5) return "good";
  if (p > 0.2) return "warn";
  return "bad";
}

function renderHeader(title, subtitle, chips = "") {
  return `
    <header class="header site-header">
      <div class="brand">
        <div class="logo" aria-hidden="true"><div class="logo-mark"></div></div>
        <div class="title">
          <div class="h1">${title}</div>
          <div class="sub">${subtitle}</div>
        </div>
      </div>
      <div class="header-meta">${chips}</div>
    </header>
  `;
}

function renderSiteFooter(left = "PhonePe Quiz Game", right = "© PhonePe") {
  return `
    <footer class="footer site-footer">
      <span>${left}</span>
      <span>${right}</span>
    </footer>
  `;
}

function renderTimerBlock(remaining, totalMs) {
  const sec = fmtSeconds(remaining);
  const tColor = timerColor(remaining, totalMs);
  const pct = clamp(remaining / totalMs, 0, 1);
  const stroke =
    tColor === "good" ? "var(--pp-good)" : tColor === "warn" ? "var(--pp-warn)" : "var(--pp-bad)";
  const r = 24;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return `
    <div class="timer-block">
      <div class="timer-ring" aria-hidden="true">
        <svg viewBox="0 0 56 56">
          <circle class="track" cx="28" cy="28" r="${r}" />
          <circle class="fill" cx="28" cy="28" r="${r}"
            stroke="${stroke}" stroke-dasharray="${circ.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}" />
        </svg>
      </div>
      <div class="timer-info">
        <div class="label">Time left</div>
        <div class="value ${tColor}">${sec}s</div>
        <div class="progress-bar"><div style="width:${(pct * 100).toFixed(1)}%;background:${stroke}"></div></div>
      </div>
    </div>
  `;
}

function displayScore() {
  const pending = state.currentRound?.quiz ?? 0;
  return state.totalScore + pending;
}

function updateWordFindTimerUI() {
  if (state.screen !== Screen.WORDFIND) return;
  const totalMs = (cfg.wordFindSeconds ?? 15) * 1000;
  const host = document.querySelector("[data-timer-host]");
  if (host) host.innerHTML = renderTimerBlock(state.remainingMs, totalMs);
}

function renderFeedback() {
  if (!state.feedback) return "";
  return `<div class="feedback feedback-${state.feedback.type}">${escapeHtml(state.feedback.text)}</div>`;
}

function buildGridHtml(gridData, interactive = true) {
  const size = gridData.size;
  const large = size > 14 ? " large" : "";
  const selCells =
    interactive && state.selStart && state.selEnd ? cellsOnLine(state.selStart, state.selEnd) : [];
  const selSet = new Set(selCells.map((p) => `${p.r},${p.c}`));
  let html = `<div class="grid-scroll"><div class="grid${large}" data-grid data-cols="${size}" style="--cols:${size};grid-template-columns:repeat(${size},1fr)">`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const key = `${r},${c}`;
      const cell = gridData.grid[r][c];
      const isSel = selSet.has(key);
      html += `<div class="cell ${isSel ? "sel" : ""}" data-cell="${r},${c}" role="button"
        aria-label="Letter ${cell.letter}">${cell.letter}</div>`;
    }
  }
  html += `</div></div>`;
  return html;
}

function renderStart() {
  const wordSec = cfg.wordFindSeconds ?? 15;
  const quizPts = cfg.quizPoints ?? 10;
  const wordPts = cfg.wordPoints ?? 10;
  $app.innerHTML = `
    <div class="screen page-home">
      ${renderHeader("PhonePe", "Quiz + Find the Word", `<span class="chip">Free to Play</span>`)}
      <main class="start-hero page-main">
        <p class="eyebrow">Interactive word puzzle</p>
        <h1>Quiz & <span>Find the Word</span></h1>
        <p class="lead">
          Answer <strong>3 questions</strong>, then find the <strong>same answer</strong> hidden in the puzzle grid.
          Correct quiz answers earn points. Find the right answer for full word points.
        </p>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-title">Answer the quiz</div>
            <div class="step-desc">Choose the correct option · +${quizPts} pts</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-title">Find the answer</div>
            <div class="step-desc">${wordSec}s to find your answer in the grid · +${wordPts} pts</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-title">3 rounds total</div>
            <div class="step-desc">Wrong selection = 0 pts · Try again until time runs out</div>
          </div>
        </div>
        <button class="btn btn-primary" data-start>Start Game</button>
      </main>
      ${renderSiteFooter("Works on mobile, tablet & desktop", "Scroll · Tap · Play")}
    </div>
  `;
  document.querySelector("[data-start]")?.addEventListener("click", () => startGame());
}

function renderQuiz() {
  const q = cfg.questions[state.questionIndex];
  const total = cfg.questions.length;
  const opts = q.options
    .map(
      (opt, i) => `
      <button class="quiz-option" data-opt="${i}" type="button">
        <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
        <span class="opt-text">${escapeHtml(opt)}</span>
      </button>`,
    )
    .join("");

  $app.innerHTML = `
    <div class="screen">
      ${renderHeader(
        "Quiz Round",
        `Question ${state.questionIndex + 1} of ${total}`,
        `<span class="chip chip-strong">Score: ${displayScore()}</span>`,
      )}
      <div class="screen-body quiz-body">
        <div class="card card-sm quiz-card">
          <div class="section-label">Question ${state.questionIndex + 1}</div>
          <h2 class="quiz-question">${escapeHtml(q.clue)}</h2>
          <p class="quiz-hint">Tap the correct answer below</p>
          <div class="quiz-options">${opts}</div>
        </div>
      </div>
      <footer class="footer page-footer">
        <span>Wrong answer moves to next question</span>
        <span>Correct answer unlocks the word puzzle</span>
      </footer>
      ${renderFeedback()}
    </div>
  `;

  document.querySelectorAll("[data-opt]").forEach((btn) => {
    btn.addEventListener("click", () => answerQuiz(parseInt(btn.dataset.opt, 10)));
  });
}

function renderWordFind() {
  const q = cfg.questions[state.questionIndex];
  const answerLabel = getAnswerLabel(q);
  const answerWord = getAnswerWord(q);
  const totalMs = (cfg.wordFindSeconds ?? 15) * 1000;
  const gridHtml = buildGridHtml(state.gridData, true);

  $app.innerHTML = `
    <div class="screen">
      ${renderHeader(
        "Find the Answer",
        `Round ${state.questionIndex + 1} · Puzzle #${state.puzzleVariant + 1}`,
        `<span class="chip chip-strong">Score: ${displayScore()}</span>`,
      )}
      <div class="screen-body">
        <div class="play-layout wordfind-layout">
          <div class="card card-sm">
            <div data-timer-host>${renderTimerBlock(state.remainingMs, totalMs)}</div>
            <div class="find-target">
              Find: <strong>${escapeHtml(answerLabel)}</strong>
              <span class="find-target-code">${escapeHtml(answerWord)}</span>
            </div>
            <div class="grid-section">${gridHtml}</div>
            <p class="grid-hint">Drag across letters in a straight line · Release to submit</p>
          </div>
          <div class="card card-sm rules-card">
            <div class="section-label">Rules</div>
            <ul class="rules-list">
              <li>Find the <strong>correct answer</strong> from the quiz in the grid</li>
              <li>Wrong options and similar words are hidden as decoys</li>
              <li>Correct answer → <strong>+${cfg.wordPoints ?? 10} pts</strong></li>
              <li>Wrong selection → <strong>0 pts</strong> — keep trying</li>
              <li>Time runs out → move to next question</li>
            </ul>
            <div class="quiz-recap">
              <div class="section-label">You answered</div>
              <p class="recap-q">${escapeHtml(q.clue)}</p>
              <p class="recap-a">✓ ${escapeHtml(answerLabel)}</p>
            </div>
          </div>
        </div>
      </div>
      ${renderSiteFooter(`${cfg.wordFindSeconds ?? 15}s per puzzle`, "Drag across letters to select")}
      ${renderFeedback()}
    </div>
  `;
  attachGridHandlers();
}

function renderEnd() {
  const maxScore = state.roundScores.reduce((sum, r) => {
    const quizMax = cfg.quizPoints ?? 10;
    const wordMax = r.quizCorrect ? (cfg.wordPoints ?? 10) : 0;
    return sum + quizMax + wordMax;
  }, 0) || cfg.questions.length * ((cfg.quizPoints ?? 10) + (cfg.wordPoints ?? 10));
  const left = cfg.idleResetSeconds ?? 10;

  const rows = state.roundScores
    .map((r, i) => {
      const q = cfg.questions[i];
      return `
        <div class="score-row">
          <div class="score-q">Q${i + 1}: ${escapeHtml(q.clue)}</div>
          <div class="score-detail">
            Quiz: ${r.quizCorrect ? `+${r.quiz}` : "0"}
            ${r.quizCorrect ? ` · Answer: +${r.word}` : " (skipped)"}
            · <strong>${r.total} pts</strong>
          </div>
        </div>`;
    })
    .join("");

  $app.innerHTML = `
    <div class="screen">
      ${renderHeader(
        "Game Over",
        "Your final score",
        `<span class="chip">Resets in ~${left}s</span>`,
      )}
      <div class="screen-body">
        <div class="end-score-card card">
          <div class="final-score">${state.totalScore}</div>
          <div class="final-score-label">out of ${maxScore} points</div>
          <div class="score-breakdown">${rows}</div>
          <button class="btn btn-primary" data-new>Play Again</button>
        </div>
      </div>
      ${renderSiteFooter(`Puzzle variant #${state.puzzleVariant + 1}`, "New puzzle each session")}
    </div>
  `;
  document.querySelector("[data-new]")?.addEventListener("click", () => startGame());
}

function render() {
  if (!cfg) return;
  if (state.screen === Screen.START) return renderStart();
  if (state.screen === Screen.QUIZ) return renderQuiz();
  if (state.screen === Screen.WORDFIND) return renderWordFind();
  if (state.screen === Screen.END) return renderEnd();
}

// ---- Grid touch handlers ----
function parseCellAttr(v) {
  const [r, c] = String(v).split(",").map((x) => parseInt(x, 10));
  return { r, c };
}
function nearestCellFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el?.closest?.("[data-cell]");
  if (!cell) return null;
  return { el: cell, pos: parseCellAttr(cell.getAttribute("data-cell")) };
}

function attachGridHandlers() {
  clearGridHandlers();
  const gridEl = document.querySelector("[data-grid]");
  if (!gridEl) return;

  gridAbort = new AbortController();
  const { signal } = gridAbort;
  let upHandled = false;

  const onDown = (e) => {
    if (state.screen !== Screen.WORDFIND || state.locked) return;
    const hit = nearestCellFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    upHandled = false;
    state.selecting = true;
    state.selStart = hit.pos;
    state.selEnd = hit.pos;
    try {
      gridEl.setPointerCapture(e.pointerId);
    } catch {}
    updateGridSelectionUI();
  };

  const onMove = (e) => {
    if (!state.selecting || state.locked) return;
    const hit = nearestCellFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    state.selEnd = hit.pos;
    updateGridSelectionUI();
  };

  const onUp = () => {
    if (!state.selecting || state.locked || upHandled) return;
    upHandled = true;
    state.selecting = false;
    if (!state.selStart || !state.selEnd) return;

    const cells = cellsOnLine(state.selStart, state.selEnd);
    state.selStart = null;
    state.selEnd = null;
    updateGridSelectionUI();

    if (!cells.length) {
      flashBad();
      return;
    }
    const word = readWordFromCells(cells, state.gridData);
    const match = whichWordMatch(word, state.gridData);
    if (match === -1) {
      flashBad();
      return;
    }
    onWordSelected(match);
  };

  gridEl.addEventListener("pointerdown", onDown, { passive: false, signal });
  gridEl.addEventListener("pointermove", onMove, { passive: false, signal });
  gridEl.addEventListener("pointerup", onUp, { passive: true, signal });
  gridEl.addEventListener("pointercancel", onUp, { passive: true, signal });
}

function updateGridSelectionUI() {
  if (!state.gridData) return;
  const selCells =
    state.selStart && state.selEnd ? cellsOnLine(state.selStart, state.selEnd) : [];
  const selSet = new Set(selCells.map((p) => `${p.r},${p.c}`));
  document.querySelectorAll("[data-cell]").forEach((cell) => {
    const pos = parseCellAttr(cell.getAttribute("data-cell"));
    cell.classList.toggle("sel", selSet.has(`${pos.r},${pos.c}`));
  });
}

// ---- Boot ----
(async function main() {
  initApp();
  try {
    cfg = await loadConfig();
    goStart();
  } catch (err) {
    $app.innerHTML = `<div class="screen"><div class="card card-sm" style="margin:40px auto;max-width:600px">
      <h2>Config error</h2><p>${escapeHtml(err.message)}</p></div></div>`;
  }
  window.addEventListener("pointerdown", () => {
    if (state.screen === Screen.END) scheduleIdleReset();
  });
})();
