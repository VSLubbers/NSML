import { AstNode, SymbolTable, ExprNode, Operator, EvalError } from './types';

interface CompileResult {
  rules: Map<string, Function>;
  exprTrees: Map<string, ExprNode>;
  errors: EvalError[];
}

export function compileRules(
  ast: AstNode | null,
  symbols: SymbolTable
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
    const name = node.attributes.name || `anonymous${anonymousCount++}`;
    const exprStr = node.text || node.attributes.body || '';
    const tree = parseExpression(exprStr);
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
        node.line
      );
    };

    rules.set(name, func);
  }

  compileNode(ast);
  return { rules, exprTrees, errors };
}

export function parseExpression(expr: string): ExprNode | null {
  const tokens = tokenizeExpr(expr);

  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string | undefined {
    const token = tokens[pos];
    return tokens[pos++];
  }

  function parsePrimary(): ExprNode | null {
    const token = consume();
    if (!token) {
      return null;
    }

    if (isNumber(token)) {
      return { value: Number(token) };
    }
    if (isString(token)) {
      const value = token.slice(1, -1);
      return { value };
    }
    if (token === 'true') {
      return { value: true };
    }
    if (token === 'false') {
      return { value: false };
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
        return { func: token, args };
      }
      return { value: token };
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
      return { op, right };
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
      left = { op, left, right };
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
      left = { op, left, right };
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
      left = { op, left, right };
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
      left = { op, left, right };
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
      left = { op, left, right };
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
  const tokens =
    expr.match(/("[^"]"|'[^']'|\d+|[a-zA-Z_]\w*|[&|!=><+*/%^(),-]+)/g) || [];
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
  const isId = /[a-zA-Z_]\w*/.test(token);
  return isId;
}

export function evalExpr(
  tree: ExprNode,
  context: any,
  errors: EvalError[],
  line: number
): any {

  if (tree.value !== undefined) {
    const value = context[tree.value] || tree.value;
    return value;
  }

  if (tree.func) {
    const args =
      tree.args?.map((a) => evalExpr(a, context, errors, line)) || [];


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
      suggestedFix: 'Use supported functions like path or error',
    });
    return null;
  }

  // Short-circuit for logical ops
  if (tree.op === '&&') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line)
      : undefined;
    if (!left) return left;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line)
      : undefined;
    return right;
  }

  if (tree.op === '||') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line)
      : undefined;
    if (left) return left;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line)
      : undefined;
    return right;
  }

  if (tree.op === '=>') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line)
      : undefined;
    if (!left) return true;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line)
      : undefined;
    return right;
  }

  if (tree.op === '<=>') {
    const left = tree.left
      ? evalExpr(tree.left, context, errors, line)
      : undefined;
    const right = tree.right
      ? evalExpr(tree.right, context, errors, line)
      : undefined;
    return !!left === !!right;
  }

  const leftVal = tree.left
    ? evalExpr(tree.left, context, errors, line)
    : undefined;
  const rightVal = tree.right
    ? evalExpr(tree.right, context, errors, line)
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
