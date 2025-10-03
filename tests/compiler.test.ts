import { compileRules } from '../src/compiler';
import { resolve } from '../src/resolver';
import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { ExprNode, EvalError } from '../src/types';

describe('NSML Rule Compiler', () => {
  it('should compile simple rule with expression', () => {
    const input = `
    <nsml>
      <rules>
        <rule name="isAdult">age >= 18</rule>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(rules.has('isAdult')).toBe(true);
    const tree = exprTrees.get('isAdult');
    expect(tree?.op).toBe('>=');
    expect(tree?.left?.value).toBe('age');
    expect(tree?.right?.value).toBe('18');
  });

  it('should compile constraint with operators', () => {
    const input = `
    <nsml>
      <rules>
        <constraint>!isAdult => error("Underage")</constraint>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(exprTrees.has('anonymous0')).toBe(true);  // Anonymous for constraints
    const tree = exprTrees.get('anonymous0');
    expect(tree?.op).toBe('=>');
    expect(tree?.left?.op).toBe('!');
  });

  it('should compile function with params', () => {
    const input = `
    <nsml>
      <rules>
        <function name="add" params="a:number,b:number" return="number">a + b</function>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules, exprTrees, errors } = compileRules(ast, symbols);
    expect(errors).toHaveLength(0);
    expect(rules.has('add')).toBe(true);
    const func = rules.get('add')!;  // Assert non-null for test
    expect(func(2, 3)).toBe(5);
  });

  it('should handle invalid expressions', () => {
    const input = `
    <nsml>
      <rules>
        <rule name="bad">age +</rule>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { errors } = compileRules(ast, symbols);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/Invalid expression/);
  });
});