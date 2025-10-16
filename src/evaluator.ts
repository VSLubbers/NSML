// src/evaluator.ts - Updated with enhanced traces for <simulate>
import {
  AstNode,
  SymbolTable,
  EvalResult,
  EvalError,
  ExprNode,
  SymbolEntry,
} from './types';
import { parseExpression, compileRules, evalExpr } from './compiler'; // Updated import for evalExpr
import { parseValue } from './resolver';
import { domainRegistry } from './domains';
import * as fs from 'fs/promises';
import * as path from 'path';
import { lex } from './lexer';
import { parse } from './parser';
import { resolve } from './resolver';

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

export async function evaluate(
  ast: AstNode | null,
  symbols: SymbolTable
): Promise<EvalResult> {
  const results: Record<string, any> = {};
  const errors: EvalError[] = [];
  const trace: string[] = [];
  const tracingTargets = new Set<string>(); // Track targets for tracing during initial eval
  const simulateTraces: Record<string, string[]> = {}; // Per-target traces for order control

  const importedPaths = new Set<string>();
  const importedItems: {
    ast: AstNode;
    alias?: string;
    scope?: string;
    src: string;
  }[] = [];

  if (!ast) {
    errors.push({
      type: 'runtime',
      message: 'Invalid AST',
      suggestedFix: 'Verify input and parsing',
    });
    return { results, errors, trace };
  }

  // Pre-process imports asynchronously
  async function preProcessImports(node: AstNode) {
    if (node.type === 'import') {
      await handleImport(node);
    }
    for (const child of node.children) {
      await preProcessImports(child);
    }
  }
  await preProcessImports(ast);

  // Initialize rules and exprTrees
  let rules: Map<string, Function> = new Map();
  let exprTrees: Map<string, ExprNode> = new Map();

  // Now process imported ASTs to merge symbols and rules
  for (const item of importedItems) {
    const namespace = item.alias || '';
    const importedResolved = resolve(item.ast, namespace);
    errors.push(...importedResolved.errors);
    for (const [k, v] of importedResolved.symbols) {
      if (symbols.has(k)) {
        errors.push({
          type: 'semantic',
          message: `Symbol conflict '${k}' from import '${item.src}'`,
          suggestedFix: 'Use alias to namespace or resolve duplicate',
        });
      } else {
        symbols.set(k, v);
      }
    }

    const importedCompiled = compileRules(item.ast, symbols, namespace);
    errors.push(...importedCompiled.errors);
    for (const [k, t] of importedCompiled.exprTrees) {
      if (exprTrees.has(k)) {
        errors.push({
          type: 'semantic',
          message: `Expression tree conflict '${k}' from import '${item.src}'`,
          suggestedFix: 'Use alias to namespace or resolve duplicate',
        });
      } else {
        exprTrees.set(k, t);
      }
    }
    for (const [k, f] of importedCompiled.rules) {
      if (rules.has(k)) {
        errors.push({
          type: 'semantic',
          message: `Rule conflict '${k}' from import '${item.src}'`,
          suggestedFix: 'Use alias to namespace or resolve duplicate',
        });
      } else {
        rules.set(k, f);
      }
    }
    trace.push(`Merged symbols and rules from ${item.src}`);
  }

  // Create value context from (merged) symbols
  const valueContext: Record<string, any> = {};
  for (const [k, v] of symbols) {
    valueContext[k] = deepClone(v.value);
  }

  // Compile and merge main AST's rules and exprTrees
  const mainCompiled = compileRules(ast, symbols);
  errors.push(...mainCompiled.errors);
  for (const [k, t] of mainCompiled.exprTrees) {
    if (exprTrees.has(k)) {
      errors.push({
        type: 'semantic',
        message: `Expression tree conflict '${k}' in main`,
        suggestedFix: 'Resolve duplicate',
      });
    } else {
      exprTrees.set(k, t);
    }
  }
  for (const [k, f] of mainCompiled.rules) {
    if (rules.has(k)) {
      errors.push({
        type: 'semantic',
        message: `Rule conflict '${k}' in main`,
        suggestedFix: 'Resolve duplicate',
      });
    } else {
      rules.set(k, f);
    }
  }

  // Process imported ASTs for full scope if specified
  for (const item of importedItems) {
    if (item.scope === 'full') {
      processAllConstraints(item.ast, valueContext);
      traverse(item.ast, valueContext);
    }
  }

  // Note: To make it work, we assume a base directory, here using process.cwd() for simplicity.
  // For production, consider passing baseDir as a parameter to evaluate.
  async function handleImport(node: AstNode) {
    const src = node.attributes.src;
    if (src) {
      if (typeof process === 'undefined' || typeof require === 'undefined') {
        errors.push({
          type: 'runtime',
          message:
            'File imports are not supported in this environment (e.g., browser)',
          line: node.line,
          suggestedFix: 'Use a Node.js environment or avoid <import> tags',
        });
        return;
      }

      const atobPoly = (str: string) =>
        Buffer.from(str, 'base64').toString('binary');
      const fs = await import(atobPoly('ZnMvcHJvbWlzZXM='));
      const path = await import(atobPoly('cGF0aA=='));

      const fullPath = path.resolve(process.cwd(), src);
      if (importedPaths.has(fullPath)) {
        errors.push({
          type: 'semantic',
          message: `Cycle detected importing '${src}'`,
          line: node.line,
          suggestedFix: 'Remove cyclic import dependencies',
        });
        return;
      }
      importedPaths.add(fullPath);

      let content;
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch (e: any) {
        errors.push({
          type: 'runtime',
          message: `Failed to read file '${src}': ${e.message}`,
          line: node.line,
          suggestedFix: 'Verify the file path and access permissions',
        });
        return;
      }

      trace.push(`Importing ${src}`);

      const tokens = lex(content);
      const { ast: importedAst, errors: parseErrors } = parse(tokens);
      if (parseErrors.length > 0) {
        errors.push(...parseErrors);
        return;
      }
      if (!importedAst) {
        errors.push({
          type: 'semantic',
          message: `Invalid AST from imported file '${src}'`,
          line: node.line,
          suggestedFix: 'Check the syntax in the imported file',
        });
        return;
      }

      // Recursively handle nested imports
      await preProcessImports(importedAst);

      // Store the imported AST for merging
      importedItems.push({
        ast: importedAst,
        alias: node.attributes.as,
        scope: node.attributes.scope,
        src,
      });
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

  // Evaluate expression tree (updated for better func handling and tracing)
  function evalTree(
    tree: ExprNode | null,
    context: Record<string, any>,
    targetTrace: string[] = trace,
    tracing = false
  ): any {
    if (!tree || typeof tree !== 'object') {
      errors.push({
        type: 'runtime',
        message: 'Invalid expression tree for evaluation',
        line: tree && 'line' in tree ? ((tree as any).line ?? 0) : 0,
      });
      return null;
    }
    if (tracing && (tree.op || tree.func))
      targetTrace.push(
        `Evaluating expression at line ${tree.line || 'unknown'}`
      );
    if (tree.value !== undefined) {
      const val =
        context[tree.value as string] !== undefined
          ? context[tree.value as string]
          : tree.value;
      if (tracing && typeof val !== 'string')
        targetTrace.push(`Resolved value: ${val}`);
      return val;
    }
    if (tree.func) {
      const args =
        tree.args?.map((a: ExprNode) =>
          evalTree(a, context, targetTrace, tracing)
        ) || [];
      if (tracing)
        targetTrace.push(
          `Calling function ${tree.func} with args: ${JSON.stringify(args)}`
        );
      if (tree.func === 'error') return { type: 'error', message: args[0] };
      if (tree.func === 'path') {
        if (args.length !== 3) {
          errors.push({
            type: 'runtime',
            message: 'path function requires 3 arguments (graph, start, end)',
            line: tree.line || 0, // Use tree.line
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
          !(graph && graph.nodes instanceof Set && graph.edges instanceof Map)
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
        if (args.length !== 1) {
          errors.push({
            type: 'runtime',
            message: 'eval function requires 1 argument',
            line: tree.line || 0,
          });
          return null;
        }
        const arg = args[0];
        if (typeof arg === 'string') {
          const ruleTree = exprTrees.get(arg);
          if (ruleTree) {
            if (tracing) targetTrace.push(`Applying rule ${arg}`);
            return evalTree(ruleTree, context, targetTrace, tracing);
          }
          errors.push({
            type: 'runtime',
            message: `Unknown rule '${arg}'`,
            line: tree.line || 0,
          });
          return null;
        } else {
          // Direct value from inner expression - return as-is
          return arg;
        }
      }
      // General user-defined function call
      const func = rules.get(tree.func);
      if (func) {
        const result = func(...args, targetTrace, tracing);
        if (tracing)
          targetTrace.push(`Function ${tree.func} returned: ${result}`);
        return result;
      }
      errors.push({
        type: 'runtime',
        message: `Unknown function '${tree.func}'`,
        line: tree.line || 0,
        suggestedFix: 'Use supported functions like path or error',
      });
      return null;
    }
    const left = tree.left
      ? evalTree(tree.left, context, targetTrace, tracing)
      : undefined;
    const right = tree.right
      ? evalTree(tree.right, context, targetTrace, tracing)
      : undefined;
    if (tracing)
      targetTrace.push(`Applying operator ${tree.op} to ${left} and ${right}`);
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

  // Process queries recursively (updated for chain support)
  function processQuery(
    node: AstNode,
    context: Record<string, any>,
    targetTrace: string[] = trace,
    tracing = false
  ) {
    if (node.type === 'counterfactual' || node.type === 'branch') {
      processBranch(node, context);
      return;
    }
    const name = node.attributes.name || 'anonymous';
    let expr = node.text || ''; // Removed attributes.eval, assume text is expression
    let currentValue;
    if (node.attributes.chain) {
      const chain = node.attributes.chain.split(' => ').map((s) => s.trim());
      const target = context[node.attributes.target];
      if (target === undefined) {
        errors.push({
          type: 'semantic',
          message: `Missing target for chained query '${name}'`,
          line: node.line,
        });
        return;
      }
      currentValue = target;
      for (const step of chain) {
        const ruleTree = exprTrees.get(step);
        if (ruleTree) {
          if (tracing) targetTrace.push(`Applying ${step} to ${currentValue}`);
          currentValue = evalTree(
            ruleTree,
            { ...context, item: currentValue },
            targetTrace,
            tracing
          ); // Use 'item' for chained input
        } else {
          errors.push({
            type: 'runtime',
            message: `Unknown step '${step}' in chain for '${name}'`,
            line: node.line,
          });
          return;
        }
      }
    } else if (expr) {
      let tree;
      try {
        tree = parseExpression(expr, node.line);
      } catch (e: any) {
        errors.push({
          type: 'syntax',
          message: e.message,
          line: node.line,
          suggestedFix:
            'Check for supported operators or syntax errors in the expression',
        });
        return;
      }
      if (tree) {
        currentValue = evalTree(tree, context, targetTrace, tracing);
      } else {
        errors.push({
          type: 'runtime',
          message: `Invalid expression in query '${name}'`,
          line: node.line,
          suggestedFix: 'Check syntax of expression',
        });
        return;
      }
    }
    if (currentValue !== undefined) {
      if (currentValue instanceof Set) {
        currentValue = Array.from(currentValue).sort((a, b) =>
          typeof a === 'number' && typeof b === 'number' ? a - b : 0
        ); // Sort numbers for consistent output
      }
      results[name] = currentValue;
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
        let aggResult: number | undefined;
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
      let tree;
      try {
        tree = parseExpression(conditionExpr, node.line);
      } catch (e: any) {
        errors.push({
          type: 'syntax',
          message: e.message,
          line: node.line,
          suggestedFix:
            'Check for supported operators or syntax errors in the expression',
        });
        return;
      }
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
        if (evalTree(tree, itemContext, targetTrace, tracing)) matches++;
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
    node.children.forEach((child) =>
      processQuery(child, context, targetTrace, tracing)
    );
  }

  // Process assertions
  function processAssertion(node: AstNode, context: Record<string, any>) {
    const expr = node.text || '';
    let tree;
    try {
      tree = parseExpression(expr, node.line);
    } catch (e: any) {
      errors.push({
        type: 'syntax',
        message: e.message,
        line: node.line,
        suggestedFix:
          'Check for supported operators or syntax errors in the expression',
      });
      return;
    }
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
    let tree;
    try {
      tree = parseExpression(expr, node.line);
    } catch (e: any) {
      errors.push({
        type: 'syntax',
        message: e.message,
        line: node.line,
        suggestedFix:
          'Check for supported operators or syntax errors in the expression',
      });
      return;
    }
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
      ifStr.split(',').forEach((ass) => {
        const [key, val] = ass.split('=').map((s) => s.trim());
        const existingType = symbols.get(key)?.type || 'any';
        newContext[key] = parseValue(
          val,
          existingType,
          symbols,
          errors,
          node.line
        );
      });
      node.children.forEach((child) => processQuery(child, newContext));
    }
  }

  // Pre-scan for simulate to collect tracing targets and initialize traces
  function preScanForTraces(n: AstNode) {
    if (n.type === 'simulate' && n.attributes.steps === 'full') {
      const target = n.attributes.target;
      tracingTargets.add(target);
      simulateTraces[target] = []; // Init per-target trace
      simulateTraces[target].push(`Starting full trace for ${target}`);
    }
    n.children.forEach(preScanForTraces);
  }
  preScanForTraces(ast);

  // Simulate trace (append completion after eval)
  function processSimulate(node: AstNode) {
    const target = node.attributes.target;
    const steps = node.attributes.steps || 'trace';
    if (steps === 'full') {
      if (simulateTraces[target]) {
        simulateTraces[target].push(`Completed trace for ${target}`);
      }
    } else {
      trace.push(`Evaluating ${target}: step1 eval...`);
    }
  }

  // Traverse AST
  function traverse(node: AstNode, context: Record<string, any>) {
    if (domainRegistry.has(node.type)) handleDomain(node, symbols); // Handle domain tags
    if (node.type === 'queries')
      node.children.forEach((child) => {
        const name = child.attributes.name;
        const tracing = tracingTargets.has(name);
        const targetTrace = simulateTraces[name] || trace;
        processQuery(child, context, targetTrace, tracing);
      });
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

  // Merge all simulate traces into main trace
  for (const t of Object.values(simulateTraces)) {
    trace.push(...t);
  }

  return { results, errors, trace };
}
