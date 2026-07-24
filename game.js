/* Sudoku for Maybaah's Arcade.

   The puzzle is dug out of a seeded solved grid, keeping only the removals
   that leave exactly one answer, so nothing here ever needs a guess. Every
   entry lands in a move log, so a solve can be submitted to the leaderboard
   Worker, which rebuilds the same puzzle from the seed and replays the log
   before ranking the time: the never-trust-the-client model the rest of the
   arcade uses. */
(function () {
  "use strict";

  /* must match the worker's copy exactly */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── the generator ────────────────────────────────────────────────────────
     Duplicated in the arcade Worker. The page draws whatever this builds and
     the Worker rebuilds the same puzzle from the same seed to audit the run,
     so drift means the two disagree about which squares were the player's to
     fill and every solve is rejected. Same rule as the PRNG above.
     ──────────────────────────────────────────────────────────────────────── */

  var SUDOKU_CLUES = { easy: 42, medium: 32, hard: 26 };

  var SUDOKU_PEERS = (function () {
    var peers = [];
    for (var i = 0; i < 81; i++) {
      var ri = (i / 9) | 0, ci = i % 9;
      var bi = ((ri / 3) | 0) * 3 + ((ci / 3) | 0);
      var set = [];
      for (var j = 0; j < 81; j++) {
        if (j === i) continue;
        var rj = (j / 9) | 0, cj = j % 9;
        var bj = ((rj / 3) | 0) * 3 + ((cj / 3) | 0);
        if (ri === rj || ci === cj || bi === bj) set.push(j);
      }
      peers.push(set);
    }
    return peers;
  })();

  function sudokuShuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* A solved grid, built from the canonical pattern and then relabelled and
     shuffled by band, stack and row. Every one of those moves maps a valid
     grid to another valid grid, so no search is needed to get here. */
  function sudokuSolved(rnd) {
    var digits = sudokuShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd);
    var bands = sudokuShuffle([0, 1, 2], rnd);
    var stacks = sudokuShuffle([0, 1, 2], rnd);
    var rows = [], cols = [], b, k;
    for (b = 0; b < 3; b++) {
      var inner = sudokuShuffle([0, 1, 2], rnd);
      for (k = 0; k < 3; k++) rows.push(bands[b] * 3 + inner[k]);
    }
    for (b = 0; b < 3; b++) {
      var innerCol = sudokuShuffle([0, 1, 2], rnd);
      for (k = 0; k < 3; k++) cols.push(stacks[b] * 3 + innerCol[k]);
    }
    var flip = rnd() < 0.5;
    var g = new Array(81);
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        var sr = rows[r], sc = cols[c];
        g[flip ? c * 9 + r : r * 9 + c] = digits[(3 * (sr % 3) + ((sr / 3) | 0) + sc) % 9];
      }
    }
    return g;
  }

  /* Solutions, counted no further than two: the digger only ever asks whether
     the puzzle still pins down exactly one answer. Fewest candidates first, so
     a forced square is taken before anything is branched on. */
  function sudokuCountSolutions(grid) {
    var cand = new Int32Array(81).fill(0x1ff);
    var work = grid.slice();
    var found = 0;
    var i, p, ps, bit;

    for (i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      bit = 1 << (grid[i] - 1);
      ps = SUDOKU_PEERS[i];
      for (p = 0; p < ps.length; p++) cand[ps[p]] &= ~bit;
    }

    function search() {
      var best = -1, bestN = 10, m, n, i, d, p, ps, bit, undo, u;
      for (i = 0; i < 81; i++) {
        if (work[i]) continue;
        m = cand[i]; n = 0;
        while (m) { m &= m - 1; n++; }
        if (n === 0) return;
        if (n < bestN) { bestN = n; best = i; if (n === 1) break; }
      }
      if (best < 0) { found++; return; }
      for (d = 0; d < 9; d++) {
        bit = 1 << d;
        if (!(cand[best] & bit)) continue;
        work[best] = d + 1;
        undo = [];
        ps = SUDOKU_PEERS[best];
        for (p = 0; p < ps.length; p++) {
          if (cand[ps[p]] & bit) { cand[ps[p]] &= ~bit; undo.push(ps[p]); }
        }
        search();
        for (u = 0; u < undo.length; u++) cand[undo[u]] |= bit;
        work[best] = 0;
        if (found > 1) return;
      }
    }

    search();
    return found;
  }

  /* Digs squares out of a solved grid in a seeded order, in pairs about the
     center so the result is symmetric, and keeps a removal only while the
     answer stays unique. Difficulty is how bare it is allowed to get. */
  function sudokuGenerate(seed, difficulty) {
    var rnd = mulberry32(seed >>> 0);
    var solution = sudokuSolved(rnd);
    var puzzle = solution.slice();
    var target = SUDOKU_CLUES[difficulty];
    var clues = 81;
    var order = [], i;
    for (i = 0; i < 81; i++) order.push(i);
    sudokuShuffle(order, rnd);
    for (var k = 0; k < order.length && clues > target; k++) {
      var a = order[k], b = 80 - a;
      if (!puzzle[a]) continue;
      var va = puzzle[a], vb = puzzle[b];
      var drop = a === b || !vb ? 1 : 2;
      puzzle[a] = 0; puzzle[b] = 0;
      if (sudokuCountSolutions(puzzle) === 1) clues -= drop;
      else { puzzle[a] = va; puzzle[b] = vb; }
    }
    return { puzzle: puzzle, solution: solution, clues: clues };
  }

  /* ── end of the generator ── */

  function randomSeed() {
    if (window.crypto && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return (Math.random() * 4294967296) >>> 0;
  }

  var MAX_MOVES = 4000;

  var gridEl = document.getElementById("grid");
  var padEl = document.getElementById("pad");
  var hLeft = document.getElementById("h-left");
  var hTime = document.getElementById("h-time");
  var hBest = document.getElementById("h-best");
  var result = document.getElementById("result");
  var btnNotes = document.getElementById("btn-notes");

  var diff = "easy";
  var puzzle, solution, grid, notes;   // notes[i] is a 9-bit pencil mark mask
  var seed, moves, sel, done, notesMode = false;
  var startTs, timerId, winTimeMs;

  function tick() {
    hTime.textContent = Arcade.fmtTime(startTs ? Date.now() - startTs : 0);
  }

  /* the clock runs from the moment the board is on screen: reading the grid is
     part of the solve. A deal made in a background tab waits until the player
     actually looks at it. */
  function startClock() {
    if (startTs) return;
    if (document.hidden) {
      document.addEventListener("visibilitychange", startClockWhenVisible);
      return;
    }
    startTs = Date.now();
    timerId = setInterval(tick, 100);
  }

  function startClockWhenVisible() {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", startClockWhenVisible);
    startClock();
  }

  function buildGrid() {
    gridEl.innerHTML = "";
    for (var i = 0; i < 81; i++) {
      var r = (i / 9) | 0, c = i % 9;
      var el = document.createElement("button");
      el.type = "button";
      el.className = "sq" + (c % 3 === 2 && c < 8 ? " bx" : "") + (r % 3 === 2 && r < 8 ? " by" : "");
      el.dataset.i = i;
      el.setAttribute("aria-label", "row " + (r + 1) + " column " + (c + 1));
      gridEl.appendChild(el);
    }
  }

  function buildPad() {
    padEl.innerHTML = "";
    for (var d = 1; d <= 9; d++) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.d = d;
      b.innerHTML = d + '<span class="left"></span>';
      padEl.appendChild(b);
    }
  }

  function conflicts() {
    var bad = new Array(81).fill(false);
    for (var i = 0; i < 81; i++) {
      if (!grid[i]) continue;
      var ps = SUDOKU_PEERS[i];
      for (var p = 0; p < ps.length; p++) {
        if (grid[ps[p]] === grid[i]) { bad[i] = true; break; }
      }
    }
    return bad;
  }

  function paint() {
    var bad = conflicts();
    var selDigit = sel >= 0 ? grid[sel] : 0;
    var counts = new Array(10).fill(0);
    var left = 0;

    for (var i = 0; i < 81; i++) {
      if (grid[i]) counts[grid[i]]++;
      else left++;

      var el = gridEl.children[i];
      var cls = "sq";
      var r = (i / 9) | 0, c = i % 9;
      if (c % 3 === 2 && c < 8) cls += " bx";
      if (r % 3 === 2 && r < 8) cls += " by";
      if (puzzle[i]) cls += " given";
      if (sel >= 0 && i !== sel && SUDOKU_PEERS[sel].indexOf(i) !== -1) cls += " peer";
      if (selDigit && grid[i] === selDigit) cls += " same";
      if (bad[i]) cls += " bad";
      if (i === sel) cls += " sel";
      el.className = cls;

      if (grid[i]) {
        el.textContent = grid[i];
      } else if (notes[i]) {
        var marks = "";
        for (var d = 1; d <= 9; d++) marks += "<span>" + (notes[i] & (1 << (d - 1)) ? d : "") + "</span>";
        el.innerHTML = '<div class="notes">' + marks + "</div>";
      } else {
        el.textContent = "";
      }
    }

    hLeft.textContent = String(left);
    for (var k = 1; k <= 9; k++) {
      var btn = padEl.children[k - 1];
      btn.querySelector(".left").textContent = 9 - counts[k] > 0 ? String(9 - counts[k]) : "";
      btn.classList.toggle("spent", counts[k] >= 9);
    }
  }

  function select(i) {
    sel = i;
    paint();
  }

  function setDigit(d) {
    if (done || sel < 0 || puzzle[sel]) return;
    if (moves.length >= MAX_MOVES) return;
    startClock();

    if (notesMode) {
      if (grid[sel]) return;
      notes[sel] ^= 1 << (d - 1);
      paint();
      return;
    }

    if (grid[sel] === d) { erase(); return; }
    grid[sel] = d;
    notes[sel] = 0;
    moves.push(["s", sel, d]);
    // a placed digit cannot be a pencil mark anywhere it can see
    var ps = SUDOKU_PEERS[sel];
    for (var p = 0; p < ps.length; p++) notes[ps[p]] &= ~(1 << (d - 1));
    paint();
    checkWin();
  }

  function erase() {
    if (done || sel < 0 || puzzle[sel]) return;
    if (moves.length >= MAX_MOVES) return;
    if (!grid[sel] && !notes[sel]) return;
    startClock();
    if (grid[sel]) {
      grid[sel] = 0;
      moves.push(["x", sel]);
    }
    notes[sel] = 0;
    paint();
  }

  function checkWin() {
    for (var i = 0; i < 81; i++) if (grid[i] !== solution[i]) return;
    win();
  }

  function win() {
    done = true;
    clearInterval(timerId);
    var t = startTs ? Date.now() - startTs : 0;
    winTimeMs = t;
    hTime.textContent = Arcade.fmtTime(t);
    gridEl.classList.add("done");
    sel = -1;
    paint();

    var prev = Arcade.bestSudoku(diff);
    Arcade.addScore("sudoku", { result: "win", difficulty: diff, timeMs: t });
    var isPB = !prev || t < prev.timeMs;
    hBest.textContent = Arcade.fmtTime(isPB ? t : prev.timeMs);
    result.innerHTML = '<span class="win">✓ solved</span> in ' + Arcade.fmtTime(t) +
      (isPB ? ". New personal best." : "");
    showSubmitUI();
  }

  /* ── submission: the worker rebuilds the puzzle and replays the log ── */
  function showSubmitUI() {
    var input = document.getElementById("run-name");
    var stored = Arcade.getPlayer();
    input.value = stored === "player" ? "" : stored;
    document.getElementById("run-status").textContent = "";
    document.getElementById("btn-submit-run").disabled = false;
    document.getElementById("submit-run").style.display = "flex";
  }

  function submitRun() {
    var input = document.getElementById("run-name");
    var status = document.getElementById("run-status");
    var btn = document.getElementById("btn-submit-run");
    var name = input.value.trim();
    if (!name) {
      status.textContent = "enter a name first";
      input.focus();
      return;
    }
    if (!window.Arcade || !Arcade.submit) return;
    Arcade.setPlayer(name);
    btn.disabled = true;
    status.textContent = "verifying…";
    Arcade.submit("sudoku", {
      difficulty: diff,
      seed: seed,
      moves: moves,
      timeMs: winTimeMs
    }).then(function (res) {
      status.textContent = res && res.rank
        ? "verified, ranked #" + res.rank + " on " + diff
        : "verified";
    }).catch(function (e) {
      status.textContent = e.message || "submission failed";
      btn.disabled = false;
    });
  }

  function newGame(d) {
    diff = d || diff;
    seed = randomSeed();
    var built = sudokuGenerate(seed, diff);
    puzzle = built.puzzle;
    solution = built.solution;
    grid = puzzle.slice();
    notes = new Array(81).fill(0);
    moves = [];
    sel = -1;
    done = false;
    winTimeMs = null;
    startTs = null;
    clearInterval(timerId);
    hTime.textContent = "0.0s";
    result.textContent = "";
    gridEl.classList.remove("done");
    document.getElementById("submit-run").style.display = "none";

    document.querySelectorAll(".mode-pills .pill").forEach(function (p) {
      p.setAttribute("aria-pressed", String(p.dataset.diff === diff));
    });
    var best = Arcade.bestSudoku(diff);
    hBest.textContent = best ? Arcade.fmtTime(best.timeMs) : "none";
    paint();
    startClock();
  }

  /* ── input ── */
  gridEl.addEventListener("click", function (e) {
    var el = e.target.closest(".sq");
    if (!el || done) return;
    select(+el.dataset.i);
  });

  padEl.addEventListener("click", function (e) {
    var el = e.target.closest("button");
    if (!el) return;
    setDigit(+el.dataset.d);
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

    if (e.key >= "1" && e.key <= "9") { e.preventDefault(); setDigit(+e.key); return; }
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { e.preventDefault(); erase(); return; }
    if (e.key === "n" || e.key === "N") { e.preventDefault(); toggleNotes(); return; }

    var step = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step || done) return;
    e.preventDefault();
    if (sel < 0) { select(0); return; }
    var c = sel % 9;
    if (step === -1 && c === 0) return;
    if (step === 1 && c === 8) return;
    var next = sel + step;
    if (next >= 0 && next < 81) select(next);
  });

  function toggleNotes() {
    notesMode = !notesMode;
    btnNotes.setAttribute("aria-pressed", String(notesMode));
    btnNotes.classList.toggle("btn-primary", notesMode);
    btnNotes.classList.toggle("btn-secondary", !notesMode);
  }

  btnNotes.addEventListener("click", toggleNotes);
  document.getElementById("btn-erase").addEventListener("click", erase);
  document.getElementById("btn-new").addEventListener("click", function () { newGame(); });
  document.querySelectorAll(".mode-pills .pill").forEach(function (p) {
    p.addEventListener("click", function () { newGame(p.dataset.diff); });
  });
  document.getElementById("btn-submit-run").addEventListener("click", submitRun);
  document.getElementById("run-name").addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitRun();
  });

  buildGrid();
  buildPad();
  newGame("easy");

  /* exposed for the staging checks */
  window.__sudoku = {
    state: function () {
      return { seed: seed, diff: diff, moves: moves, grid: grid, puzzle: puzzle, solution: solution, done: done };
    },
    select: select,
    setDigit: setDigit,
    solve: function () {
      for (var i = 0; i < 81; i++) {
        if (grid[i] === solution[i]) continue;
        select(i);
        setDigit(solution[i]);
      }
    }
  };
})();
