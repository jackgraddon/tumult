export const SCRABBLE_TILES: Record<string, { count: number; value: number }> = {
  A: { count: 9, value: 1 },
  B: { count: 2, value: 3 },
  C: { count: 2, value: 3 },
  D: { count: 4, value: 2 },
  E: { count: 12, value: 1 },
  F: { count: 2, value: 4 },
  G: { count: 3, value: 2 },
  H: { count: 2, value: 4 },
  I: { count: 9, value: 1 },
  J: { count: 1, value: 8 },
  K: { count: 1, value: 5 },
  L: { count: 4, value: 1 },
  M: { count: 2, value: 3 },
  N: { count: 6, value: 1 },
  O: { count: 8, value: 1 },
  P: { count: 2, value: 3 },
  Q: { count: 1, value: 10 },
  R: { count: 6, value: 1 },
  S: { count: 4, value: 1 },
  T: { count: 6, value: 1 },
  U: { count: 4, value: 1 },
  V: { count: 2, value: 4 },
  W: { count: 2, value: 4 },
  X: { count: 1, value: 8 },
  Y: { count: 2, value: 4 },
  Z: { count: 1, value: 10 },
  ' ': { count: 2, value: 0 }, // Blank tile
};

export type MultiplierType = 'DL' | 'TL' | 'DW' | 'TW' | null;

export const BOARD_MULTIPLIERS: MultiplierType[][] = Array(15)
  .fill(null)
  .map(() => Array(15).fill(null));

const TW = [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]];
const DW = [[1, 1], [1, 13], [2, 2], [2, 12], [3, 3], [3, 11], [4, 4], [4, 10], [7, 7], [10, 4], [10, 10], [11, 3], [11, 11], [12, 12], [13, 13], [12, 2], [13, 1], [2, 12], [1, 13], [4, 10], [10, 4]];

const TL = [[1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9]];
const DL = [[3, 0], [11, 0], [6, 2], [8, 2], [0, 3], [7, 3], [14, 3], [2, 6], [6, 6], [8, 6], [12, 6], [3, 7], [11, 7], [2, 8], [6, 8], [8, 8], [12, 8], [0, 11], [7, 11], [14, 11], [6, 12], [8, 12], [3, 14], [11, 14]];

TW.forEach(([r, c]) => (BOARD_MULTIPLIERS[r][c] = 'TW'));
DW.forEach(([r, c]) => (BOARD_MULTIPLIERS[r][c] = 'DW'));
TL.forEach(([r, c]) => (BOARD_MULTIPLIERS[r][c] = 'TL'));
DL.forEach(([r, c]) => (BOARD_MULTIPLIERS[r][c] = 'DL'));

export function createInitialBag(): string[] {
  const bag: string[] = [];
  for (const [letter, info] of Object.entries(SCRABBLE_TILES)) {
    for (let i = 0; i < info.count; i++) {
      bag.push(letter);
    }
  }
  return shuffle(bag);
}

export function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export interface Tile {
  letter: string;
  assigned?: string;
  isBlank: boolean;
  player: string;
}

export interface PlacedTile {
  r: number;
  c: number;
  letter: string;
  isBlank: boolean;
  assigned?: string;
}

