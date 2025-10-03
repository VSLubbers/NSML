// src/parser.ts - NSML Recursive Descent Parser

import { Token } from './types';
import { AstNode, EvalError } from './types';

interface ParseResult {
  ast: AstNode | null;
  errors: EvalError[];
}

class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private errors: EvalError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens.filter(t => t.type !== 'comment' && t.type !== 'eof');  // Ignore comments/eof
  }

  parse(): ParseResult {
    if (this.peek()?.type !== 'openTag' || this.peek()?.value !== 'nsml') {
      this.errors.push({ type: 'syntax', message: 'Root must be <nsml>', line: this.peek()?.line });
      return { ast: null, errors: this.errors };
    }
    const root = this.parseElement();
    if (this.pos < this.tokens.length) {
      this.errors.push({ type: 'syntax', message: 'Extra content after root', line: this.tokens[this.pos].line });
    }
    // Fix: Null ast if any errors occurred during parsing
    if (this.errors.length > 0) {
      return { ast: null, errors: this.errors };
    }
    return { ast: root, errors: this.errors };
  }

  private parseElement(): AstNode | null {
    if (this.peek()?.type !== 'openTag') {
      this.errors.push({ type: 'syntax', message: 'Expected opening tag', line: this.peek()?.line });
      return null;
    }

    const open = this.consume('openTag');
    const node: AstNode = {
      type: open.value,
      attributes: {},
      children: [],
      line: open.line,
    };

    // Parse attributes
    while (this.peek()?.type === 'attribute') {
      const attr = this.consume('attribute');
      const [key, val] = attr.value.split('=');
      node.attributes[key] = val?.slice(1, -1) || '';  // Strip quotes
    }

    // Self-closing
    if (this.peek()?.type === 'selfClose') {
      this.consume('selfClose');
      return node;
    }

    // Text or children
    while (this.peek() && this.peek()?.type !== 'closeTag') {
      if (this.peek()?.type === 'text') {
        const text = this.consume('text');
        node.text = (node.text || '') + text.value.trim();  // Trim for cleanliness
      } else if (this.peek()?.type === 'openTag') {
        const child = this.parseElement();
        if (child) node.children.push(child);
      } else {
        this.errors.push({ type: 'syntax', message: 'Unexpected token', line: this.peek()?.line });
        this.pos++;  // Skip invalid
      }
    }

    // Closing tag
    const close = this.peek();
    if (close?.type === 'closeTag' && close.value === node.type) {
      this.consume('closeTag');
    } else {
      this.errors.push({ type: 'syntax', message: `Expected closing tag for ${node.type}`, line: close?.line || node.line });
    }

    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(expectedType: Token['type']): Token {
    const token = this.peek();
    if (token?.type === expectedType) {
      this.pos++;
      return token;
    }
    this.errors.push({ type: 'syntax', message: `Expected ${expectedType}, got ${token?.type || 'undefined'}`, line: token?.line || 1 });
    return { type: expectedType, value: '', line: token?.line || 1, column: token?.column || 1 };  // Dummy
  }
}

export function parse(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  return parser.parse();
}