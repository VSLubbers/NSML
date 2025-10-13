import { resolve } from '../src/resolver';
import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { SymbolTable, SymbolEntry, Graph, EvalError } from '../src/types';
describe('NSML Symbol Resolver', () => {
  it('should resolve variables and constants', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="42" />
        <const name="threshold" type="number" value="18" />
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(ast).not.toBeNull();
    const { symbols, errors } = resolve(ast);
    expect(errors).toHaveLength(0);
    expect(symbols.size).toBe(2);
    expect(symbols.get('age')).toMatchObject({
      kind: 'var',
      type: 'number',
      value: 42,
      mutable: true,
    });
    expect(symbols.get('threshold')).toMatchObject({
      kind: 'const',
      type: 'number',
      value: 18,
      mutable: false,
    });
  });
  it('should resolve sets and graphs', () => {
    const input = `
    <nsml>
      <symbols>
        <set name="evens" elements="2,4,6" />
        <graph name="family" nodes="Alice,Bob" edges="Alice->parentOf->Bob" />
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(ast).not.toBeNull();
    const { symbols, errors } = resolve(ast);
    expect(errors).toHaveLength(0);
    expect(symbols.get('evens')?.value).toEqual(new Set(['2', '4', '6']));
    const graph: Graph = symbols.get('family')?.value;
    expect(graph.nodes).toEqual(new Set(['Alice', 'Bob']));
    expect(graph.edges.get('Alice')?.get('parentOf')).toBe('Bob');
  });
  it('should resolve entities with props', () => {
    const input = `
    <nsml>
      <symbols>
        <entity name="person" props="name='Alice', age='42'" />
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(ast).not.toBeNull();
    const { symbols, errors } = resolve(ast);
    expect(errors).toHaveLength(0);
    expect(symbols.get('person')?.value).toEqual({ name: 'Alice', age: '42' });
  });
  it('should handle duplicates', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="42" />
        <var name="age" type="string" init="forty-two" />
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(ast).not.toBeNull();
    const { symbols, errors } = resolve(ast);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toMatch(/Duplicate symbol/);
    expect(symbols.size).toBe(1);
  });
  it('should handle type errors', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="forty-two" />
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(ast).not.toBeNull();
    const { symbols, errors } = resolve(ast);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toMatch(/Type mismatch/);
    expect(symbols.size).toBe(1);
  });
});
