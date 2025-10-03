// src/lexer.ts - NSML Tokenizer

import { Token } from './types';

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  while (pos < input.length) {
    const char = input[pos];

    // Skip whitespace (NSML is whitespace-insensitive except in text/strings)
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

    // Comment: <!-- ... -->
    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4);
      if (end === -1) throw new Error(`Unclosed comment at line ${line}`);
      const value = input.slice(pos + 4, end);
      tokens.push({ type: 'comment', value: value, line: line, column: column });
      pos = end + 3;
      column += (end - (pos + 4)) + 7;  // Full span
      continue;
    }

    // Opening tag: <tag attrs> or <tag attrs />
    if (char === '<' && input[pos + 1] !== '/') {
      pos++; column++;
      const tagMatch = input.slice(pos).match(/^([\w:]+)([^>]*)/);
      if (!tagMatch) throw new Error(`Invalid tag at line ${line}`);
      const tagName = tagMatch[1];
      const attrsRaw = tagMatch[2];
      tokens.push({ type: 'openTag', value: tagName, line: line, column: column });

      pos += tagName.length;
      column += tagName.length;

      // Parse attributes and check for self-closing /
      let attrPos = 0;
      while (attrPos < attrsRaw.length) {
        const remaining = attrsRaw.slice(attrPos);
        const attrMatch = remaining.match(/^\s*(\w+)\s*=\s*("[^"]*")/);
        if (attrMatch) {
          const fullLength = attrMatch[0].length;
          const attr = `${attrMatch[1]}=${attrMatch[2]}`;
          tokens.push({ type: 'attribute', value: attr, line: line, column: column + attrPos });
          attrPos += fullLength;
        } else {
          const slashMatch = remaining.match(/^\s*\//);
          if (slashMatch) {
            const fullLength = slashMatch[0].length;
            const slashPos = fullLength - 1;  // Position of /
            tokens.push({ type: 'selfClose', value: '/', line: line, column: column + attrPos + slashPos });
            attrPos += fullLength;
          } else {
            attrPos++;  // Skip invalid chars
          }
        }
      }

      pos += attrsRaw.length;
      column += attrsRaw.length;

      // Expect >
      if (input[pos] === '>') {
        pos++;
        column++;
      } else {
        throw new Error(`Unclosed tag at line ${line}`);
      }
      continue;
    }

    // Closing tag: </tag>
    if (input.startsWith('</', pos)) {
      pos += 2; column += 2;
      const closeMatch = input.slice(pos).match(/^([\w:]+)>/);
      if (!closeMatch) throw new Error(`Invalid closing tag at line ${line}`);
      const tagName = closeMatch[1];
      tokens.push({ type: 'closeTag', value: tagName, line: line, column: column });
      pos += tagName.length + 1;
      column += tagName.length + 1;
      continue;
    }

    // Text content or expressions (including operators)
    const textMatch = input.slice(pos).match(/^[^<]+/);
    if (textMatch) {
      const value = textMatch[0];
      tokens.push({ type: 'text', value: value, line: line, column: column });
      pos += value.length;
      column += value.length;
      continue;
    }

    // If unmatched, error
    throw new Error(`Unexpected character '${char}' at line ${line}, column ${column}`);
  }

  // Add EOF token
  tokens.push({ type: 'eof', value: '', line: line, column: column });

  return tokens;
}