// src/evaluator.ts - NSML Evaluation Engine

import { AstNode, SymbolTable, EvalResult, EvalError, ExprNode, SymbolEntry } from './types';
import { parseExpression, compileRules } from './compiler';
import { parseValue } from './resolver';

export function evaluate(ast: AstNode | null, symbols: SymbolTable, rules: Map<string, Function>): EvalResult {
  const results: Record<string, any> = {};
  const errors: EvalError[] = [];
  const trace: string[] = [];

  if (!ast) {
    errors.push({ type: 'runtime', message: 'Invalid AST' });
    return { results, errors, trace };
  }

  // Create value context from symbols
  const valueContext: Record<string, any> = {};
  for (const [k, v] of symbols) {
    valueContext[k] = v.value;
  }
  console.log('Initial valueContext:', valueContext);  // Debug: Log initial context

  // Get expression trees from compiler
  const { exprTrees } = compileRules(ast, symbols);

  // Handle imports (mock)
  function handleImport(node: AstNode) {
    const src = node.attributes.src;
    if (src) {
      trace.push(`Importing ${src}`);
    }
  }

  // Evaluate expression tree
  function evalTree(tree: ExprNode, context: Record<string, any>): any {
    console.log('Evaluating tree:', tree);  // Debug: Log tree being evaluated
    if (tree.value !== undefined) {
      const val = context[tree.value as string] !== undefined ? context[tree.value as string] : tree.value;
      console.log(`Value lookup for ${tree.value}:`, val);  // Debug: Log value lookups
      return val;
    }
    if (tree.func) {
      console.log('Evaluating func:', tree.func);  // Debug: Log function calls
      const args = tree.args?.map((a: ExprNode) => evalTree(a, context)) || [];
      console.log('Func args:', args);  // Debug: Log args
      if (tree.func === 'error') return `error: ${args[0]}`;
      if (tree.func === 'eval') {
        const ruleName = args[0] as string;
        console.log('Eval rule:', ruleName);  // Debug: Log eval calls
        const ruleTree = exprTrees.get(ruleName);
        if (ruleTree) return evalTree(ruleTree, context);  // Evaluate rule's tree with context
        return null;
      }
      return null;
    }
    const left = tree.left ? evalTree(tree.left, context) : undefined;
    const right = tree.right ? evalTree(tree.right, context) : undefined;
    console.log(`Op ${tree.op} with left: ${left}, right: ${right}`);  // Debug: Log op calculations
    switch (tree.op) {
      case '+': return Number(left) + Number(right);
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': return Number(left) / Number(right);
      case '>=': return Number(left) >= Number(right);
      case '!': return !right;
      case '=>': return !left || right;
      default: return null;
    }
  }

  // Process queries recursively
  function processQuery(node: AstNode, context: Record<string, any>) {
    if (node.type === 'counterfactual' || node.type === 'branch') {
      processBranch(node, context);
      return;
    }
    const name = node.attributes.name || 'anonymous';
    console.log(`Processing query ${name}`);  // Debug: Log query processing
    const expr = node.attributes.eval || node.text;
    console.log(`Query expr: ${expr}`);  // Debug: Log expr
    if (expr) {
      const tree = parseExpression(expr);
      console.log(`Parsed tree for ${name}:`, tree);  // Debug: Log parsed tree
      if (tree) {
        results[name] = evalTree(tree, context);
      } else {
        errors.push({ type: 'runtime', message: `Invalid expression in query '${name}'`, line: node.line });
      }
    }
    if (node.type === 'aggregate') {
      const func = node.attributes.func;
      const over = context[node.attributes.over];
      if (Array.isArray(over) || over instanceof Set) {
        const vals = Array.from(over).map(v => Number(v));
        if (func === 'count') results[name] = vals.length;
        if (func === 'sum') results[name] = vals.reduce((a, b) => a + b, 0);
      }
    }
    node.children.forEach(child => processQuery(child, context));
  }

  // Process assertions
  function processAssertion(node: AstNode, context: Record<string, any>) {
    const expr = node.text || '';
    console.log('Processing assertion:', expr);  // Debug: Log assertion
    const tree = parseExpression(expr);
    if (tree) {
      if (!evalTree(tree, context)) {
        errors.push({ type: 'runtime', message: `Assertion failed: ${expr}`, line: node.line });
      }
    } else {
      errors.push({ type: 'runtime', message: `Invalid assertion expression`, line: node.line });
    }
  }

  // Process branches/counterfactuals
  function processBranch(node: AstNode, context: Record<string, any>) {
    const ifStr = node.attributes.if;
    if (ifStr) {
      console.log('Processing branch with if:', ifStr);  // Debug: Log branch conditions
      const newContext = { ...context };
      ifStr.split(',').forEach(ass => {
        const [key, val] = ass.split('=').map(s => s.trim());
        const existingType = symbols.get(key)?.type || 'any';
        newContext[key] = parseValue(val, existingType);
        console.log(`Branch override: ${key} = ${newContext[key]}`);  // Debug: Log overrides
      });
      node.children.forEach(child => processQuery(child, newContext));
    }
  }

  // Simulate trace
  function processSimulate(node: AstNode) {
    const target = node.attributes.target;
    trace.push(`Evaluating ${target}: step1 eval...`);
  }

  // Traverse AST
  function traverse(node: AstNode, context: Record<string, any>) {
    console.log('Traversing node type:', node.type);  // Debug: Log traversal
    if (node.type === 'import') handleImport(node);
    if (node.type === 'queries') node.children.forEach(child => processQuery(child, context));
    if (node.type === 'assertions') node.children.forEach(child => processAssertion(child, context));
    if (node.type === 'counterfactual' || node.type === 'branch') processBranch(node, context);
    if (node.type === 'simulate') processSimulate(node);
    node.children.forEach(child => traverse(child, context));
  }

  traverse(ast, valueContext);

  return { results, errors, trace };
}