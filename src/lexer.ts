// src/lexer.ts - NSML Tokenizer
import { Token } from './types';
export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;
  while (pos < input.length) {
    const char = input[pos];
    // Skip whitespace
    if (/\s/.test(char)) {
      if (char === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      pos++;
      continue;
    }
    // Comment
    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4);
      if (end === -1) throw new Error(`Unclosed comment at line ${line}`);
      const value = input.slice(pos + 4, end);
      tokens.push({
        type: 'comment',
        value: value,
        line: line,
        column: column,
      });
      pos = end + 3;
      column += end - pos + 3;
      continue;
    }
    // Opening tag
    if (char === '<' && input[pos + 1] !== '/') {
      pos++;
      column++;
      // Tag name
      let tagName = '';
      while (pos < input.length && /[\w:]/.test(input[pos])) {
        tagName += input[pos];
        pos++;
        column++;
      }
      tokens.push({
        type: 'openTag',
        value: tagName,
        line: line,
        column: column - tagName.length,
      });
      // Attributes
      while (pos < input.length && input[pos] !== '/' && input[pos] !== '>') {
        // Skip space
        if (/\s/.test(input[pos])) {
          pos++;
          column++;
          continue;
        }
        // Key
        let key = '';
        while (
          pos < input.length &&
          input[pos] !== '=' &&
          !/\s/.test(input[pos])
        ) {
          key += input[pos];
          pos++;
          column++;
        }
        // Skip space, =
        while (
          pos < input.length &&
          (/\s/.test(input[pos]) || input[pos] === '=')
        ) {
          pos++;
          column++;
        }
        // Value quote
        const quote = input[pos];
        if (quote !== '"' && quote !== "'") {
          throw new Error(`Expected quote at line ${line}, column ${column}`);
        }
        pos++;
        column++;
        // Value
        let value = '';
        while (pos < input.length && input[pos] !== quote) {
          value += input[pos];
          pos++;
          column++;
        }
        if (input[pos] === quote) {
          pos++;
          column++;
        } else {
          throw new Error(`Unclosed quote at line ${line}`);
        }
        tokens.push({
          type: 'attribute',
          value: `${key}="${value}"`,
          line: line,
          column: column - value.length - key.length - 3,
        });
      }
      // Self-closing
      if (input[pos] === '/') {
        tokens.push({
          type: 'selfClose',
          value: '/',
          line: line,
          column: column,
        });
        pos++;
        column++;
      }
      // >
      if (input[pos] === '>') {
        pos++;
        column++;
      } else {
        throw new Error(`Unclosed tag at line ${line}`);
      }
      continue;
    }
    // Closing tag
    if (input.startsWith('</', pos)) {
      pos += 2;
      column += 2;
      let tagName = '';
      while (pos < input.length && /[\w:]/.test(input[pos])) {
        tagName += input[pos];
        pos++;
        column++;
      }
      if (input[pos] === '>') {
        pos++;
        column++;
      } else {
        throw new Error(`Invalid closing tag at line ${line}`);
      }
      tokens.push({
        type: 'closeTag',
        value: tagName,
        line: line,
        column: column - tagName.length,
      });
      continue;
    }
    // Text (updated to handle literal < if not a valid tag start)
    let value = '';
    while (pos < input.length) {
      if (input[pos] === '<') {
        // Check if it's a valid tag start (opening or closing)
        if (
          pos + 1 < input.length &&
          (/[\w:]/.test(input[pos + 1]) || input[pos + 1] === '/')
        ) {
          // Valid tag, break for text
          break;
        } else {
          // Literal <, append to text
          value += input[pos];
          pos++;
          column++;
          continue;
        }
      }
      value += input[pos];
      pos++;
      column++;
    }
    if (value) {
      tokens.push({
        type: 'text',
        value,
        line: line,
        column: column - value.length,
      });
      continue;
    }
    throw new Error(
      `Unexpected character '${char}' at line ${line}, column ${column}`
    );
  }
  tokens.push({ type: 'eof', value: '', line: line, column: column });
  return tokens;
}
