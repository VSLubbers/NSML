import { compileRules, parseExpression, evalExpr } from '../src/compiler';
import { resolve } from '../src/resolver';
import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { ExprNode, EvalError, SymbolTable, Graph } from '../src/types';

describe('NSML Rule Compiler', () => {
  it('should compile simple rule with expression', () => {
    const input = `<nsml>
      <rules>
        <rule name="isAdult">age >= 18</rule>
      </rules>
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(rules.has('isAdult')).toBe(true);
    const tree = exprTrees.get('isAdult');
    expect(tree?.op).toBe('>=');
    expect(tree?.left?.value).toBe('age');
    expect(tree?.right?.value).toBe(18);
  });

  it('should compile constraint with operators', () => {
    const input = `<nsml>
      <rules>
        <constraint>!isAdult => error("Underage")</constraint>
      </rules>
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(exprTrees.has('anonymous0')).toBe(true);
    const tree = exprTrees.get('anonymous0');
    expect(tree?.op).toBe('=>');
    expect(tree?.left?.op).toBe('!');
  });

  it('should compile function with params', () => {
    const input = `<nsml>
      <rules>
        <function name="add" params="a:number,b:number" return="number">a + b</function>
      </rules>
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(rules.has('add')).toBe(true);
    const func = rules.get('add')!;
    expect(func(2, 3)).toBe(5);
  });

  it('should handle invalid expressions', () => {
    const input = `<nsml>
      <rules>
        <rule name="bad">age +</rule>
      </rules>
    </nsml>`;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { errors } = compileRules(ast, symbols);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Invalid expression/);
  });

  it('should parse and evaluate set operations', () => {
    const exprStr = 'set1 union set2 intersect set3 diff set4';
    const tree = parseExpression(exprStr);
    expect(tree).not.toBeNull();
    expect(tree?.op).toBe('diff');
    expect(tree?.left?.op).toBe('intersect');
    expect(tree?.left?.left?.op).toBe('union');
    expect(tree?.left?.left?.left?.value).toBe('set1');
    expect(tree?.left?.left?.right?.value).toBe('set2');
    expect(tree?.left?.right?.value).toBe('set3');
    expect(tree?.right?.value).toBe('set4');

    const context = {
      set1: new Set([1, 2]),
      set2: new Set([2, 3]),
      set3: new Set([2, 4]),
      set4: new Set([4]),
    };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(errors).toHaveLength(0);
    expect(result).toEqual(new Set([2]));
  });

  it('should parse and evaluate in operator', () => {
    const exprStr = '2 in set1';
    const tree = parseExpression(exprStr);
    expect(tree?.op).toBe('in');
    expect(tree?.left?.value).toBe(2);
    expect(tree?.right?.value).toBe('set1');

    const context = { set1: new Set([1, 2, 3]) };
    const errors: EvalError[] = [];
    expect(evalExpr(tree!, context, errors, 1)).toBe(true);
    expect(errors).toHaveLength(0);

    const context2 = { set1: new Set([4, 5]) };
    expect(evalExpr(tree!, context2, errors, 1)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('should parse and evaluate path function', () => {
    const exprStr = 'path(graph, "A", "C")';
    const tree = parseExpression(exprStr);
    expect(tree?.func).toBe('path');
    expect(tree?.args?.[0]?.value).toBe('graph');
    expect(tree?.args?.[1]?.value).toBe('A');
    expect(tree?.args?.[2]?.value).toBe('C');

    const graph: Graph = {
      nodes: new Set(['A', 'B', 'C']),
      edges: new Map([
        ['A', new Map([['to', 'B']])],
        ['B', new Map([['to', 'C']])],
      ]),
    };
    const context = { graph };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(errors).toHaveLength(0);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('should return null for no path', () => {
    const exprStr = 'path(graph, "A", "D")';
    const tree = parseExpression(exprStr);
    const graph: Graph = {
      nodes: new Set(['A', 'B', 'C']),
      edges: new Map([
        ['A', new Map([['to', 'B']])],
        ['B', new Map([['to', 'C']])],
      ]),
    };
    const context = { graph };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(result).toBeNull();
    expect(errors).toHaveLength(0);
  });

  it('should parse and evaluate iff operator', () => {
    const exprStr = 'true <=> false';
    const tree = parseExpression(exprStr);
    expect(tree?.op).toBe('<=>');
    const errors: EvalError[] = [];
    expect(evalExpr(tree!, {}, errors, 1)).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('should parse and evaluate unary minus', () => {
    const exprStr = '-x + 5';
    const tree = parseExpression(exprStr);
    expect(tree?.op).toBe('+');
    expect(tree?.left?.op).toBe('-');
    expect(tree?.left?.right?.value).toBe('x');
    const errors: EvalError[] = [];
    expect(evalExpr(tree!, { x: 3 }, errors, 1)).toBe(2);
    expect(errors).toHaveLength(0);
  });

  it('should handle invalid set operation arguments', () => {
    const exprStr = 'set1 union x';
    const tree = parseExpression(exprStr);
    const context = { set1: new Set([1, 2]), x: 42 };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Operands of "union" must be sets/);
  });

  it('should handle invalid in operation arguments', () => {
    const exprStr = '2 in x';
    const tree = parseExpression(exprStr);
    const context = { x: 42 };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(result).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Right operand of "in" must be a set or array/);
  });

  it('should handle invalid path function arguments', () => {
    const exprStr = 'path(graph, "A")';
    const tree = parseExpression(exprStr);
    const graph: Graph = {
      nodes: new Set(['A', 'B']),
      edges: new Map([['A', new Map([['to', 'B']])]]),
    };
    const context = { graph };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/path function requires 3 arguments/);
  });

  it('should handle operator precedence correctly', () => {
    const exprStr = 'x + y * z union set1';
    const tree = parseExpression(exprStr);
    expect(tree?.op).toBe('union');
    expect(tree?.left?.op).toBe('+');
    expect(tree?.left?.right?.op).toBe('*');
    expect(tree?.left?.right?.left?.value).toBe('y');
    expect(tree?.left?.right?.right?.value).toBe('z');
    expect(tree?.left?.left?.value).toBe('x');
    expect(tree?.right?.value).toBe('set1');

    const context = { x: 1, y: 2, z: 3, set1: new Set([7]) };
    const errors: EvalError[] = [];
    const result = evalExpr(tree!, context, errors, 1);
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Operands of "union" must be sets/);
  });
});