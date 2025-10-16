// tests/evaluator.test.ts
import { evaluate } from '../src/evaluator';
import { resolve } from '../src/resolver';
import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { EvalResult } from '../src/types';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('path');

describe('NSML Evaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should evaluate simple query', async () => {
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
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(true);
  });

  it('should handle counterfactual branch', async () => {
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
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(false);
  });

  it('should perform aggregate in query', async () => {
    const input = `
    <nsml>
      <symbols>
        <set name="ages" elements="17,42,65" />
      </symbols>
      <queries>
        <aggregate func="count" over="ages" name="total" />
        <aggregate func="min" over="ages" name="minAge" />
        <aggregate func="max" over="ages" name="maxAge" />
        <aggregate func="avg" over="ages" name="avgAge" />
      </queries>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.total).toBe(3);
    expect(result.results.minAge).toBe(17);
    expect(result.results.maxAge).toBe(65);
    expect(result.results.avgAge).toBeCloseTo(41.333, 3);
  });

  it('should handle quantifiers in query', async () => {
    const input = `
    <nsml>
      <symbols>
        <set name="ages" elements="17,42,65" />
        <const name="threshold" type="number" value="18" />
      </symbols>
      <queries>
        <exists name="hasAdult" in="ages" condition="item > threshold" />
        <exists name="hasAdultCount" in="ages" condition="item > threshold" count="true" />
        <forall name="allAdult" in="ages" condition="item > threshold" />
      </queries>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.hasAdult).toBe(true);
    expect(result.results.hasAdultCount).toEqual({ result: true, count: 2 });
    expect(result.results.allAdult).toBe(false);
  });

  it('should handle constraints', async () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="15" />
        <const name="adultThreshold" type="number" value="18" />
      </symbols>
      <rules>
        <constraint>age < adultThreshold => error("Underage")</constraint>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toBe('Underage');
  });

  it('should pass valid constraints without errors', async () => {
    const input = `
    <nsml>
      <symbols>
        <var name="age" type="number" init="20" />
        <const name="adultThreshold" type="number" value="18" />
      </symbols>
      <rules>
        <constraint>age < adultThreshold => error("Underage")</constraint>
      </rules>
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
  });

  it('should generate simulation trace', async () => {
    const input = `
    <nsml>
      <symbols>
        <var name="x" type="number" init="5" />
      </symbols>
      <queries>
        <query name="double">x * 2</query>
      </queries>
      <simulate steps="trace" target="double" />
    </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.trace?.length).toBeGreaterThan(0);
    expect(result.trace?.[0]).toMatch(/Evaluating/);
  });

  it('should handle errors and assertions', async () => {
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
    const result: EvalResult = await evaluate(ast, symbols);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Assertion failed/);
  });

  // New tests for imports
  it('should handle simple import and merge symbols', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="importedVar" type="number" init="100" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `
      <nsml>
        <import src="imported.nsml" />
        <queries>
          <query name="checkImported">importedVar + 1</query>
        </queries>
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkImported).toBe(101);
  });

  it('should handle import with alias and namespace symbols', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="var" type="number" init="50" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `
      <nsml>
        <import src="imported.nsml" as="imp" />
        <queries>
          <query name="checkNamespaced">imp.var * 2</query>
        </queries>
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkNamespaced).toBe(100);
  });

  it('should error on import cycle', async () => {
    const importedContent = `
      <nsml>
        <import src="main.nsml" />
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockImplementation((_, file) =>
      file === 'imported.nsml' ? '/mock/imported' : '/mock/main'
    );

    const input = `
      <nsml>
        <import src="imported.nsml" />
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Cycle detected/);
  });

  it('should error on missing import file', async () => {
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

    const input = `
      <nsml>
        <import src="nonexistent.nsml" />
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Failed to read file/);
  });

  it('should handle import with full scope and execute queries', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="impVal" type="number" init="200" />
        </symbols>
        <queries>
          <query name="impQuery">impVal / 2</query>
        </queries>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `
      <nsml>
        <import src="imported.nsml" scope="full" />
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.impQuery).toBe(100);
  });

  it('should handle recursive imports without cycles', async () => {
    const imported1 = `
      <nsml>
        <import src="imported2.nsml" />
        <symbols>
          <var name="val1" type="number" init="10" />
        </symbols>
      </nsml>
    `;
    const imported2 = `
      <nsml>
        <symbols>
          <var name="val2" type="number" init="20" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockImplementation(async (p) => {
      if (p.includes('imported1')) return imported1;
      if (p.includes('imported2')) return imported2;
    });
    (path.resolve as jest.Mock).mockImplementation((_, file) => file);

    const input = `
      <nsml>
        <import src="imported1.nsml" />
        <queries>
          <query name="sum">val1 + val2</query>
        </queries>
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.sum).toBe(30);
  });

  it('should trace imports and mergers', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="traced" type="number" init="1" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `
      <nsml>
        <import src="imported.nsml" />
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.trace).toContain(
      'Merged symbols and rules from imported.nsml'
    );
  });

  it('should handle domain hooks in imported files', async () => {
    const importedContent = `
      <nsml>
        <math name="impMath" expression="2 + 2" />
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `
      <nsml>
        <import src="imported.nsml" scope="full" />
      </nsml>
    `;
    const tokens = lex(input);
    const { ast } = parse(tokens);
    const { symbols } = resolve(ast);
    const result = await evaluate(ast, symbols);
    expect(result.errors).toHaveLength(0);
    expect(result.results.impMath).toBe(4);
  });
});
