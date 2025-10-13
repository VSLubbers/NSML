import { domainRegistry, registerDomain } from '../src/domains';
import { AstNode, SymbolTable } from '../src/types';
import { lex } from '../src/lexer';
import { parse } from '../src/parser';
import { resolve } from '../src/resolver';
import { compileRules } from '../src/compiler';
import { evaluate } from '../src/evaluator';

describe('NSML Domain Hooks', () => {
  it('should register and call chess hook', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { board: 'e4,e5', moves: 'e2-e4', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    expect(handler).toBeDefined();
    const { result, error } = handler!(mockNode, context);
    expect(error).toBeUndefined();
    expect(result).toEqual({ board: ['e4', 'e5'], moves: ['e2-e4'] });
  });

  it('should error on invalid chess move', () => {
    const mockNode: AstNode = {
      type: 'chess',
      attributes: { moves: 'invalid', validate: 'true' },
      children: [],
      line: 1,
    };
    const context = new Map() as SymbolTable;
    const handler = domainRegistry.get('chess');
    const { error } = handler!(mockNode, context);
    expect(error?.message).toBe('Invalid chess move');
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
      <chess name="chessTest" board="e4,e5" moves="e2-e4" validate="true" />
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.results.chessTest).toEqual({
      board: ['e4', 'e5'],
      moves: ['e2-e4'],
    });
  });
});
