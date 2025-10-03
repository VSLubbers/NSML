import { AstNode, SymbolTable, SymbolEntry, Graph, ExprNode, Operator, EvalResult } from '../src/types';

describe('Core Data Structures', () => {
  it('should instantiate AstNode correctly', () => {
    const node: AstNode = {
      type: 'var',
      attributes: { name: 'x', type: 'number' },
      children: [],
      line: 1,
    };
    expect(node.type).toBe('var');
    expect(node.attributes.name).toBe('x');
  });

  it('should instantiate SymbolTable and SymbolEntry', () => {
    const table: SymbolTable = new Map();
    const entry: SymbolEntry = {
      kind: 'var',
      type: 'number',
      value: 42,
      mutable: true,
    };
    table.set('x', entry);
    expect(table.get('x')?.value).toBe(42);
  });

  it('should instantiate Graph', () => {
    const graph: Graph = {
      nodes: new Set(['A', 'B']),
      edges: new Map([['A', new Map([['to', 'B']])]]),
    };
    expect(graph.nodes.has('A')).toBe(true);
  });

  it('should instantiate ExprNode with Operator', () => {
    const expr: ExprNode = {
      op: '==',
      left: { value: 'x' },
      right: { value: 42 },
    };
    expect(expr.op).toBe('==');
  });

  it('should instantiate EvalResult', () => {
    const result: EvalResult = {
      results: { query1: true },
      errors: [{ type: 'syntax', message: 'Test error' }],
    };
    expect(result.results.query1).toBe(true);
  });
});