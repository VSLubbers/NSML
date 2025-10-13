import { evaluate } from '../src/evaluator';
import { compileRules } from '../src/compiler';
import { resolve } from '../src/resolver';
import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { EvalResult } from '../src/types';

describe('NSML Evaluator', () => {
  it('should evaluate simple query', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="42" />
      </symbols>
      <rules>
        <rule name="isAdult">age >= 18</rule>
      </rules>
      <queries>
        <query name="checkAdult">eval(isAdult)</query>
      </queries>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result: EvalResult = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(true);
  });

  it('should handle counterfactual branch', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="42" />
      </symbols>
      <rules>
        <rule name="isAdult">age >= 18</rule>
      </rules>
      <queries>
        <counterfactual if="age=17">
          <query name="checkAdult">eval(isAdult)</query>
        </counterfactual>
      </queries>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result: EvalResult = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(false);
  });

  it('should perform aggregate in query', () => {
    const input = `
    <nsml>
      <symbols>
        <set name="ages" elements="17,42,65" />
      </symbols>
      <queries>
        <aggregate func="count" over="ages" name="total" />
      </queries>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result: EvalResult = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.results.total).toBe(3);
  });

  it('should generate simulation trace', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="x" type="number" init="5" />
      </symbols>
      <queries>
        <query name="double">eval(x * 2)</query>
      </queries>
      <simulate steps="trace" target="double" />
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result: EvalResult = evaluate(ast, symbols, rules);
    expect(result.errors).toHaveLength(0);
    expect(result.trace?.length).toBeGreaterThan(0);
    expect(result.trace?.[0]).toMatch(/Evaluating/);
  });

  it('should handle errors and assertions', () => {
    const input = `
    <nsml>
      <symbols>
        <var name="x" type="number" init="0" />
      </symbols>
      <assertions>
        <assert>x > 0</assert>
      </assertions>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const { rules } = compileRules(ast, symbols);
    const result: EvalResult = evaluate(ast, symbols, rules);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Assertion failed/);
  });
});