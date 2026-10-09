const SIZE = 6;
const MIN_WORD_LEN = 3;

const LETTER_FREQ = {
  E: 14, A: 10, I: 10, O: 9, U: 6,
  N: 7, R: 7, T: 6, S: 6, L: 6, D: 5,
  G: 3, C: 3, M: 2, P: 2, F: 2, H: 2, B: 2, W: 2, Y: 2, V: 1,
  K: 1, J: 1, X: 1, Q: 1, Z: 1
};

const LETTER_POOL = Object.entries(LETTER_FREQ)
  .flatMap(([letter, count]) => Array(count).fill(letter));

let board = createEmptyBoard();
let score = 0;
let gameOver = false;
let bombCount = 2;
let bombActive = false;
let comboCount = 0;

// State variables for dynamic features
let moveCounter = 0;
let hotZone = { type: "row", index: 0 };
let activeWildcardCoord = null;

const boardEl = document.getElementById("board");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scoreEl = document.getElementById("score");
const readyLabelEl = document.getElementById("readyLabel");
const assistToggleEl = document.getElementById("assistToggle");
const wordLogEl = document.getElementById("wordLog");
const overlayEl = document.getElementById("gameOverOverlay");
const sweepResultsEl = document.getElementById("sweepResults");
const finalScoreEl = document.getElementById("finalScore");
const bombBtnEl = document.getElementById("bombBtn");
const bombCountEl = document.getElementById("bombCount");

const RARE_LETTERS = new Set(["Q", "Z", "X", "J", "K", "V"]);
const LENGTH_BONUS = { 3: 3, 4: 6, 5: 8, 6: 12, 7: 16, 8: 20 };

function createEmptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function randomLetter() {
  return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
}

function emptyCells() {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

function spawnLetter() {
  const cells = emptyCells();
  if (cells.length === 0) return null;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  
  const rand = Math.random();
  if (rand < 0.04) {
    board[r][c] = "?"; // 4% Wildcard chance
  } else if (rand < 0.08) {
    const doubles = ["EE", "OO", "TT", "LL", "FF", "SS", "BB"];
    board[r][c] = doubles[Math.floor(Math.random() * doubles.length)]; // 4% Double Tile chance
  } else {
    board[r][c] = randomLetter();
  }
  return [r, c];
}

function slideLine(line) {
  const letters = line.filter(Boolean);
  const gaps = Array(line.length - letters.length).fill(null);
  return letters.concat(gaps);
}

function getLine(r0, c0, dr, dc) {
  const line = [];
  let r = r0, c = c0;
  while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
    line.push(board[r][c]);
    r += dr; c += dc;
  }
  return line;
}

function setLine(r0, c0, dr, dc, values) {
  let r = r0, c = c0, i = 0;
  while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
    board[r][c] = values[i];
    r += dr; c += dc; i++;
  }
}

function move(direction) {
  if (gameOver) return;

  let changed = false;
  const lines = [];

  if (direction === "left" || direction === "right") {
    for (let r = 0; r < SIZE; r++) lines.push({ r0: r, c0: direction === "left" ? 0 : SIZE - 1, dr: 0, dc: direction === "left" ? 1 : -1 });
  } else {
    for (let c = 0; c < SIZE; c++) lines.push({ r0: direction === "up" ? 0 : SIZE - 1, c0: c, dr: direction === "up" ? 1 : -1, dc: 0 });
  }

  for (const { r0, c0, dr, dc } of lines) {
    const before = getLine(r0, c0, dr, dc);
    const after = slideLine(before);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed = true;
    setLine(r0, c0, dr, dc, after);
  }

  if (!changed) return;

  const spawned = spawnLetter();

  // Increment moves and update Hot Zone every 5 moves
  moveCounter++;
  if (moveCounter % 5 === 0) {
    hotZone.type = Math.random() < 0.5 ? "row" : "col";
    hotZone.index = Math.floor(Math.random() * SIZE);
  }

  render(spawned);
  checkGameOver();
}

// Check matching strings, including wildcards
function sliceToRegex(slice) {
  const pattern = slice.map(tile => {
    if (tile === "?") return "[a-z]";
    return tile.toLowerCase();
  }).join("");
  return new RegExp(`^${pattern}$`);
}

function matchSliceToDictionary(slice) {
  if (slice.includes(null)) return null;
  const directStr = slice.join("").toLowerCase();

  // Ensure total character count is at least 3 letters long
  if (directStr.length < MIN_WORD_LEN) return null;

  // Direct dictionary hit
  if (typeof WORD_SET !== "undefined" && WORD_SET.has(directStr)) return directStr;

  // Wildcard scan logic
  if (slice.includes("?")) {
    const regex = sliceToRegex(slice);
    for (const word of WORD_SET) {
      if (word.length === directStr.length && regex.test(word)) {
        return word;
      }
    }
  }
  return null;
}

