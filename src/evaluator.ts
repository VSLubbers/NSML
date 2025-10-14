// src/evaluator.ts - NSML Evaluation Engine
import { AstNode, SymbolTable, EvalResult, EvalError, ExprNode, SymbolEntry, DomainRegistry } from './types';
import { parseExpression, compileRules } from './compiler';
import { parseValue } from './resolver';
import { domainRegistry } from './domains';

export function evaluate(ast: AstNode | null, symbols: SymbolTable, rules: Map<string, Function>): EvalResult {
  const results: Record<string, any> = {};
  const errors: EvalError[] = [];
  const trace: string[] = [];

  if (!ast) {
    errors.push({ type: 'runtime', message: 'Invalid AST', suggestedFix: 'Verify input and parsing' });
    return { results, errors, trace };
  }

  // Create value context from symbols
  const valueContext: Record<string, any> = {};
  for (const [k, v] of symbols) {
    valueContext[k] = v.value;
  }

  // Get expression trees from compiler
  const { exprTrees } = compileRules(ast, symbols);

  // Handle imports (placeholder updated: log for now, full impl in extensions)
  function handleImport(node: AstNode) {
    const src = node.attributes.src;
    if (src) {
      trace.push(`Importing ${src} (full loading not implemented yet)`);
      // TODO: Recursively fetch/parse/merge - requires file system access
    } else {
      errors.push({ type: 'semantic', message: 'Missing src for import', line: node.line, suggestedFix: 'Add src="path/to/file.nsml"' });
    }
  }

  // Handle domain-specific tags
  function handleDomain(node: AstNode, context: SymbolTable) {
    const handler = domainRegistry.get(node.type);
    if (handler) {
      trace.push(`Evaluating domain tag ${node.type}`);
      const { result, error } = handler(node, context);
      if (error) {
        errors.push(error);
      } else {
        const name = node.attributes.name || `domain_${node.type}`;
        results[name] = result;
      }
    } else {
      errors.push({ type: 'semantic', message: `Unknown domain tag '${node.type}'`, line: node.line, suggestedFix: 'Register custom handler or use core tags' });
    }
  }

  // Evaluate expression tree
  function evalTree(tree: ExprNode, context: Record<string, any>): any {
    if (tree.value !== undefined) {
      const val = context[tree.value as string] !== undefined ? context[tree.value as string] : tree.value;
      return val;
    }

    if (tree.func) {
      const args = tree.args?.map((a: ExprNode) => evalTree(a, context)) || [];
      if (tree.func === 'error') return `error: ${args[0]}`;
      if (tree.func === 'eval') {
        const ruleName = args[0] as string;
        const ruleTree = exprTrees.get(ruleName);
        if (ruleTree) return evalTree(ruleTree, context); // Evaluate rule's tree with context
        return null;
      }
      return null;
    }

    const left = tree.left ? evalTree(tree.left, context) : undefined;
    const right = tree.right ? evalTree(tree.right, context) : undefined;

    switch (tree.op) {
      case '+': return Number(left) + Number(right);
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': return Number(left) / Number(right);
      case '%': return Number(left) % Number(right);
      case '^': return Math.pow(Number(left), Number(right));
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
      case '==': return left === right;
      case '!=': return left !== right;
      case '!': return !right;
      case '&&': return left && right;
      case '||': return left || right;
      case '=>': return !left || right;
      case '<=>': return (left && right) || (!left && !right);
      case 'in':
        if (right instanceof Set) return right.has(left);
        if (Array.isArray(right)) return right.includes(left);
        return false;
      // Basic set ops (extend as needed)
      case 'union':
        if (left instanceof Set && right instanceof Set) return new Set([...left, ...right]);
        return null;
      case 'intersect':
        if (left instanceof Set && right instanceof Set) return new Set([...left].filter(x => right.has(x)));
        return null;
      case 'diff':
        if (left instanceof Set && right instanceof Set) return new Set([...left].filter(x => !right.has(x)));
        return null;
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
    const expr = node.attributes.eval || node.text;
    if (expr) {
      const tree = parseExpression(expr);
      if (tree) {
        results[name] = evalTree(tree, context);
      } else {
        errors.push({ type: 'runtime', message: `Invalid expression in query '${name}'`, line: node.line, suggestedFix: 'Check syntax of expression' });
      }
    }

    if (node.type === 'aggregate') {
      const func = node.attributes.func;
      const over = context[node.attributes.over];
      if (Array.isArray(over) || over instanceof Set) {
        const vals = Array.from(over).map(v => Number(v)).filter(v => !isNaN(v)); // Filter valid numbers
        if (vals.length === 0) {
          errors.push({ type: 'runtime', message: `No valid numbers in aggregate '${name}'`, line: node.line });
          return;
        }
        let aggResult: number | { count: number } | undefined;
        switch (func) {
          case 'count': aggResult = vals.length; break;
          case 'sum': aggResult = vals.reduce((a, b) => a + b, 0); break;
          case 'min': aggResult = Math.min(...vals); break;
          case 'max': aggResult = Math.max(...vals); break;
          case 'avg': aggResult = vals.reduce((a, b) => a + b, 0) / vals.length; break;
          default: errors.push({ type: 'semantic', message: `Unknown aggregate func '${func}'`, line: node.line }); return;
        }
        results[name] = aggResult;
      } else {
        errors.push({ type: 'runtime', message: `Invalid collection for aggregate '${name}'`, line: node.line });
      }
    }

    if (node.type === 'exists' || node.type === 'forall') {
      const collection = context[node.attributes.in];
      const conditionExpr = node.attributes.condition;
      const countMode = node.attributes.count === 'true';
      if (!conditionExpr) {
        errors.push({ type: 'semantic', message: `Missing condition for ${node.type}`, line: node.line });
        return;
      }
      const tree = parseExpression(conditionExpr);
      if (!tree) {
        errors.push({ type: 'runtime', message: `Invalid condition in ${node.type}`, line: node.line });
        return;
      }
      if (!Array.isArray(collection) && !(collection instanceof Set)) {
        errors.push({ type: 'runtime', message: `Invalid collection for ${node.type}`, line: node.line });
        return;
      }
      const items = Array.from(collection);
      let matches = 0;
      for (const item of items) {
        const itemContext = { ...context, item }; // Assume condition uses 'item' var; adjust if needed
        const evalResult = evalTree(tree, itemContext);
        if (evalResult) matches++;
      }
      let resultBool: boolean;
      if (node.type === 'exists') {
        resultBool = matches > 0;
      } else { // forall
        resultBool = matches === items.length;
      }
      results[name] = countMode ? { result: resultBool, count: matches } : resultBool;
    }

    node.children.forEach(child => processQuery(child, context));
  }

  // Process assertions
  function processAssertion(node: AstNode, context: Record<string, any>) {
    const expr = node.text || '';
    const tree = parseExpression(expr);
    if (tree) {
      if (!evalTree(tree, context)) {
        errors.push({ type: 'runtime', message: `Assertion failed: ${expr}`, line: node.line, suggestedFix: 'Adjust values or conditions to satisfy assertion' });
      }
    } else {
      errors.push({ type: 'runtime', message: `Invalid assertion expression`, line: node.line, suggestedFix: 'Provide a valid logical expression' });
    }
  }

  // Process branches/counterfactuals
  function processBranch(node: AstNode, context: Record<string, any>) {
    const ifStr = node.attributes.if;
    if (ifStr) {
      const newContext = { ...context };
      ifStr.split(',').forEach(ass => {
        const [key, val] = ass.split('=').map(s => s.trim());
        const existingType = symbols.get(key)?.type || 'any';
        newContext[key] = parseValue(val, existingType, symbols, errors, node.line);
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
    if (node.type === 'import') handleImport(node);
    if (domainRegistry.has(node.type)) handleDomain(node, symbols); // Handle domain tags
    if (node.type === 'queries') node.children.forEach(child => processQuery(child, context));
    if (node.type === 'assertions') node.children.forEach(child => processAssertion(child, context));
    if (node.type === 'counterfactual' || node.type === 'branch') processBranch(node, context);
    if (node.type === 'simulate') processSimulate(node);
    node.children.forEach(child => traverse(child, context));
  }

  traverse(ast, valueContext);
  return { results, errors, trace };
}