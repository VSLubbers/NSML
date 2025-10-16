// src/compiler.ts
import { AstNode, SymbolTable, ExprNode, Operator, EvalError } from './types';
interface CompileResult {
  rules: Map<string, Function>;
  exprTrees: Map<string, ExprNode>;
  errors: EvalError[];
}
export function compileRules(
  ast: AstNode | null,
  symbols: SymbolTable,
  namespace: string = ''
): CompileResult {
  const rules = new Map<string, Function>();
  const exprTrees = new Map<string, ExprNode>();
  const errors: EvalError[] = [];

  if (!ast) {
    errors.push({
      type: 'semantic',
      message: 'Invalid AST',
      suggestedFix: 'Check NSML input for syntax errors',
    });
    return { rules, exprTrees, errors };
  }

  let anonymousCount = 0;

  function compileNode(node: AstNode) {
    if (node.type === 'rules') {
      for (const child of node.children) {
        compileRule(child, rules, exprTrees, errors);
      }
    }
    for (const child of node.children) {
      compileNode(child);
    }
  }

  function compileRule(
    node: AstNode,
    rules: Map<string, Function>,
    exprTrees: Map<string, ExprNode>,
    errors: EvalError[]
  ) {
    const origName = node.attributes.name || `anonymous${anonymousCount++}`;
    const name = namespace ? `${namespace}.${origName}` : origName;
    const exprStr = node.text || node.attributes.body || '';
    let tree;
    try {
      const paramStr = node.attributes.params || '';
      const params = paramStr
        .split(',')
        .map((p) => p.split(':')[0].trim())
        .filter((p) => p);
      tree = parseExpression(exprStr, node.line, namespace, params); // Pass namespace and params
    } catch (e: any) {
      errors.push({
        type: 'syntax',
        message: e.message,
        line: node.line,
        suggestedFix: 'Verify operators and parentheses in expression',
      });
      return;
    }
    if (!tree) {
      errors.push({
        type: 'syntax',
        message: `Invalid expression in '${name}'`,
        line: node.line,
        suggestedFix: 'Verify operators and parentheses in expression',
      });
      return;
    }

    exprTrees.set(name, tree);

    const paramStr = node.attributes.params || '';
    const params = paramStr
      .split(',')
      .map((p) => p.split(':')[0].trim())
      .filter((p) => p);

    const func = (...args: any[]) => {
      const trace = args[params.length] as string[] | undefined;
      const tracing = args[params.length + 1] as boolean | undefined;
      const paramContext = Object.fromEntries(
        params.map((p, i) => [p, args[i]])
      );
      const symbolValues: Record<string, any> = {};
      for (const [k, v] of symbols) {
        symbolValues[k] = v.value;
      }
      return evalExpr(
        tree,
        { ...symbolValues, ...paramContext },
        errors,
        node.line,
        trace ?? [],
        tracing ?? false
      );
    };

    rules.set(name, func);
  }

  compileNode(ast);
  return { rules, exprTrees, errors };
}

