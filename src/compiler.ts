import { AstNode, SymbolTable, ExprNode, Operator, EvalError } from './types';

interface CompileResult {
  rules: Map<string, Function>;
  exprTrees: Map<string, ExprNode>;
  errors: EvalError[];
}

export function compileRules(ast: AstNode | null, symbols: SymbolTable): CompileResult {
  const rules = new Map<string, Function>();
  const exprTrees = new Map<string, ExprNode>();
  const errors: EvalError[] = [];

  if (!ast) {
    errors.push({
      type: 'semantic',
      message: 'Invalid AST',
      suggestedFix: 'Check NSML input for syntax errors'
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
    console.log(`Compiling rule '${name}' with expression: ${exprStr}`);

    const tree = parseExpression(exprStr);
    if (!tree) {
      errors.push({
        type: 'syntax',
        message: `Invalid expression in '${name}'`,
        line: node.line,
        suggestedFix: 'Verify operators and parentheses in expression'
      });
      return;
    }

    exprTrees.set(name, tree);

    const paramStr = node.attributes.params || '';
    const params = paramStr.split(',').map(p => p.split(':')[0].trim()).filter(p => p);

    const func = (...args: any[]) => {
      const paramContext = Object.fromEntries(params.map((p, i) => [p, args[i]]));
      const symbolValues: Record<string, any> = {};
      for (const [k, v] of symbols) {
        symbolValues[k] = v.value;
      }
      return evalExpr(tree, { ...symbolValues, ...paramContext }, errors, node.line);
    };

    rules.set(name, func);
  }

  compileNode(ast);
  return { rules, exprTrees, errors };
}

export function parseExpression(expr: string): ExprNode | null {
  const tokens = tokenizeExpr(expr);
  console.log(`Tokenizing expression: ${expr} -> Tokens: ${JSON.stringify(tokens)}`);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string | undefined {
    const token = tokens[pos];
    console.log(`Consuming token at pos ${pos}: ${token}`);
    return tokens[pos++];
  }

  function parsePrimary(): ExprNode | null {
    const token = consume();
    if (!token) {
      console.log('No token in parsePrimary');
      return null;
    }

    if (isNumber(token)) {
      console.log(`Parsed number: ${token}`);
      return { value: Number(token) };
    }
    if (isString(token)) {
      const value = token.slice(1, -1);
      console.log(`Parsed string: ${value}`);
      return { value };
    }
    if (token === 'true') {
      console.log('Parsed boolean: true');
      return { value: true };
    }
    if (token === 'false') {
      console.log('Parsed boolean: false');
      return { value: false };
    }
    if (isIdentifier(token)) {
      if (peek() === '(') {
        // Function call
        console.log(`Parsing function call: ${token}`);
        consume(); // (
        const args: ExprNode[] = [];
        while (peek() !== ')' && peek() !== undefined) {
          const arg = parseExpressionPart();
          if (arg) {
            console.log(`Parsed arg for ${token}: ${JSON.stringify(arg)}`);
            args.push(arg);
          }
          if (peek() === ',') consume();
        }
        if (peek() === ')') consume();
        return { func: token, args };
      }
      console.log(`Parsed identifier: ${token}`);
      return { value: token };
    }
    if (token === '(') {
      const expr = parseExpressionPart();
      if (consume() !== ')') {
        console.log('Missing closing parenthesis');
        return null;
      }
      return expr;
    }
    console.log(`Invalid primary token: ${token}`);
    return null;
  }

  function parseUnary(): ExprNode | null {
    if (['!', '-'].includes(peek() || '')) {
      const op = consume() as Operator;
      console.log(`Parsing unary operator: ${op}`);
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
      console.log(`Parsing power operator: ${op}`);
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
      console.log(`Parsing multiplicative operator: ${op}`);
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
      console.log(`Parsing additive operator: ${op}`);
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
      console.log(`Parsing comparison operator: ${op}`);
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
      console.log(`Parsing logical operator: ${op}`);
      const right = parseComparison();
      if (!right) return null;
      left = { op, left, right };
    }
    return left;
  }

  function parseExpressionPart(): ExprNode | null {
    const result = parseLogical();
    console.log(`Parsed expression: ${JSON.stringify(result)}`);
    return result;
  }

  const tree = parseExpressionPart();
  if (pos !== tokens.length) {
    console.log(`Incomplete parse, remaining tokens: ${tokens.slice(pos)}`);
    return null;
  }
  console.log(`Final parsed tree: ${JSON.stringify(tree)}`);
  return tree;
}

function tokenizeExpr(expr: string): string[] {
  const tokens = expr.match(/("[^"]"|'[^']'|\d+|[a-zA-Z_]\w*|[&|!=><+*/%^(),-]+)/g) || [];
  console.log(`Tokenized expression '${expr}' to: ${JSON.stringify(tokens)}`);
  return tokens;
}

function isNumber(token: string): boolean {
  const isNum = /^\d+$/.test(token);
  console.log(`Checking if '${token}' is number: ${isNum}`);
  return isNum;
}

function isString(token: string): boolean {
  const isStr = (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));
  console.log(`Checking if '${token}' is string: ${isStr}`);
  return isStr;
}

function isIdentifier(token: string): boolean {
  const isId = /[a-zA-Z_]\w*/.test(token);
  console.log(`Checking if '${token}' is identifier: ${isId}`);
  return isId;
}

export function evalExpr(tree: ExprNode, context: any, errors: EvalError[], line: number): any {
  console.log(`Evaluating tree: ${JSON.stringify(tree)} with context: ${JSON.stringify(context)}`);
  if (tree.value !== undefined) {
    const value = context[tree.value] || tree.value;
    console.log(`Resolved value '${tree.value}' to: ${value}`);
    return value;
  }

  if (tree.func) {
    const args = tree.args?.map(a => evalExpr(a, context, errors, line)) || [];
    console.log(`Evaluating function '${tree.func}' with args: ${JSON.stringify(args)}`);

    if (tree.func === 'error') {
      return { type: 'error', message: args[0] };
    }

    if (tree.func === 'path') {
      if (args.length !== 3) {
        errors.push({
          type: 'runtime',
          message: 'path function requires 3 arguments (graph, start, end)',
          line,
          suggestedFix: 'Provide graph, start node, and end node'
        });
        console.log(`Error: path function requires 3 arguments, got ${args.length}`);
        return null;
      }
      const [graph, from, to] = args;
      console.log(`Path function: graph=${JSON.stringify(graph)}, from=${from}, to=${to}`);
      if (!(graph && graph.nodes instanceof Set && graph.edges instanceof Map && typeof from === 'string' && typeof to === 'string')) {
        errors.push({
          type: 'runtime',
          message: 'Invalid arguments for path function',
          line,
          suggestedFix: 'Ensure first argument is a graph and others are strings'
        });
        console.log('Error: Invalid path arguments');
        return null;
      }
      // BFS to find path
      const queue: string[] = [from];
      const visited = new Set<string>([from]);
      const parent = new Map<string, string | null>([[from, null]]);
      let found = false;
      console.log(`Starting BFS from ${from} to ${to}`);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        console.log(`Visiting node: ${curr}`);
        if (curr === to) {
          found = true;
          break;
        }
        const neighbors = Array.from(graph.edges.get(curr)?.values() || []) as string[];
        console.log(`Neighbors of ${curr}: ${neighbors}`);
        for (const neigh of neighbors) {
          if (!visited.has(neigh)) {
            console.log(`Adding neighbor ${neigh} to queue`);
            visited.add(neigh);
            queue.push(neigh);
            parent.set(neigh, curr);
          }
        }
      }
      if (!found) {
        console.log(`No path found from ${from} to ${to}`);
        return null;
      }
      // Reconstruct path
      const path: string[] = [];
      let curr: string | null = to;
      while (curr !== null) {
        path.unshift(curr);
        curr = parent.get(curr)!;
      }
      console.log(`Path found: ${path}`);
      return path;
    }

    errors.push({
      type: 'runtime',
      message: `Unknown function '${tree.func}'`,
      line,
      suggestedFix: 'Use supported functions like path or error'
    });
    console.log(`Error: Unknown function '${tree.func}'`);
    return null;
  }

  // Short-circuit for logical ops
  if (tree.op === '&&') {
    const left = tree.left ? evalExpr(tree.left, context, errors, line) : undefined;
    console.log(`Evaluating &&: left=${left}`);
    if (!left) return left;
    const right = tree.right ? evalExpr(tree.right, context, errors, line) : undefined;
    console.log(`&& right=${right}`);
    return right;
  }

  if (tree.op === '||') {
    const left = tree.left ? evalExpr(tree.left, context, errors, line) : undefined;
    console.log(`Evaluating ||: left=${left}`);
    if (left) return left;
    const right = tree.right ? evalExpr(tree.right, context, errors, line) : undefined;
    console.log(`|| right=${right}`);
    return right;
  }

  if (tree.op === '=>') {
    const left = tree.left ? evalExpr(tree.left, context, errors, line) : undefined;
    console.log(`Evaluating =>: left=${left}`);
    if (!left) return true;
    const right = tree.right ? evalExpr(tree.right, context, errors, line) : undefined;
    console.log(`=> right=${right}`);
    return right;
  }

  if (tree.op === '<=>') {
    const left = tree.left ? evalExpr(tree.left, context, errors, line) : undefined;
    const right = tree.right ? evalExpr(tree.right, context, errors, line) : undefined;
    console.log(`Evaluating <=>: left=${left}, right=${right}`);
    return !!left === !!right;
  }

  const leftVal = tree.left ? evalExpr(tree.left, context, errors, line) : undefined;
  const rightVal = tree.right ? evalExpr(tree.right, context, errors, line) : undefined;
  console.log(`Evaluating op '${tree.op}': left=${leftVal}, right=${rightVal}`);

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
        suggestedFix: 'Use a set or list for membership check'
      });
      console.log(`Error: Invalid 'in' operand, right=${rightVal}`);
      return false;
    case 'union':
      if (leftVal instanceof Set && rightVal instanceof Set) return new Set([...leftVal, ...rightVal]);
      errors.push({
        type: 'runtime',
        message: 'Operands of "union" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets'
      });
      console.log(`Error: Invalid 'union' operands, left=${leftVal}, right=${rightVal}`);
      return null;
    case 'intersect':
      if (leftVal instanceof Set && rightVal instanceof Set) return new Set([...leftVal].filter(x => rightVal.has(x)));
      errors.push({
        type: 'runtime',
        message: 'Operands of "intersect" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets'
      });
      console.log(`Error: Invalid 'intersect' operands, left=${leftVal}, right=${rightVal}`);
      return null;
    case 'diff':
      if (leftVal instanceof Set && rightVal instanceof Set) return new Set([...leftVal].filter(x => !rightVal.has(x)));
      errors.push({
        type: 'runtime',
        message: 'Operands of "diff" must be sets',
        line,
        suggestedFix: 'Ensure both operands are sets'
      });
      console.log(`Error: Invalid 'diff' operands, left=${leftVal}, right=${rightVal}`);
      return null;
    default:
      errors.push({
        type: 'runtime',
        message: `Unsupported operator '${tree.op}'`,
        line,
        suggestedFix: 'Check supported operators in NSML spec'
      });
      console.log(`Error: Unsupported operator '${tree.op}'`);
      return null;
  }
}