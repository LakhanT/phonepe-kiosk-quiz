const $app = document.getElementById("app");

// ---- Kiosk hardening (only when ?kiosk=1) ----
function shouldHardenKiosk() {
  const params = new URLSearchParams(location.search);
  if (params.get("kiosk") === "1") return true;
  if (params.get("debug") === "1") return false;
  return localStorage.getItem("phonepe_kiosk_mode") === "1";
}

function hardenKiosk() {
  if (!shouldHardenKiosk()) return;

  window.addEventListener("contextmenu", (e) => e.preventDefault(), { passive: false });
  window.addEventListener("selectstart", (e) => e.preventDefault(), { passive: false });
  window.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

  try {
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", () => history.pushState(null, "", location.href));
  } catch {}

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 280) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );

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
    const word = getCategoryWord(q);
    if (!word || word.length < 2) {
      throw new Error(`Question ${i + 1} categoryWord is too short after normalization`);
    }
    if (word.length > (data.grid?.maxSize ?? 24)) {
      throw new Error(`Question ${i + 1} category "${word}" exceeds grid maxSize`);
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

/** Puzzle target = category / keyword of the question (Game Rules #2). */
function getCategoryWord(q) {
  if (q.categoryWord) return normalizeAnswer(q.categoryWord);
  if (q.answer) return normalizeAnswer(q.answer);
  return normalizeAnswer(q.options[q.correctIndex]);
}

function getCategoryLabel(q) {
  if (q.categoryWord) return String(q.categoryWord).trim();
  return getCategoryWord(q);
}

function getAnswerLabel(q) {
  return q.options[q.correctIndex];
}

function normalizeAnswer(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function halfPoints(full) {
  return Math.round(full / 2);
}

/** Excel A/B plus question-specific third wrong option (optionC). */
function getQuizOptions(q) {
  const a = q.options?.[0] ?? "";
  const b = q.options?.[1] ?? "";
  const c = q.optionC ?? q.options?.[2] ?? "Proceed without checking the policy.";
  return [a, b, c];
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick `count` random unique questions from the bank for this player. */
function pickRoundQuestions(all, count, seed) {
  const rng = seededRandom(seed);
  const idxs = all.map((_, i) => i);
  shuffleInPlace(idxs, rng);
  const n = Math.min(count, idxs.length);
  return idxs.slice(0, n).map((i) => all[i]);
}

/** All keywords for this player's 10 questions — target first, others jumbled. */
function buildKeywordListForPuzzle(questions, targetWord, seed) {
  const seen = new Set();
  const unique = [];
  for (const q of questions) {
    const w = getCategoryWord(q);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    unique.push(w);
  }
  const others = unique.filter((w) => w !== targetWord);
  shuffleInPlace(others, seededRandom(seed));
  return targetWord ? [targetWord, ...others] : others;
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
// Game Rules: crossword is horizontal + vertical only (no diagonals).
const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: -1, dc: 0 },
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
  // Grow with word count so ~10 keywords still fit (H/V only).
  const byCount = Math.ceil(Math.sqrt(words.reduce((s, w) => s + w.length, 0) * 1.6));
  const base = Math.max(minSize, longest + 2, byCount);
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
  const normalized = words.map(normalizeAnswer).filter(Boolean);
  const minSize = cfgGrid.minSize ?? 14;
  const maxSize = cfgGrid.maxSize ?? 24;
  let size = computeGridSize(normalized, minSize, maxSize);
  const rng = seededRandom(seed);

  for (let grow = 0; grow < 6; grow++) {
    const trySize = Math.min(maxSize, size + grow);
    for (let attempt = 0; attempt < 50; attempt++) {
      const grid = Array.from({ length: trySize }, () =>
        Array.from({ length: trySize }, () => ({ letter: "", belongsTo: new Set() })),
      );
      const placements = [];
      let ok = true;

      // Longer words first — easier packing
      const order = normalized
        .map((w, i) => ({ w, i }))
        .sort((a, b) => b.w.length - a.w.length);

      const placedByOrig = new Array(normalized.length);
      for (const { w, i } of order) {
        let placed = null;
        for (let tries = 0; tries < 400; tries++) {
          placed = tryPlaceWord(grid, w, i, rng);
          if (placed) break;
        }
        if (!placed) {
          ok = false;
          break;
        }
        placedByOrig[i] = placed;
      }
      if (!ok) continue;

      for (let r = 0; r < trySize; r++) {
        for (let c = 0; c < trySize; c++) {
          if (!grid[r][c].letter) grid[r][c].letter = randomLetter(rng);
        }
      }
      return {
        size: trySize,
        grid,
        words: normalized,
        placements: placedByOrig,
        targetIndex: 0,
      };
    }
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
  roundQuestions: [],
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
  quizReveal: null,
  revealTarget: false,
};

function activeQuestion() {
  return state.roundQuestions[state.questionIndex];
}

function roundsPerGame() {
  return Math.min(cfg.roundsPerGame ?? 3, cfg.questions.length);
}

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
  state.puzzleVariant = getNextVariantIndex(variantCount);
  state.roundQuestions = pickRoundQuestions(
    cfg.questions,
    roundsPerGame(),
    state.puzzleVariant * 7919 + Date.now(),
  );
  state.questionIndex = 0;
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  state.quizReveal = null;
  state.revealTarget = false;
  state.screen = Screen.QUIZ;
  render();
}

function startWordFind() {
  const q = activeQuestion();
  const target = getCategoryWord(q);
  const keywords = buildKeywordListForPuzzle(
    state.roundQuestions,
    target,
    state.puzzleVariant * 1000 + state.questionIndex * 37 + 11,
  );

  state.locked = true;
  try {
    const seed = state.puzzleVariant * 1000 + state.questionIndex * 37 + 11;
    state.gridData = generateWordSearch(keywords, cfg.grid ?? {}, seed);
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

  const q = activeQuestion();
  const correct = optionIndex === q.correctIndex;
  const quizPts = correct ? (cfg.quizPoints ?? 10) : 0;
  const correctLabel = getAnswerLabel(q);

  state.currentRound = { quiz: quizPts, word: 0, quizCorrect: correct };
  state.quizReveal = { picked: optionIndex, correct: q.correctIndex };

  if (!correct) {
    beep("bad");
    state.feedback = {
      type: "bad",
      text: `Incorrect — correct answer: ${correctLabel}`,
    };
    render();
    await delay(2600);
    state.feedback = null;
    state.quizReveal = null;
    finishRound();
    return;
  }

  beep("good");
  state.feedback = { type: "good", text: `Correct! +${quizPts} points — find the keyword` };
  render();
  await delay(1100);
  if (state.screen !== Screen.QUIZ) return;
  state.feedback = null;
  state.quizReveal = null;
  startWordFind();
}

function getTargetPlacementCells() {
  const place = state.gridData?.placements?.[0];
  return place?.cells ?? [];
}

function paintTargetReveal() {
  const cells = getTargetPlacementCells();
  const set = new Set(cells.map((p) => `${p.r},${p.c}`));
  document.querySelectorAll("[data-cell]").forEach((el) => {
    const key = el.getAttribute("data-cell");
    el.classList.toggle("reveal", set.has(key));
    el.classList.remove("sel");
  });
}

async function revealKeywordThenFinish(message, type = "bad", waitMs = 2800) {
  state.revealTarget = true;
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.feedback = { type, text: message };
  render();
  paintTargetReveal();
  await delay(waitMs);
  if (state.screen !== Screen.WORDFIND) return;
  state.feedback = null;
  state.revealTarget = false;
  finishRound();
}

function onWordFindTimeout() {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;
  clearTimers();
  state.currentRound.word = 0;
  const label = getCategoryLabel(activeQuestion());
  void revealKeywordThenFinish(`Time's up — correct keyword highlighted: ${label}`);
}

async function onWordSelected(matchIdx) {
  if (state.screen !== Screen.WORDFIND || state.locked) return;
  state.locked = true;

  const full = cfg.wordPoints ?? 10;
  const quizPts = state.currentRound.quiz ?? 0;
  const label = getCategoryLabel(activeQuestion());

  if (matchIdx === 0) {
    clearTimers();
    beep("good");
    state.currentRound.word = full;
    state.revealTarget = true;
    state.feedback = { type: "good", text: `Keyword found! +${full} points` };
    render();
    paintTargetReveal();
    document.querySelectorAll(".cell.reveal").forEach((el) => {
      el.classList.remove("reveal");
      el.classList.add("foundA");
    });
    await delay(1300);
    if (state.screen !== Screen.WORDFIND) return;
    state.feedback = null;
    state.revealTarget = false;
    finishRound();
    return;
  }

  if (matchIdx > 0) {
    clearTimers();
    beep("bad");
    const halfTotal = halfPoints(quizPts + full);
    state.currentRound.word = Math.max(0, halfTotal - quizPts);
    await revealKeywordThenFinish(
      `Wrong keyword — half points (+${halfTotal}). Correct: ${label}`,
      "warn",
      3000,
    );
    return;
  }

  beep("bad");
  state.selecting = false;
  state.selStart = null;
  state.selEnd = null;
  state.feedback = { type: "bad", text: "Not a valid word — try again" };
  flashBad();
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
  state.quizReveal = null;
  state.revealTarget = false;
  clearGridHandlers();
  state.questionIndex++;

  if (state.questionIndex >= state.roundQuestions.length) {
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
  state.roundQuestions = [];
  state.totalScore = 0;
  state.roundScores = [];
  state.currentRound = null;
  state.gridData = null;
  state.feedback = null;
  state.locked = false;
  state.quizReveal = null;
  state.revealTarget = false;
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
  // Horizontal or vertical only — no diagonals
  if (!(absR === 0 || absC === 0)) return [];
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
    <header class="header">
      <div class="brand">
        <img class="logo-img" src="./assets/logo.png" alt="PhonePe" width="132" height="36" />
        <div class="title">
          <div class="h1">${title}</div>
          <div class="sub">${subtitle}</div>
        </div>
      </div>
      <div class="header-meta">${chips}</div>
    </header>
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
  const revealSet = state.revealTarget
    ? new Set(getTargetPlacementCells().map((p) => `${p.r},${p.c}`))
    : new Set();
  let html = `<div class="grid-fit"><div class="grid${large}" data-grid data-cols="${size}" style="--cols:${size}">`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const key = `${r},${c}`;
      const cell = gridData.grid[r][c];
      const isSel = selSet.has(key);
      const isReveal = revealSet.has(key);
      const cls = [isSel ? "sel" : "", isReveal ? "reveal" : ""].filter(Boolean).join(" ");
      html += `<div class="cell ${cls}" data-cell="${r},${c}" role="button"
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
  const roundCount = roundsPerGame();
  const bankSize = cfg.questions.length;
  $app.innerHTML = `
    <div class="screen">
      ${renderHeader("PhonePe Integrity", "Quiz + Find the Word", `<span class="chip">${cfg.kioskResolution ?? "1920×1080"}</span>`)}
      <div class="start-hero">
        <h1>Integrity <span>Challenge</span></h1>
        <p class="lead">
          Answer <strong>${roundCount} questions</strong> from the Ethics bank (${bankSize} total).
          Each quiz shows <strong>3 options</strong> (A, B, and a related third choice).
          If correct, find that question’s <strong>keyword</strong> in a crossword that hides
          <strong>all ${roundCount} keywords</strong> (layout jumbled per player).
        </p>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-title">Answer the quiz</div>
            <div class="step-desc">Pick A, B, or C · +${quizPts} pts if right</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-title">Find the keyword</div>
            <div class="step-desc">${wordSec}s · H/V only · +${wordPts} pts</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-title">${roundCount} rounds</div>
            <div class="step-desc">Wrong keyword = half points · Wrong quiz = skip puzzle</div>
          </div>
        </div>
        <button class="btn btn-primary" data-start>Tap to Start</button>
      </div>
      <footer class="footer">
        <span>Touch-only Integrity campaign game</span>
        <span>10 puzzle variants · keywords jumbled per player</span>
      </footer>
    </div>
  `;
  document.querySelector("[data-start]")?.addEventListener("pointerdown", () => {
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {}
    startGame();
  });
}

function renderQuiz() {
  const q = activeQuestion();
  const total = state.roundQuestions.length;
  const reveal = state.quizReveal;
  const opts = getQuizOptions(q)
    .map((opt, i) => {
      let extra = "";
      if (reveal) {
        if (i === reveal.correct) extra = " quiz-option-correct";
        else if (i === reveal.picked) extra = " quiz-option-wrong";
        else extra = " quiz-option-dim";
      }
      return `
      <button class="quiz-option${extra}" data-opt="${i}" type="button" ${reveal ? "disabled" : ""}>
        <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
        <span class="opt-text">${escapeHtml(opt)}</span>
      </button>`;
    })
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
          <div class="section-label">${escapeHtml(q.allegation || "Integrity")} · Round ${state.questionIndex + 1}</div>
          <h2 class="quiz-question">${escapeHtml(q.clue)}</h2>
          <p class="quiz-hint">${
            reveal
              ? reveal.picked === reveal.correct
                ? "Correct!"
                : "Incorrect — green option is the correct answer"
              : "Tap the correct answer (A, B, or C)"
          }</p>
          <div class="quiz-options">${opts}</div>
        </div>
      </div>
      <footer class="footer">
        <span>Wrong answer moves to next question</span>
        <span>Correct answer unlocks Find the Keyword</span>
      </footer>
      ${renderFeedback()}
    </div>
  `;

  if (!reveal) {
    document.querySelectorAll("[data-opt]").forEach((btn) => {
      btn.addEventListener("pointerdown", () => answerQuiz(parseInt(btn.dataset.opt, 10)));
    });
  }
}

function renderWordFind() {
  const q = activeQuestion();
  const categoryLabel = getCategoryLabel(q);
  const categoryWord = getCategoryWord(q);
  const answerLabel = getAnswerLabel(q);
  const totalMs = (cfg.wordFindSeconds ?? 15) * 1000;
  const half = halfPoints((cfg.quizPoints ?? 10) + (cfg.wordPoints ?? 10));
  const keywordCount = state.gridData?.words?.length ?? state.roundQuestions.length;
  const gridHtml = buildGridHtml(state.gridData, !state.revealTarget);

  $app.innerHTML = `
    <div class="screen">
      ${renderHeader(
        "Find the Keyword",
        `Round ${state.questionIndex + 1} · Puzzle #${state.puzzleVariant + 1}`,
        `<span class="chip chip-strong">Score: ${displayScore()}</span>`,
      )}
      <div class="screen-body">
        <div class="play-layout wordfind-layout">
          <div class="card card-sm puzzle-card">
            <div data-timer-host>${renderTimerBlock(state.remainingMs, totalMs)}</div>
            <div class="find-target">
              <span class="find-target-label">Find this keyword in the grid</span>
              <strong>${escapeHtml(categoryLabel)}</strong>
              <span class="find-target-code">${escapeHtml(categoryWord)}</span>
            </div>
            <div class="grid-section">
              ${gridHtml}
            </div>
            <p class="grid-hint">Drag horizontally or vertically · ${keywordCount} keywords hidden (jumbled)</p>
          </div>
          <div class="card card-sm rules-card">
            <div class="section-label">Rules</div>
            <ul class="rules-list">
              <li>Find this question’s <strong>keyword</strong> (not the quiz option text)</li>
              <li>All <strong>${keywordCount} keywords</strong> from this game are in the crossword</li>
              <li>Correct keyword → <strong>+${cfg.wordPoints ?? 10} pts</strong></li>
              <li>Wrong keyword → <strong>half points only</strong> (~${half} total)</li>
              <li>Time runs out → no word points</li>
            </ul>
            <div class="quiz-recap">
              <div class="section-label">You answered</div>
              <p class="recap-q">${escapeHtml(q.clue)}</p>
              <p class="recap-a">✓ ${escapeHtml(answerLabel)}</p>
              <p class="recap-cat">Keyword: <strong>${escapeHtml(categoryLabel)}</strong></p>
            </div>
          </div>
        </div>
      </div>
      <footer class="footer">
        <span>${cfg.wordFindSeconds ?? 15} seconds per word search</span>
        <span>Horizontal & vertical only · forwards or backwards</span>
      </footer>
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
  }, 0) || roundsPerGame() * ((cfg.quizPoints ?? 10) + (cfg.wordPoints ?? 10));
  const left = cfg.idleResetSeconds ?? 10;

  const rows = state.roundScores
    .map((r, i) => {
      const q = state.roundQuestions[i];
      return `
        <div class="score-row">
          <div class="score-q">Q${i + 1}: ${escapeHtml(q.allegation || q.clue)}</div>
          <div class="score-detail">
            Quiz: ${r.quizCorrect ? `+${r.quiz}` : "0"}
            ${r.quizCorrect ? ` · Category: +${r.word}` : " (skipped)"}
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
      <footer class="footer">
        <span>Puzzle variant #${state.puzzleVariant + 1} used</span>
        <span>Next player gets a different puzzle</span>
      </footer>
    </div>
  `;
  document.querySelector("[data-new]")?.addEventListener("pointerdown", () => startGame());
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
  hardenKiosk();
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