export function parseExpression(
  expr: string,
  line?: number,
  namespace: string = '',
  params: string[] = []
): ExprNode | null {
  // Added line param
  expr = expr.replace(/(\d)([a-zA-Z_])/g, '$1*$2');
  const tokens = tokenizeExpr(expr);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string | undefined {
    return tokens[pos++];
  }

  function parsePrimary(): ExprNode | null {
    let token = consume();
    if (!token) {
      return null;
    }
    if (isNumber(token)) {
      return { value: Number(token), line };
    }
    if (isString(token)) {
      const value = token.slice(1, -1);
      return { value, line };
    }
    if (token === 'true') {
      return { value: true, line };
    }
    if (token === 'false') {
      return { value: false, line };
    }
    if (isIdentifier(token)) {
      if (peek() === '(') {
        // Function call
        consume(); // (
        const args: ExprNode[] = [];
        while (peek() !== ')' && peek() !== undefined) {
          const arg = parseExpressionPart();
          if (arg) {
            args.push(arg);
          }
          if (peek() === ',') consume();
        }
        if (peek() === ')') consume();
        else return null; // Unmatched )
        const builtins = ['error', 'path', 'eval'];
        if (!builtins.includes(token) && namespace) {
          token = `${namespace}.${token}`;
        }
        return { func: token, args, line };
      }
      if (!params.includes(token) && namespace) {
        token = `${namespace}.${token}`;
      }
      return { value: token, line };
    }
    if (token === '(') {
      const expr = parseExpressionPart();
      if (consume() !== ')') {
        return null;
      }
      return expr;
    }
    return null;
  }

  function parseUnary(): ExprNode | null {
    if (['!', '-'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseUnary();
      if (!right) return null;
      return { op, right, line };
    }
    return parsePrimary();
  }

  function parsePower(): ExprNode | null {
    let left = parseUnary();
    if (!left) return null;
    while (peek() === '^') {
      const op = consume() as Operator;
      const right = parseUnary();
      if (!right) return null;
      left = { op, left, right, line };
    }
    return left;
  }

  function parseMultiplicative(): ExprNode | null {
    let left = parsePower();
    if (!left) return null;
    while (['*', '/', '%'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parsePower();
      if (!right) return null;
      left = { op, left, right, line };
    }
    return left;
  }

  function parseAdditive(): ExprNode | null {
    let left = parseMultiplicative();
    if (!left) return null;
    while (['+', '-', 'union', 'intersect', 'diff'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseMultiplicative();
      if (!right) return null;
      left = { op, left, right, line };
    }
    return left;
  }

  function parseComparison(): ExprNode | null {
    let left = parseAdditive();
    if (!left) return null;
    while (['==', '!=', '>', '>=', '<', '<=', 'in'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseAdditive();
      if (!right) return null;
      left = { op, left, right, line };
    }
    return left;
  }

  function parseLogical(): ExprNode | null {
    let left = parseComparison();
    if (!left) return null;
    while (['&&', '||', '=>', '<=>'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseComparison();
      if (!right) return null;
      left = { op, left, right, line };
    }
    return left;
  }

  function parseExpressionPart(): ExprNode | null {
    const result = parseLogical();
    return result;
  }

  const tree = parseExpressionPart();
  if (pos !== tokens.length) {
    return null;
  }
  return tree;
}

function tokenizeExpr(expr: string): string[] {
  const tokens = [];
  let pos = 0;
  while (pos < expr.length) {
    const char = expr[pos];
    if (/\s/.test(char)) {
      pos++;
      continue;
    } // Skip space
    if (char === '"' || char === "'") {
      const end = expr.indexOf(char, pos + 1);
      if (end === -1) throw new Error('Unclosed string');
      tokens.push(expr.slice(pos, end + 1));
      pos = end + 1;
      continue;
    }
    if (/\d/.test(char)) {
      let num = '';
      while (pos < expr.length && /\d/.test(expr[pos])) num += expr[pos++];
      tokens.push(num);
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let id = '';
      while (pos < expr.length && /[a-zA-Z_\w.]/.test(expr[pos]))
        id += expr[pos++]; // Allow . for dotted identifiers
      tokens.push(id);
      continue;
    }
    // Three-char ops
    const three = expr.slice(pos, pos + 3);
    if (three === '<=>') {
      tokens.push(three);
      pos += 3;
      continue;
    }
    // Two-char ops
    const two = expr.slice(pos, pos + 2);
    if (['&&', '||', '!=', '>=', '<=', '==', '=>'].includes(two)) {
      tokens.push(two);
      pos += 2;
      continue;
    }
    // Single char ops/symbols
    if (
      ['!', '+', '-', '*', '/', '%', '^', '>', '<', '(', ')', ','].includes(
        char
      )
    ) {
      tokens.push(char);
      pos++;
      continue;
    }
    throw new Error(`Unsupported operator or token '${char}'`);
  }
  return tokens;
}

function isNumber(token: string): boolean {
  const isNum = /^\d+$/.test(token);
  return isNum;
}

function isString(token: string): boolean {
  const isStr =
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"));
  return isStr;
}

function isIdentifier(token: string): boolean {
  const isId = /^[a-zA-Z_][\w.]*$/.test(token); // Allow dotted
  return isId;
}

export function evalExpr(
  tree: ExprNode,
  context: any,
  errors: EvalError[],
  line: number,
  trace: string[] = [], // Added trace param
  tracing = false // Added tracing flag
): any {
  if (tracing && tree.op)
    trace.push(`Applying operator ${tree.op} at line ${line}`);
  if (tracing && tree.func)
    trace.push(`Calling function ${tree.func} at line ${line}`);
  if (tree.value !== undefined) {
    const value = context[tree.value] || tree.value;
    if (tracing) trace.push(`Resolved value: ${value}`);
    return value;
  }
  if (tree.func) {
    const args =
      tree.args?.map((a) =>
        evalExpr(a, context, errors, line, trace, tracing)
      ) || [];
    if (tracing)
      trace.push(
        `Calling function ${tree.func} with args: ${JSON.stringify(args)}`
      );
    if (tree.func === 'error') {
      return { type: 'error', message: args[0] };
    }
    if (tree.func === 'path') {
      if (args.length !== 3) {
        errors.push({
          type: 'runtime',
          message: 'path function requires 3 arguments (graph, start, end)',
          line,
          suggestedFix: 'Provide graph, start node, and end node',
        });
        return null;
      }
      const [graph, from, to] = args;
      if (
        !(
          graph &&
          graph.nodes instanceof Set &&
          graph.edges instanceof Map &&
          typeof from === 'string' &&
          typeof to === 'string'
        )
      ) {
        errors.push({
          type: 'runtime',
          message: 'Invalid arguments for path function',
          line,
          suggestedFix:
            'Ensure first argument is a graph and others are strings',
        });
        return null;
      }
      // BFS to find path
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
    errors.push({
      type: 'runtime',
      message: `Unknown function '${tree.func}'`,
      line,
      suggestedFix: 'Check supported functions in NSML spec',
    });
    return null;
  }
  // Short-circuit for logical ops
  if (tree.op === '&&') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line, trace, tracing)
      : undefined;
    if (!left) return left;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line, trace, tracing)
      : undefined;
    return right;
  }
  if (tree.op === '||') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line, trace, tracing)
      : undefined;
    if (left) return left;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line, trace, tracing)
      : undefined;
    return right;
  }
  if (tree.op === '=>') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line, trace, tracing)
      : undefined;
    if (!left) return true;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line, trace, tracing)
      : undefined;
    return right;
  }
  if (tree.op === '<=>') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line, trace, tracing)
      : undefined;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line, trace, tracing)
      : undefined;
    return !!left === !!right;
  }
  const leftVal = tree.left
    ? evalExpr(tree.left, context, errors, line, trace, tracing)
    : undefined;
  const rightVal = tree.right
    ? evalExpr(tree.right, context, errors, line, trace, tracing)
    : undefined;
  switch (tree.op) {
    case '+':
      if (leftVal === undefined) return -Number(rightVal); // Unary
      return Number(leftVal) + Number(rightVal);
    case '-':
      if (leftVal === undefined) return -Number(rightVal); // Unary
      return Number(leftVal) - Number(rightVal);
    case '*':
      return Number(leftVal) * Number(rightVal);
    case '/':
      return Number(leftVal) / Number(rightVal);
    case '%':
      return Number(leftVal) % Number(rightVal);
    case '^':
      return Math.pow(Number(leftVal), Number(rightVal));
    case '>=':
      return Number(leftVal) >= Number(rightVal);
    case '<=':
      return Number(leftVal) <= Number(rightVal);
    case '>':
      return Number(leftVal) > Number(rightVal);
    case '<':
      return Number(leftVal) < Number(rightVal);
    case '==':
      return leftVal === rightVal;
    case '!=':
      return leftVal !== rightVal;
    case '!':
      return !rightVal;
    case 'in':
      if (rightVal instanceof Set) return rightVal.has(leftVal);
      if (Array.isArray(rightVal)) return rightVal.includes(leftVal);
      errors.push({
        type: 'runtime',
        message: 'Right operand of "in" must be a set or array',
        line,
        suggestedFix: 'Use a set or list for membership check',
      });
      return false;
    case 'union':
      if (leftVal instanceof Set && rightVal instanceof Set)
        return new Set([...leftVal, ...rightVal]);
      errors.push({
        type: 'runtime',
        message: 'Operands of "union" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets',
      });

      return null;
    case 'intersect':
      if (leftVal instanceof Set && rightVal instanceof Set)
        return new Set([...leftVal].filter((x) => rightVal.has(x)));
      errors.push({
        type: 'runtime',
        message: 'Operands of "intersect" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets',
      });

      return null;
    case 'diff':
      if (leftVal instanceof Set && rightVal instanceof Set)
        return new Set([...leftVal].filter((x) => !rightVal.has(x)));
      errors.push({
        type: 'runtime',
        message: 'Operands of "diff" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets',
      });

      return null;
    default:
      errors.push({
        type: 'runtime',
        message: `Unsupported operator '${tree.op}'`,
        line,
        suggestedFix: 'Check supported operators in NSML spec',
      });
      return null;
  }
}