function findBoardWords() {
  const words = [];

  // Horizontal scan (check tile spans starting from 1 tile up to remaining board cells)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (let len = SIZE - c; len >= 1; len--) {
        const slice = board[r].slice(c, c + len);
        const validWord = matchSliceToDictionary(slice);
        if (validWord) {
          words.push({
            word: validWord,
            type: "horizontal",
            coords: Array.from({ length: len }, (_, i) => [r, c + i])
          });
          break;
        }
      }
    }
  }

  // Vertical scan
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      for (let len = SIZE - r; len >= 1; len--) {
        const slice = [];
        for (let i = 0; i < len; i++) slice.push(board[r + i][c]);
        const validWord = matchSliceToDictionary(slice);
        if (validWord) {
          words.push({
            word: validWord,
            type: "vertical",
            coords: Array.from({ length: len }, (_, i) => [r + i, c])
          });
          break;
        }
      }
    }
  }

  return words;
}

function getReadyWord() {
  const foundWords = findBoardWords();
  if (foundWords.length === 0) return null;

  const cross = findCrossMatch(foundWords);
  const highlightedCoords = new Set();
  const wildcardCoords = new Set();
  let labelText = "";

  if (cross) {
    labelText = `Ready CROSS: ${cross.hWord.word.toUpperCase()} + ${cross.vWord.word.toUpperCase()} — press Enter`;
    [...cross.hWord.coords, ...cross.vWord.coords].forEach(([r, c]) => {
      highlightedCoords.add(`${r},${c}`);
      if (board[r][c] === "?") wildcardCoords.add(`${r},${c}`);
    });
  } else {
    const wordNames = foundWords.map(w => w.word.toUpperCase()).join(", ");
    labelText = `Ready: ${wordNames} — press Enter`;
    foundWords.forEach(w => {
      w.coords.forEach(([r, c]) => {
        highlightedCoords.add(`${r},${c}`);
        if (board[r][c] === "?") wildcardCoords.add(`${r},${c}`);
      });
    });
  }

  if (wildcardCoords.size > 0) {
    labelText += " (Click ? to pick a letter!)";
  }

  return {
    labelText,
    coordsSet: highlightedCoords,
    wildcardSet: wildcardCoords
  };
}

function findCrossMatch(words) {
  const horizontals = words.filter(w => w.type === "horizontal");
  const verticals = words.filter(w => w.type === "vertical");

  for (const h of horizontals) {
    for (const v of verticals) {
      const intersect = h.coords.some(([hr, hc]) => 
        v.coords.some(([vr, vc]) => hr === vr && hc === vc)
      );
      if (intersect) return { hWord: h, vWord: v };
    }
  }
  return null;
}

function calculateWordScore(wordStr) {
  const upper = wordStr.toUpperCase();
  const len = upper.length;
  let points = LENGTH_BONUS[len] !== undefined ? LENGTH_BONUS[len] : len * 2;
  const hasRare = upper.split("").some((char) => RARE_LETTERS.has(char));
  if (hasRare) points = points * 2;
  return { points, isBonus: hasRare };
}

function isTileInHotZone(r, c) {
  if (hotZone.type === "row" && r === hotZone.index) return true;
  if (hotZone.type === "col" && c === hotZone.index) return true;
  return false;
}

function submitWord() {
  if (gameOver) return;

  const foundWords = findBoardWords();
  if (foundWords.length === 0) return;

  const cross = findCrossMatch(foundWords);
  let totalPoints = 0;
  let clearedCoords = [];
  let isHot = false;

  if (cross) {
    const hScore = calculateWordScore(cross.hWord.word).points;
    const vScore = calculateWordScore(cross.vWord.word).points;
    let baseCrossPoints = (hScore + vScore) * 2;

    comboCount++;
    if (comboCount > 1) baseCrossPoints *= 2;

    totalPoints = baseCrossPoints;
    clearedCoords = [...cross.hWord.coords, ...cross.vWord.coords];

    isHot = clearedCoords.some(([r, c]) => isTileInHotZone(r, c));
    if (isHot) totalPoints *= 2;

    const comboLabel = comboCount > 1 ? ` 🔥 ${comboCount}x COMBO!` : "";
    const hotLabel = isHot ? " ⚡2x HOT ZONE!" : "";
    logWord(`CROSS: ${cross.hWord.word.toUpperCase()} + ${cross.vWord.word.toUpperCase()}${hotLabel}`, totalPoints, true, comboLabel);

  } else {
    comboCount = 0;
    const target = foundWords[0];
    const { points, isBonus } = calculateWordScore(target.word);
    
    totalPoints = points;
    clearedCoords = target.coords;

    isHot = clearedCoords.some(([r, c]) => isTileInHotZone(r, c));
    if (isHot) totalPoints *= 2;

    const hotLabel = isHot ? " (2x HOT ZONE)" : "";
    logWord(target.word + hotLabel, totalPoints, isBonus);
  }

  clearedCoords.forEach(([r, c]) => {
    board[r][c] = null;
  });

  score += totalPoints;
  render();
  checkGameOver();
}

