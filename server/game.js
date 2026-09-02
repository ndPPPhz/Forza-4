const ROWS = 6;
const COLS = 7;

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

// board[row][col], row 0 = riga in alto. Ritorna { row } oppure null se colonna piena.
function dropDisc(board, col, color) {
  if (col < 0 || col >= COLS) return null;
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === 0) {
      board[row][col] = color;
      return { row, col };
    }
  }
  return null;
}

const DIRECTIONS = [
  [0, 1], // orizzontale
  [1, 0], // verticale
  [1, 1], // diagonale \
  [1, -1], // diagonale /
];

function checkWin(board, row, col, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== 0);
}

module.exports = { ROWS, COLS, createBoard, dropDisc, checkWin, isBoardFull };
