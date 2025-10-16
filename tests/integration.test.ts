import { parseNSML } from '../src/index';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('path');

describe('NSML Full Pipeline Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process invalid input with error', async () => {
    const result = await parseNSML('test input');
    expect(result).toEqual({
      results: {},
      errors: [{ type: 'syntax', message: 'Root must be <nsml>', line: 1 }],
      trace: [],
    });
  });

  it('should process valid NSML and return results', async () => {
    const input = `<nsml>
      <symbols>
        <var name="age" type="number" init="42" />
      </symbols>
      <rules>
        <rule name="isAdult">age >= 18</rule>
      </rules>
      <queries>
        <query name="checkAdult">eval(isAdult)</query>
      </queries>
    </nsml>`;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(true);
  });

  // New tests for imports in full pipeline
  it('should handle import in full pipeline and merge symbols', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="importedAge" type="number" init="30" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `<nsml>
      <import src="imported.nsml" />
      <rules>
        <rule name="isAdult">importedAge >= 18</rule>
      </rules>
      <queries>
        <query name="checkImportedAdult">eval(isAdult)</query>
      </queries>
    </nsml>`;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkImportedAdult).toBe(true);
  });

  it('should error on symbol conflict in import without alias', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="age" type="number" init="30" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `<nsml>
      <symbols>
        <var name="age" type="number" init="42" />
      </symbols>
      <import src="imported.nsml" />
    </nsml>`;
    const result = await parseNSML(input);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Symbol conflict/);
  });

  it('should handle aliased import to avoid conflicts', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="age" type="number" init="30" />
        </symbols>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `<nsml>
      <symbols>
        <var name="age" type="number" init="42" />
      </symbols>
      <import src="imported.nsml" as="imp" />
      <queries>
        <query name="checkBoth">age + imp.age</query>
      </queries>
    </nsml>`;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkBoth).toBe(72);
  });

  it('should execute full scope import including queries', async () => {
    const importedContent = `
      <nsml>
        <symbols>
          <var name="val" type="number" init="5" />
        </symbols>
        <queries>
          <query name="impDouble">val * 2</query>
        </queries>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/imported.nsml');

    const input = `<nsml>
      <import src="imported.nsml" scope="full" />
    </nsml>`;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.impDouble).toBe(10);
  });

  it('should import and use math.nsml utilities', async () => {
    const importedContent = `
      <nsml version="1.0">
        <symbols>
          <const name="PI" type="number" value="3.141592653589793" />
          <set name="primesUnder20" elements="2,3,5,7,11,13,17,19" />
        </symbols>
        <rules>
          <function name="add" params="a:number,b:number" return="number">a + b</function>
        </rules>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/math.nsml');

    const input = `
      <nsml>
        <import src="math.nsml" />
        <symbols>
          <var name="r" type="number" init="2" />
        </symbols>
        <queries>
          <query name="useMath">PI * r * r</query>
          <query name="useAdd">eval(add(5, 3))</query>
        </queries>
      </nsml>
    `;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.useMath).toBeCloseTo(12.566, 3); // PI * 2^2
    expect(result.results.useAdd).toBe(8);
  });

  it('should import math.nsml with full scope', async () => {
    const importedContent = `
      <nsml version="1.0">
        <symbols>
          <const name="PI" type="number" value="3.141592653589793" />
        </symbols>
        <queries>
          <query name="circleArea">PI * 2 * 2</query>
        </queries>
      </nsml>
    `;
    (fs.readFile as jest.Mock).mockResolvedValue(importedContent);
    (path.resolve as jest.Mock).mockReturnValue('/mock/path/math.nsml');

    const input = `
      <nsml>
        <import src="math.nsml" scope="full" />
      </nsml>
    `;
    const result = await parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.circleArea).toBeCloseTo(12.566, 3);
  });
});
