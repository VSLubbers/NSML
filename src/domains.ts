// src/domains.ts - Domain-Specific Hooks for NSML
import { AstNode, SymbolTable, EvalError } from './types';
// Registry: Map of domain tag types to handler functions
export const domainRegistry = new Map<
  string,
  (node: AstNode, context: SymbolTable) => { result: any; error?: EvalError }
>();
// Example: Chess hook - Enhanced board/move validation and simulation (manual logic, no deps)
// Now supports FEN notation for board state, legal move validation for all pieces including captures for pawns, move execution, and basic queries like possible moves for a piece.
// FEN parsing and chess rules implemented minimally for demonstration (no castling, en passant, promotion, check/checkmate).
// Extensibility: Users can register custom domains via registerDomain, e.g., for math or logic hooks.
// Example registration for a custom domain:
// registerDomain('math', (node, context) => { /* implement math logic */ });
// This allows scaling to BBH tasks like arithmetic or logic puzzles without core changes.
domainRegistry.set('chess', (node: AstNode, context: SymbolTable) => {
  const fen = node.attributes.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // Default starting FEN
  const moves = node.attributes.moves?.split(',') || [];
  const validate = node.attributes.validate === 'true';
  const executeMoves = node.attributes.execute === 'true';
  const queryPiece = node.attributes.queryPiece; // e.g., 'e2' for possible moves from square
  let board = parseFEN(fen);
  let turn = fen.split(' ')[1] === 'w' ? 'white' : 'black'; // Simplified, assumes starting turn
  // For validation, simulate moves on a temp board
  if (validate) {
    let tempBoard = board.map(row => [...row]);
    let tempTurn = turn;
    for (const move of moves) {
      if (!/^[a-h][1-8]-[a-h][1-8]$/.test(move)) {
        return {
          result: false,
          error: { type: 'runtime', message: `Invalid algebraic move '${move}'`, line: node.line },
        };
      }
      const [from, to] = move.split('-');
      if (!isLegalMove(tempBoard, from, to, tempTurn)) {
        return {
          result: false,
          error: { type: 'runtime', message: `Illegal move '${move}' on current board`, line: node.line },
        };
      }
      tempBoard = applyMove(tempBoard, from, to);
      tempTurn = tempTurn === 'white' ? 'black' : 'white';
    }
  }
  let currentBoard = board.map(row => [...row]); // Copy board
  let currentTurn = turn;
  if (executeMoves) {
    for (const move of moves) {
      const [from, to] = move.split('-');
      if (isLegalMove(currentBoard, from, to, currentTurn)) {
        currentBoard = applyMove(currentBoard, from, to);
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
      } else {
        return {
          result: null,
          error: { type: 'runtime', message: `Cannot execute illegal move '${move}'`, line: node.line },
        };
      }
    }
  }
  let queryResult = null;
  if (queryPiece) {
    queryResult = getPossibleMoves(currentBoard, queryPiece, currentTurn);
  }
  // Return enhanced state
  return { result: { fen: toFEN(currentBoard), moves, queryResult } };
});
// Simple FEN parser to 8x8 board array (rows 0-7 from a8 to h1, files 0-7 a-h)
function parseFEN(fen: string): string[][] {
  const [boardStr] = fen.split(' ');
  const rows = boardStr.split('/');
  const board: string[][] = [];
  for (let r = 0; r < 8; r++) {
    board[r] = [];
    let col = 0;
    for (const char of rows[r]) {
      if (/\d/.test(char)) {
        const empty = parseInt(char, 10);
        for (let i = 0; i < empty; i++) {
          board[r][col++] = '.';
        }
      } else {
        board[r][col++] = char;
      }
    }
  }
  return board;
}
// Convert board back to FEN board string (simplified, ignores turn, castling, etc.)
function toFEN(board: string[][]): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let rowStr = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === '.') {
        empty++;
      } else {
        if (empty > 0) {
          rowStr += empty;
          empty = 0;
        }
        rowStr += board[r][c];
      }
    }
    if (empty > 0) rowStr += empty;
    rows.push(rowStr);
  }
  return rows.join('/');
}
// Check if move is legal (basic rules for all pieces, no check validation)
function isLegalMove(board: string[][], from: string, to: string, turn: string): boolean {
  const [fx, fy] = squareToCoord(from);
  const [tx, ty] = squareToCoord(to);
  const piece = board[fy][fx];
  if (piece === '.') return false;
  if ((turn === 'white' && piece.toLowerCase() === piece) || (turn === 'black' && piece.toUpperCase() === piece)) return false; // Wrong turn
  const dx = tx - fx;
  const dy = ty - fy;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  switch (piece.toLowerCase()) {
    case 'p': // Pawn
      const dir = piece === 'P' ? -1 : 1;
      const startingRank = piece === 'P' ? 6 : 1;
      if (absDx === 0) { // Forward
        if (dy === dir && board[ty][tx] === '.') {
          return true;
        }
        if (dy === 2 * dir && fy === startingRank && board[fy + dir][fx] === '.' && board[ty][tx] === '.') {
          return true;
        }
        return false;
      } else if (absDx === 1 && dy === dir) { // Capture
        return isOpponent(piece, board[ty][tx]);
      }
      return false;
    case 'r': // Rook
      if (dx !== 0 && dy !== 0) return false;
      return isClearPath(board, fx, fy, tx, ty, piece);
    case 'n': // Knight
      if (!((absDx === 1 && absDy === 2) || (absDx === 2 && absDy === 1))) return false;
      return board[ty][tx] === '.' || isOpponent(piece, board[ty][tx]);
    case 'b': // Bishop
      if (absDx !== absDy) return false;
      return isClearPath(board, fx, fy, tx, ty, piece);
    case 'q': // Queen
      if (!(dx === 0 || dy === 0 || absDx === absDy)) return false;
      return isClearPath(board, fx, fy, tx, ty, piece);
    case 'k': // King
      if (absDx > 1 || absDy > 1) return false;
      return board[ty][tx] === '.' || isOpponent(piece, board[ty][tx]);
    default:
      return false;
  }
}
// Apply move (swap positions, capture if opponent)
function applyMove(board: string[][], from: string, to: string): string[][] {
  const newBoard = board.map(row => [...row]);
  const [fx, fy] = squareToCoord(from);
  const [tx, ty] = squareToCoord(to);
  newBoard[ty][tx] = newBoard[fy][fx];
  newBoard[fy][fx] = '.';
  return newBoard;
}
// Get possible moves for a piece at square
function getPossibleMoves(board: string[][], square: string, turn: string): string[] {
  const [x, y] = squareToCoord(square);
  const piece = board[y][x];
  if (piece === '.' || (turn === 'white' && piece.toLowerCase() === piece) || (turn === 'black' && piece.toUpperCase() === piece)) return [];
  const moves: string[] = [];
  const pieceType = piece.toLowerCase();
  const dir = pieceType === 'p' ? (piece === 'P' ? -1 : 1) : 0;
  const startingRank = pieceType === 'p' ? (piece === 'P' ? 6 : 1) : 0;
  if (pieceType === 'p') {
    // Forward 1
    const nx = x;
    const ny = y + dir;
    if (ny >= 0 && ny < 8 && board[ny][nx] === '.') {
      moves.push(coordToSquare(nx, ny));
    }
    // Forward 2
    if (y === startingRank && board[y + dir][x] === '.' && board[y + 2 * dir][x] === '.') {
      moves.push(coordToSquare(x, y + 2 * dir));
    }
    // Captures
    for (const dx of [-1, 1]) {
      const cx = x + dx;
      const cy = y + dir;
      if (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && isOpponent(piece, board[cy][cx])) {
        moves.push(coordToSquare(cx, cy));
      }
    }
  } else {
    const directions = getPieceDirections(pieceType);
    for (const [dx, dy] of directions) {
      let nx = x + dx;
      let ny = y + dy;
      while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
        if (board[ny][nx] === '.') {
          moves.push(coordToSquare(nx, ny));
        } else if (isOpponent(piece, board[ny][nx])) {
          moves.push(coordToSquare(nx, ny));
          break;
        } else {
          break;
        }
        if (['n', 'k'].includes(pieceType)) break; // Non-sliding
        nx += dx;
        ny += dy;
      }
    }
  }
  return moves;
}
// Helper: Get directions for piece type (sliding or not)
function getPieceDirections(piece: string): [number, number][] {
  switch (piece) {
    case 'r': return [[0, 1], [0, -1], [1, 0], [-1, 0]]; // Rook
    case 'n': return [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]]; // Knight
    case 'b': return [[1, 1], [1, -1], [-1, 1], [-1, -1]]; // Bishop
    case 'q': return [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]; // Queen
    case 'k': return [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]; // King
    default: return [];
  }
}
// Helper: Check if path is clear for sliding pieces
function isClearPath(board: string[][], fx: number, fy: number, tx: number, ty: number, piece: string): boolean {
  const dx = Math.sign(tx - fx);
  const dy = Math.sign(ty - fy);
  let x = fx + dx;
  let y = fy + dy;
  while (x !== tx || y !== ty) {
    if (board[y][x] !== '.') return false;
    x += dx;
    y += dy;
  }
  return board[ty][tx] === '.' || isOpponent(piece, board[ty][tx]);
}
// Helper: Check if pieces are opponents
function isOpponent(piece1: string, piece2: string): boolean {
  return (piece1.toLowerCase() === piece1) !== (piece2.toLowerCase() === piece2);
}
// Helper: Convert square (e.g., 'e2') to coord [file 0-7, rank 0-7]
function squareToCoord(square: string): [number, number] {
  return [square.charCodeAt(0) - 'a'.charCodeAt(0), 8 - parseInt(square[1])];
}
// Helper: Convert coord to square
function coordToSquare(x: number, y: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + x) + (8 - y);
}
// Extensibility: Users can register custom domains
export function registerDomain(
  type: string,
  handler: (
    node: AstNode,
    context: SymbolTable
  ) => { result: any; error?: EvalError }
) {
  domainRegistry.set(type, handler);
}