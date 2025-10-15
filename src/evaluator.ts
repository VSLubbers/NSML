// src/evaluator.ts - Updated with fixes for core reasoning
import {
  AstNode,
  SymbolTable,
  EvalResult,
  EvalError,
  ExprNode,
  SymbolEntry,
} from './types';
import { parseExpression, compileRules } from './compiler';
import { parseValue } from './resolver';
import { domainRegistry } from './domains';

function deepClone(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Set) return new Set(obj);
  if (obj instanceof Map) return new Map(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);
  const copy: Record<string, any> = {};
  for (const key in obj) {
    copy[key] = deepClone(obj[key]);
  }
  return copy;
}

export function evaluate(
  ast: AstNode | null,
  symbols: SymbolTable,
  rules: Map<string, Function>
): EvalResult {
  const results: Record<string, any> = {};
  const errors: EvalError[] = [];
  const trace: string[] = [];

  if (!ast) {
    errors.push({
      type: 'runtime',
      message: 'Invalid AST',
      suggestedFix: 'Verify input and parsing',
    });
    return { results, errors, trace };
  }

  // Create value context from symbols
  const valueContext: Record<string, any> = deepClone(Object.fromEntries(
    Array.from(symbols, ([k, v]) => [k, v.value])
  ));

  // Get expression trees from compiler
  const { exprTrees } = compileRules(ast, symbols);

  // Handle imports (placeholder updated: log for now, full impl in extensions)
  function handleImport(node: AstNode) {
    const src = node.attributes.src;
    if (src) {
      trace.push(`Importing ${src} (full loading not implemented yet)`);
      // TODO: Recursively fetch/parse/merge - requires file system access
    } else {
      errors.push({
        type: 'semantic',
        message: 'Missing src for import',
        line: node.line,
        suggestedFix: 'Add src="path/to/file.nsml"',
      });
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
      errors.push({
        type: 'semantic',
        message: `Unknown domain tag '${node.type}'`,
        line: node.line,
        suggestedFix: 'Register custom handler or use core tags',
      });
    }
  }

  // Evaluate expression tree (updated for better func handling)
  function evalTree(tree: ExprNode, context: Record<string, any>): any {
    if (tree.value !== undefined) {
      const val =
        context[tree.value as string] !== undefined
          ? context[tree.value as string]
          : tree.value;
      return val;
    }
    if (tree.func) {
      const args = tree.args?.map((a: ExprNode) => evalTree(a, context)) || [];
      if (tree.func === 'error') return { type: 'error', message: args[0] };
      if (tree.func === 'path') {
        if (args.length !== 3) {
          errors.push({
            type: 'runtime',
            message: 'path function requires 3 arguments (graph, start, end)',
            line: tree.line || 0, // Assume line added to ExprNode if needed
            suggestedFix: 'Provide graph, start node, and end node',
          });
          return null;
        }
        const [graph, from, to] = args;
        if (typeof from !== 'string' || typeof to !== 'string') {
          errors.push({
            type: 'runtime',
            message: 'Start and end must be strings for path',
            line: tree.line || 0,
          });
          return null;
        }
        if (
          !(
            graph &&
            graph.nodes instanceof Set &&
            graph.edges instanceof Map
          )
        ) {
          errors.push({
            type: 'runtime',
            message: 'Invalid graph argument for path',
            line: tree.line || 0,
            suggestedFix: 'Ensure first argument is a valid graph symbol',
          });
          return null;
        }
        // BFS for path (unchanged, but now with string checks)
        const queue: string[] = [from];
        const visited = new Set<string>([from]);
        const parent = new Map<string, string | null>([[from, null]]);
        let found = false;
        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (curr === to) {
            found = true;
            break;
          }
          const neighbors = Array.from(
            graph.edges.get(curr)?.values() || []
          ) as string[];
          for (const neigh of neighbors) {
            if (!visited.has(neigh)) {
              visited.add(neigh);
              queue.push(neigh);
              parent.set(neigh, curr);
            }
          }
        }
        if (!found) {
          return null;
        }
        // Reconstruct path
        const path: string[] = [];
        let curr: string | null = to;
        while (curr !== null) {
          path.unshift(curr);
          curr = parent.get(curr)!;
        }
        return path;
      }
      if (tree.func === 'eval') {
        if (typeof args[0] === 'string') {
          const ruleTree = exprTrees.get(args[0]);
          if (ruleTree) return evalTree(ruleTree, context);
          errors.push({
            type: 'runtime',
            message: `Unknown rule '${args[0]}'`,
            line: tree.line || 0,
          });
          return null;
        } else {
          return args[0]; // Direct evaluated expression
        }
      }
      // General user-defined function call
      const func = rules.get(tree.func);
      if (func) {
        return func(...args);
      }
      errors.push({
        type: 'runtime',
        message: `Unknown function '${tree.func}'`,
        line: tree.line || 0,
        suggestedFix: 'Define the function in <rules>',
      });
      return null;
    }
    const left = tree.left ? evalTree(tree.left, context) : undefined;
    const right = tree.right ? evalTree(tree.right, context) : undefined;
    switch (tree.op) {
      case '+':
        return Number(left) + Number(right);
      case '-':
        return Number(left) - Number(right);
      case '*':
        return Number(left) * Number(right);
      case '/':
        return Number(left) / Number(right);
      case '%':
        return Number(left) % Number(right);
      case '^':
        return Math.pow(Number(left), Number(right));
      case '>=':
        return Number(left) >= Number(right);
      case '<=':
        return Number(left) <= Number(right);
      case '>':
        return Number(left) > Number(right);
      case '<':
        return Number(left) < Number(right);
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '!':
        return !right;
      case '&&':
        return left && right;
      case '||':
        return left || right;
      case '=>':
        return !left || right;
      case '<=>':
        return (left && right) || (!left && !right);
      case 'in':
        if (right instanceof Set) return right.has(left);
        if (Array.isArray(right)) return right.includes(left);
        return false;
      case 'union':
        if (left instanceof Set && right instanceof Set)
          return new Set([...left, ...right]);
        return null;
      case 'intersect':
        if (left instanceof Set && right instanceof Set)
          return new Set([...left].filter((x) => right.has(x)));
        return null;
      case 'diff':
        if (left instanceof Set && right instanceof Set)
          return new Set([...left].filter((x) => !right.has(x)));
        return null;
      default:
        return null;
    }
  }

  // Process queries recursively
  function processQuery(node: AstNode, context: Record<string, any>) {
    if (node.type === 'counterfactual' || node.type === 'branch') {
      processBranch(node, context);
      return;
    }
    const name = node.attributes.name || 'anonymous';
    const expr = node.text || ''; // Removed attributes.eval, assume text is expression
    if (expr) {
      const tree = parseExpression(expr);
      if (tree) {
        results[name] = evalTree(tree, context);
      } else {
        errors.push({
          type: 'runtime',
          message: `Invalid expression in query '${name}'`,
          line: node.line,
          suggestedFix: 'Check syntax of expression',
        });
      }
    }
    if (node.type === 'aggregate') {
      const func = node.attributes.func;
      const over = context[node.attributes.over];
      if (Array.isArray(over) || over instanceof Set) {
        const vals = Array.from(over)
          .map((v) => Number(v))
          .filter((v) => !isNaN(v)); // Filter valid numbers
        if (vals.length === 0) {
          errors.push({
            type: 'runtime',
            message: `No valid numbers in aggregate '${name}'`,
            line: node.line,
          });
          return;
        }
        let aggResult: number | { count: number } | undefined;
        switch (func) {
          case 'count':
            aggResult = vals.length;
            break;
          case 'sum':
            aggResult = vals.reduce((a, b) => a + b, 0);
            break;
          case 'min':
            aggResult = Math.min(...vals);
            break;
          case 'max':
            aggResult = Math.max(...vals);
            break;
          case 'avg':
            aggResult = vals.reduce((a, b) => a + b, 0) / vals.length;
            break;
          default:
            errors.push({
              type: 'semantic',
              message: `Unknown aggregate func '${func}'`,
              line: node.line,
            });
            return;
        }
        results[name] = aggResult;
      } else {
        errors.push({
          type: 'runtime',
          message: `Invalid collection for aggregate '${name}'`,
          line: node.line,
        });
      }
    }
    if (node.type === 'exists' || node.type === 'forall') {
      const collection = context[node.attributes.in];
      const conditionExpr = node.attributes.condition;
      const countMode = node.attributes.count === 'true';
      if (!conditionExpr) {
        errors.push({
          type: 'semantic',
          message: `Missing condition for ${node.type}`,
          line: node.line,
        });
        return;
      }
      const tree = parseExpression(conditionExpr);
      if (!tree) {
        errors.push({
          type: 'runtime',
          message: `Invalid condition in ${node.type}`,
          line: node.line,
        });
        return;
      }
      if (!Array.isArray(collection) && !(collection instanceof Set)) {
        errors.push({
          type: 'runtime',
          message: `Invalid collection for ${node.type}`,
          line: node.line,
        });
        return;
      }
      const items = Array.from(collection);
      let matches = 0;
      for (const item of items) {
        const itemContext = { ...context, item }; // Assume condition uses 'item' var
        if (evalTree(tree, itemContext)) matches++;
      }
      let resultBool: boolean;
      if (node.type === 'exists') {
        resultBool = matches > 0;
      } else {
        // forall
        resultBool = matches === items.length;
      }
      results[name] = countMode
        ? { result: resultBool, count: matches }
        : resultBool;
    }
    node.children.forEach((child) => processQuery(child, context));
  }

  // Process assertions
  function processAssertion(node: AstNode, context: Record<string, any>) {
    const expr = node.text || '';
    const tree = parseExpression(expr);
    if (tree) {
      if (!evalTree(tree, context)) {
        errors.push({
          type: 'runtime',
          message: `Assertion failed: ${expr}`,
          line: node.line,
          suggestedFix: 'Adjust values or conditions to satisfy assertion',
        });
      }
    } else {
      errors.push({
        type: 'runtime',
        message: `Invalid assertion expression`,
        line: node.line,
        suggestedFix: 'Provide a valid logical expression',
      });
    }
  }

  // Process constraints
  function processConstraint(node: AstNode, context: Record<string, any>) {
    const expr = node.text || '';
    const tree = parseExpression(expr);
    if (tree) {
      const evalResult = evalTree(tree, context);
      if (evalResult && evalResult.type === 'error') {
        errors.push({
          type: 'runtime',
          message: evalResult.message,
          line: node.line,
        });
      }
    } else {
      errors.push({
        type: 'runtime',
        message: `Invalid constraint expression`,
        line: node.line,
        suggestedFix: 'Provide a valid implication => action',
      });
    }
  }

  // Traverse AST for constraints in rules
  function processAllConstraints(node: AstNode, context: Record<string, any>) {
    if (node.type === 'rules') {
      node.children.forEach((child) => {
        if (child.type === 'constraint') {
          processConstraint(child, context);
        }
      });
    }
    node.children.forEach((child) => processAllConstraints(child, context));
  }

  // Process branches/counterfactuals
  function processBranch(node: AstNode, context: Record<string, any>) {
    const ifStr = node.attributes.if;
    if (ifStr) {
      const newContext = deepClone(context);
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
    if (node.type === 'queries')
      node.children.forEach((child) => processQuery(child, context));
    if (node.type === 'assertions')
      node.children.forEach((child) => processAssertion(child, context));
    if (node.type === 'counterfactual' || node.type === 'branch')
      processBranch(node, context);
    if (node.type === 'simulate') processSimulate(node);
    node.children.forEach((child) => traverse(child, context));
  }

  // Run constraints pass after symbols but before main traverse
  processAllConstraints(ast, valueContext);

  traverse(ast, valueContext);

  return { results, errors, trace };
}