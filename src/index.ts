// Entry point
import { lex } from './lexer';
import { parse } from './parser';
import { resolve } from './resolver';
import { compileRules } from './compiler';
import { evaluate } from './evaluator';

export function parseNSML(input: string): any {
  // Full pipeline: lex → parse → resolve → compile → evaluate
  const tokens = lex(input);
  const { ast, errors: parseErrors } = parse(tokens);
  if (parseErrors.length > 0 || !ast) {
    return { results: {}, errors: parseErrors, trace: [] };
  }
  const { symbols, errors: resolveErrors } = resolve(ast);
  if (resolveErrors.length > 0) {
    return { results: {}, errors: resolveErrors, trace: [] };
  }
  const { rules, errors: compileErrors } = compileRules(ast, symbols);
  if (compileErrors.length > 0) {
    return { results: {}, errors: compileErrors, trace: [] };
  }
  return evaluate(ast, symbols, rules);
}

export * from './lexer';
export * from './parser';
export * from './resolver';
export * from './compiler';
export * from './evaluator';
export * from './domains';
