import { domainRegistry, registerDomain } from '../src/domains';
import { AstNode, SymbolTable } from '../src/types';
import { lex } from '../src/lexer';
import { parse } from '../src/parser';
import { resolve } from '../src/resolver';
import { compileRules } from '../src/compiler';
import { evaluate } from '../src/evaluator';
describe('NSML Domain Hooks', () => {
  it('should register and call chess hook with basic validation', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'e2-e4', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    expect(handler).toBeDefined();
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result.moves).toEqual(['e2-e4']);
  });
  it('should error on invalid chess move notation', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'invalid', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { error } = handler!(mockNode, context);
    expect(error?.message).toBe("Invalid algebraic move 'invalid'");
  });
  it('should validate legal pawn move', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'e2-e4', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result.fen).toContain('PPPPPPPP'); // Starting board
  });
  it('should validate legal knight move', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'b1-a3', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
  });
  it('should error on illegal knight move', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'b1-b3', validate: 'true' }, // Not a knight move
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { error } = handler!(mockNode, context);
    expect(error?.message).toMatch(/Illegal move/);
  });
  it('should execute moves and return new FEN', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'e2-e4', execute: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result.fen).toContain('4P3'); // After e2-e4
  });
  it('should query possible moves for pawn', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { queryPiece: 'e2' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result.queryResult).toContain('e3');
    expect(result.queryResult).toContain('e4'); // Double move
  });
  it('should query possible moves for knight', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { queryPiece: 'b1' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result.queryResult).toContain('a3');
    expect(result.queryResult).toContain('c3');
  });
  it('should allow custom registration', () => {
    const customType = 'custom';
    const handler = (node: AstNode, context: SymbolTable) => ({
      result: 'custom',
    });
    registerDomain(customType, handler);
    expect(domainRegistry.has('custom')).toBe(true);
    const result = domainRegistry.get('custom')!(
      { type: 'custom', attributes: {}, children: [], line: 1 },
      new Map()
    );
    expect(result.result).toBe('custom');
  });
  it('should integrate chess hook in full evaluation', () => {
    const input = `<nsml>
      <chess name="chessTest" moves="e2-e4,e7-e5" validate="true" execute="true" queryPiece="d2" />
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.results.chessTest.fen).toContain('rnbqkbnr/pppp1ppp/8/4p3/4P3');
    expect(result.results.chessTest.queryResult.length).toBeGreaterThan(0);
    expect(result.results.chessTest.queryResult).toContain('d3');
    expect(result.results.chessTest.queryResult).toContain('d4');
  });
});