function openWildcardPicker(r, c) {
  const choice = prompt("Enter a letter to assign to this Wildcard (?) tile:", "E");
  if (choice && choice.trim().length === 1) {
    const letter = choice.trim().toUpperCase();
    if (/^[A-Z]$/.test(letter)) {
      board[r][c] = letter;
      render();
    }
  }
}

function logWord(word, points, isBonus, extraTag = "") {
  const li = document.createElement("li");
  const bonusTag = isBonus ? " ⚡2x" : "";
  li.textContent = `${word.toUpperCase()} — ${points} pts${bonusTag}${extraTag}`;
  wordLogEl.prepend(li);
}

function triggerBomb(r, c) {
  if (bombCount <= 0 || gameOver) return;

  const startR = r === SIZE - 1 ? r - 1 : r;
  const startC = c === SIZE - 1 ? c - 1 : c;

  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const targetR = startR + dr;
      const targetC = startC + dc;
      if (targetR < SIZE && targetC < SIZE) {
        board[targetR][targetC] = null;
      }
    }
  }

  bombCount--;
  bombActive = false;
  render();
}

function toggleBombMode() {
  if (bombCount <= 0 || gameOver) return;
  bombActive = !bombActive;
  render();
}

function checkGameOver() {
  if (emptyCells().length > 0) return;
  if (getReadyWord()) return;
  gameOver = true;
  runEndgameSweepAnimated();
}

function collectLinesWithCoords() {
  const lines = [];

  // 1. Rows (Horizontal)
  for (let r = 0; r < SIZE; r++) {
    const rowCoords = Array.from({ length: SIZE }, (_, c) => [r, c]);
    lines.push(rowCoords);
    lines.push([...rowCoords].reverse());
  }

  // 2. Columns (Vertical)
  for (let c = 0; c < SIZE; c++) {
    const colCoords = Array.from({ length: SIZE }, (_, r) => [r, c]);
    lines.push(colCoords);
    lines.push([...colCoords].reverse());
  }

  // 3. Top-Left to Bottom-Right Diagonals (dr = 1, dc = 1)
  for (let slice = -(SIZE - MIN_WORD_LEN); slice <= SIZE - MIN_WORD_LEN; slice++) {
    const diag = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r + slice;
      if (c >= 0 && c < SIZE) diag.push([r, c]);
    }
    if (diag.length >= MIN_WORD_LEN) {
      lines.push(diag);
      lines.push([...diag].reverse());
    }
  }

  // 4. Top-Right to Bottom-Left Diagonals (dr = 1, dc = -1)
  for (let slice = MIN_WORD_LEN - 1; slice < 2 * SIZE - MIN_WORD_LEN; slice++) {
    const diag = [];
    for (let r = 0; r < SIZE; r++) {
      const c = slice - r;
      if (c >= 0 && c < SIZE) diag.push([r, c]);
    }
    if (diag.length >= MIN_WORD_LEN) {
      lines.push(diag);
      lines.push([...diag].reverse());
    }
  }

  return lines;
}

function findBestWordInCoords(coords) {
  const letters = coords.map(([r, c]) => board[r][c]);
  const str = letters.join("").toLowerCase();
  let best = null;

  for (let start = 0; start < str.length; start++) {
    for (let end = str.length; end > start; end--) {
      const len = end - start;
      if (len < MIN_WORD_LEN) continue;
      if (best && len <= best.len) continue;
      
      const slice = letters.slice(start, end);
      const matched = matchSliceToDictionary(slice);
      if (matched) {
        best = {
          word: matched,
          len,
          wordCoords: coords.slice(start, end)
        };
      }
    }
  }
  return best;
}

