import { lex } from '../src/lexer';
import { Token } from '../src/types';

describe('NSML Lexer', () => {
  it('should lex a simple opening tag', () => {
    const input = '<nsml version="1.0">';
    const tokens: Token[] = lex(input);
    expect(tokens).toHaveLength(3);  // openTag, attribute, eof
    expect(tokens[0]).toMatchObject({ type: 'openTag', value: 'nsml', line: 1 });
    expect(tokens[1]).toMatchObject({ type: 'attribute', value: 'version="1.0"' });
  });

  it('should lex a self-closing tag', () => {
    const input = '<var name="x" type="number" />';
    const tokens = lex(input);
    expect(tokens).toHaveLength(5);  // openTag, attr1, attr2, selfClose, eof
    expect(tokens[0]).toMatchObject({ type: 'openTag', value: 'var' });
    expect(tokens[1]).toMatchObject({ type: 'attribute', value: 'name="x"' });
    expect(tokens[2]).toMatchObject({ type: 'attribute', value: 'type="number"' });
    expect(tokens[3]).toMatchObject({ type: 'selfClose', value: '/' });
  });

  it('should lex closing tag and text content', () => {
    const input = '<rule>age > 18</rule>';
    const tokens = lex(input);
    expect(tokens).toHaveLength(4);  // openTag, text, closeTag, eof
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'age > 18' });
    expect(tokens[2]).toMatchObject({ type: 'closeTag', value: 'rule' });
  });

  it('should handle comments and escaped characters', () => {
    const input = '<!-- Comment &lt;test&gt; --> <tag attr="&quot;value&quot;">';
    const tokens = lex(input);
    expect(tokens).toHaveLength(4);  // comment, openTag, attribute, eof
    expect(tokens[0]).toMatchObject({ type: 'comment', value: ' Comment &lt;test&gt; ' });
    expect(tokens[2]).toMatchObject({ type: 'attribute', value: 'attr="&quot;value&quot;"' });
  });

  it('should lex a full minimal NSML document', () => {
    const input = `
    <nsml version="1.0">
      <symbols>
        <var name="age" type="number">42</var>
      </symbols>
    </nsml>
    `;
    const tokens = lex(input);
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens[tokens.length - 2]).toMatchObject({ type: 'closeTag', value: 'nsml' });
  });

  it('should handle errors gracefully', () => {
    const input = '<unclosed';
    expect(() => lex(input)).toThrow(/Unclosed tag/);  // Match actual error
  });
});