export function validatePlacement(
  placed: PlacedTile[],
  board: (Tile | null)[][]
): { valid: boolean; error?: string } {
  if (placed.length === 0) return { valid: false, error: 'No tiles placed' };

  // 1. Check if it's the first move and includes the center (7, 7)
  const isFirstMove = board.every(row => row.every(cell => cell === null));
  if (isFirstMove) {
    if (!placed.some(p => p.r === 7 && p.c === 7)) {
      return { valid: false, error: 'First move must use the center square' };
    }
  }

  // 2. Check if all tiles are in a straight line (same row or same column)
  const rows = new Set(placed.map(p => p.r));
  const cols = new Set(placed.map(p => p.c));
  if (rows.size > 1 && cols.size > 1) {
    return { valid: false, error: 'Tiles must be in a single row or column' };
  }

  // 3. Check if they are contiguous (allowing for existing tiles in between)
  const sorted = [...placed].sort((a, b) => (rows.size === 1 ? a.c - b.c : a.r - b.r));
  if (rows.size === 1) {
    const r = sorted[0].r;
    for (let c = sorted[0].c; c <= sorted[sorted.length - 1].c; c++) {
      if (!placed.find(p => p.c === c) && !board[r][c]) {
        return { valid: false, error: 'Tiles must be placed contiguously' };
      }
    }
  } else {
    const c = sorted[0].c;
    for (let r = sorted[0].r; r <= sorted[sorted.length - 1].r; r++) {
      if (!placed.find(p => p.r === r) && !board[r][c]) {
        return { valid: false, error: 'Tiles must be placed contiguously' };
      }
    }
  }

  // 4. Check connectivity to existing tiles (unless it's the first move)
  if (!isFirstMove) {
    const connected = placed.some(p => {
      const neighbors = [
        [p.r - 1, p.c], [p.r + 1, p.c], [p.r, p.c - 1], [p.r, p.c + 1]
      ];
      return neighbors.some(([nr, nc]) => nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr][nc]);
    });
    if (!connected) {
      return { valid: false, error: 'Tiles must be connected to existing ones' };
    }
  }

  return { valid: true };
}

export function calculateScore(
  placed: PlacedTile[],
  board: (Tile | null)[][]
): { total: number; words: { word: string; score: number }[] } {
  const result = { total: 0, words: [] as { word: string; score: number }[] };
  
  // Temporarily apply placed tiles to board for word detection
  const tempBoard = JSON.parse(JSON.stringify(board));
  placed.forEach(p => {
    tempBoard[p.r][p.c] = { letter: p.letter, isBlank: p.isBlank, assigned: p.assigned };
  });

  const processedWords = new Set<string>(); // Key: "r,c-orientation"

  function getWordAt(r: number, c: number, horizontal: boolean) {
    let startR = r;
    let startC = c;
    
    if (horizontal) {
      while (startC > 0 && tempBoard[startR][startC - 1]) startC--;
    } else {
      while (startR > 0 && tempBoard[startR - 1][startC]) startR--;
    }

    const key = `${startR},${startC}-${horizontal ? 'H' : 'V'}`;
    if (processedWords.has(key)) return null;

    let word = '';
    let currR = startR;
    let currC = startC;
    let score = 0;
    let wordMult = 1;

    while (currR < 15 && currC < 15 && tempBoard[currR][currC]) {
      const tile = tempBoard[currR][currC];
      const letter = tile.letter;
      const displayLetter = tile.isBlank ? (tile.assigned || '?') : letter;
      word += displayLetter;

      let val = SCRABBLE_TILES[letter]?.value || 0;
      
      // Only apply multipliers if it was a JUST placed tile
      const isNew = placed.find(p => p.r === currR && p.c === currC);
      if (isNew) {
        const mult = BOARD_MULTIPLIERS[currR][currC];
        if (mult === 'DL') val *= 2;
        else if (mult === 'TL') val *= 3;
        else if (mult === 'DW') wordMult *= 2;
        else if (mult === 'TW') wordMult *= 3;
      }

      score += val;
      if (horizontal) currC++; else currR++;
    }

    if (word.length < 2) return null;
    
    processedWords.add(key);
    return { word, score: score * wordMult };
  }

  // Check all words formed by the move
  placed.forEach(p => {
    // Check horizontal word
    const hWord = getWordAt(p.r, p.c, true);
    if (hWord) result.words.push(hWord);
    
    // Check vertical word
    const vWord = getWordAt(p.r, p.c, false);
    if (vWord) result.words.push(vWord);
  });

  result.total = result.words.reduce((sum, w) => sum + w.score, 0);
  
  // Bingo
  if (placed.length === 7) result.total += 50;

  return result;
}
