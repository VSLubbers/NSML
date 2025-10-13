import { parse } from '../src/parser';
import { lex } from '../src/lexer';
import { AstNode, EvalError } from '../src/types';

describe('NSML Parser', () => {
  it('should parse a simple opening tag with attribute', () => {
    const input = '<nsml version="1.0"></nsml>';
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(ast?.type).toBe('nsml');
    expect(ast?.attributes.version).toBe('1.0');
    expect(ast?.children).toHaveLength(0);
  });

  it('should parse a self-closing tag with attributes', () => {
    const input = '<nsml><var name="x" type="number" /></nsml>';
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(ast?.children[0]?.type).toBe('var');
    expect(ast?.children[0]?.attributes.name).toBe('x');
    expect(ast?.children[0]?.attributes.type).toBe('number');
    expect(ast?.children[0]?.children).toHaveLength(0);
  });

  it('should parse nested tags with text', () => {
    const input = '<nsml><rule name="even">x % 2 == 0</rule></nsml>';
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(ast?.children[0]?.type).toBe('rule');
    expect(ast?.children[0]?.attributes.name).toBe('even');
    expect(ast?.children[0]?.text).toBe('x % 2 == 0');
  });

  it('should parse a full minimal NSML document', () => {
    const input = `<nsml version="1.0">
      <symbols>
        <var name="age" type="number">42</var>
      </symbols>
    </nsml>`;
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(ast?.type).toBe('nsml');
    expect(ast?.children[0]?.type).toBe('symbols');
    expect(ast?.children[0]?.children[0]?.type).toBe('var');
    expect(ast?.children[0]?.children[0]?.text).toBe('42');
  });

  it('should collect errors for invalid structure', () => {
    const input = '<nsml><unclosed>';
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(ast).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.message.match(/Expected closing tag/))).toBe(
      true
    );
  });

  it('should enforce root nsml', () => {
    const input = '<symbols></symbols>';
    const tokens = lex(input);
    const { ast, errors } = parse(tokens);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Root must be <nsml>');
  });
});