async function runEndgameSweepAnimated() {
  readyLabelEl.textContent = "Board full! Running final sweep...";
  readyLabelEl.classList.add("active");

  const linesCoords = collectLinesWithCoords();
  const foundWords = [];
  const getCellElement = (r, c) => boardEl.children[r * SIZE + c];

  for (const lineCoords of linesCoords) {
    lineCoords.forEach(([r, c]) => {
      const el = getCellElement(r, c);
      if (el) el.classList.add("sweep-highlight");
    });

    await delay(60);
    const best = findBestWordInCoords(lineCoords);

    if (best) {
      const { points, isBonus } = calculateWordScore(best.word);
      foundWords.push({ ...best, points });

      best.wordCoords.forEach(([r, c]) => {
        const el = getCellElement(r, c);
        if (el) {
          el.classList.remove("sweep-highlight");
          el.classList.add("sweep-found");
        }
      });

      score += points;
      scoreEl.textContent = score;
      logWord(best.word, points, isBonus);

      await delay(450);
    }

    lineCoords.forEach(([r, c]) => {
      const el = getCellElement(r, c);
      if (el) el.classList.remove("sweep-highlight", "sweep-found");
    });
  }

  await delay(300);

  sweepResultsEl.innerHTML = "";
  if (foundWords.length === 0) {
    sweepResultsEl.innerHTML = "<div>No additional words found.</div>";
  } else {
    foundWords
      .sort((a, b) => b.points - a.points)
      .forEach(({ word, points }) => {
        const row = document.createElement("div");
        row.innerHTML = `<span>${word.toUpperCase()}</span><span>+${points} pts</span>`;
        sweepResultsEl.appendChild(row);
      });
  }

  finalScoreEl.textContent = score;
  overlayEl.classList.remove("hidden");
}

function render(spawnedCell) {
  boardEl.innerHTML = "";
  const ready = getReadyWord();

  if (bombActive) {
    boardEl.classList.add("bomb-active");
    bombBtnEl.classList.add("active");
  } else {
    boardEl.classList.remove("bomb-active");
    bombBtnEl.classList.remove("active");
  }

  bombCountEl.textContent = bombCount;
  bombBtnEl.disabled = bombCount <= 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      const letter = board[r][c];
      cell.className = "cell" + (letter ? "" : " empty");

      if (letter) cell.setAttribute("data-tile", letter);
      if (letter && letter.length > 1) cell.classList.add("double-tile");

      // Apply Hot Zone Visual Styling
      if (isTileInHotZone(r, c)) {
        cell.classList.add("hot-zone");
      }

      // Highlight cell if assist toggle is checked and cell is in any ready word
      const isReadyCell = assistToggleEl.checked && ready && ready.coordsSet.has(`${r},${c}`);
      if (isReadyCell) cell.classList.add("ready");

      const isWildcardReady = ready && ready.wildcardSet.has(`${r},${c}`);
      if (isWildcardReady) cell.classList.add("wildcard-interactive");

      if (spawnedCell && spawnedCell[0] === r && spawnedCell[1] === c) {
        cell.classList.add("pulse");
      }

      cell.textContent = letter || "";

      cell.addEventListener("click", () => {
        if (bombActive) {
          triggerBomb(r, c);
        } else if (letter === "?" && isWildcardReady) {
          openWildcardPicker(r, c);
        }
      });

      boardEl.appendChild(cell);
    }
  }

  scoreEl.textContent = score;

  if (ready) {
    readyLabelEl.textContent = assistToggleEl.checked
      ? ready.labelText
      : "A word may be ready — press Enter to check.";
    readyLabelEl.classList.add("active");
  } else {
    readyLabelEl.textContent = "No word ready.";
    readyLabelEl.classList.remove("active");
  }
}

const KEY_DIRECTIONS = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  a: "left", d: "right", w: "up", s: "down",
};

window.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    submitWord();
    return;
  }
  const dir = KEY_DIRECTIONS[e.key];
  if (dir) {
    e.preventDefault();
    move(dir);
  }
});

let touchStart = null;
boardEl.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
});
boardEl.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    move(dx > 0 ? "right" : "left");
  } else {
    move(dy > 0 ? "down" : "up");
  }
  touchStart = null;
});

assistToggleEl.addEventListener("change", () => render());
bombBtnEl.addEventListener("click", toggleBombMode);
document.getElementById("restartBtn").addEventListener("click", resetGame);
document.getElementById("playAgainBtn").addEventListener("click", resetGame);

function resetGame() {
  board = createEmptyBoard();
  score = 0;
  gameOver = false;
  bombCount = 2;
  bombActive = false;
  moveCounter = 0;
  hotZone = { type: "row", index: 0 };
  wordLogEl.innerHTML = "";
  overlayEl.classList.add("hidden");
  spawnLetter();
  spawnLetter();
  render();
}

resetGame();