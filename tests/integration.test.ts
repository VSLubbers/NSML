import { parseNSML } from '../src/index';

describe('NSML Full Pipeline Integration', () => {
  it('should process invalid input with error', () => {
    const result = parseNSML('test input');
    expect(result).toEqual({
      results: {},
      errors: [{ type: 'syntax', message: 'Root must be <nsml>', line: 1 }],
      trace: [],
    });
  });

  it('should process valid NSML and return results', () => {
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
    const result = parseNSML(input);
    expect(result.errors).toHaveLength(0);
    expect(result.results.checkAdult).toBe(true);
  });
});
