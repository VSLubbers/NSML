// src/domains.ts - Domain-Specific Hooks for NSML

import { AstNode, SymbolTable, EvalError } from './types';

// Registry: Map of domain tag types to handler functions
export const domainRegistry = new Map<string, (node: AstNode, context: SymbolTable) => { result: any; error?: EvalError }>();

// Example: Chess hook - Simple board/move validation (manual logic, no deps)
domainRegistry.set('chess', (node: AstNode, context: SymbolTable) => {
  const board = node.attributes.board?.split(',') || [];  // e.g., ['e4', 'e5']
  const moves = node.attributes.moves?.split(',') || [];
  const validate = node.attributes.validate === 'true';

  if (validate) {
    // Basic validation: Check if moves are valid algebraic notation
    const validMoves = moves.every(m => /^[a-h][1-8]-[a-h][1-8]$/.test(m));
    if (!validMoves) {
      return { result: false, error: { type: 'runtime', message: 'Invalid chess move', line: node.line } };
    }
  }

  // Return state or result
  return { result: { board, moves } };
});

// Extensibility: Users can register custom domains
export function registerDomain(type: string, handler: (node: AstNode, context: SymbolTable) => { result: any; error?: EvalError }) {
  domainRegistry.set(type, handler);
}