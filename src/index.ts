// src/index.ts
// Entry point
import { lex } from './lexer';
import { parse } from './parser';
import { resolve } from './resolver';
import { evaluate } from './evaluator';
export async function parseNSML(input: string): Promise<any> {
  // Full pipeline: lex → parse → resolve → evaluate
  const tokens = lex(input);
  const { ast, errors: parseErrors } = parse(tokens);
  if (parseErrors.length > 0 || !ast) {
    return { results: {}, errors: parseErrors, trace: [] };
  }
  const { symbols, errors: resolveErrors } = resolve(ast);
  if (resolveErrors.length > 0) {
    return { results: {}, errors: resolveErrors, trace: [] };
  }
  return evaluate(ast, symbols);
}
export * from './lexer';
export * from './parser';
export * from './resolver';
export * from './compiler';
export * from './evaluator';
export * from './domains';
