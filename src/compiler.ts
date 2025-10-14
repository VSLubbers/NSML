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
    errors.push({ type: 'semantic', message: 'Invalid AST', suggestedFix: 'Check NSML input for syntax errors' });
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

  function compileRule(node: AstNode, rules: Map<string, Function>, exprTrees: Map<string, ExprNode>, errors: EvalError[]) {
    const name = node.attributes.name || `anonymous${anonymousCount++}`;
    const exprStr = node.text || node.attributes.body || '';

    const tree = parseExpression(exprStr);
    if (!tree) {
      errors.push({ type: 'syntax', message: `Invalid expression in '${name}'`, line: node.line, suggestedFix: 'Verify operators and parentheses in expression' });
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
      return evalExpr(tree, {...symbolValues, ...paramContext});
    };

    rules.set(name, func);
  }

  compileNode(ast);
  return { rules, exprTrees, errors };
}

export function parseExpression(expr: string): ExprNode | null {
  const tokens = tokenizeExpr(expr);
  let pos = 0;

  function consume(): string | undefined {
    return tokens[pos++];
  }

  function peek(): string | undefined {
    return tokens[pos];
  }

  function parsePrimary(): ExprNode | null {
    let token = consume();
    if (token === undefined) return null;
    if (isNumber(token)) return { value: token };
    if (isString(token)) return { value: token.slice(1, -1) };
    if (isIdentifier(token)) {
      if (peek() === '(') {
        consume();  // (
        const args: ExprNode[] = [];
        while (peek() !== ')' && peek() !== undefined) {
          const arg = parseExpressionPart();
          if (!arg) return null;
          args.push(arg);
          if (peek() === ',') consume();
        }
        if (consume() !== ')') return null;
        return { func: token, args };
      }
      return { value: token };
    }
    if (token === '(') {
      const expr = parseExpressionPart();
      if (consume() !== ')') return null;
      return expr;
    }
    return null;
  }

  function parseUnary(): ExprNode | null {
    const token = peek();
    if (['!', '-'].includes(token || '')) {
      consume();
      const right = parseUnary();
      if (!right) return null;
      return { op: token as Operator, right };
    }
    return parsePrimary();
  }

  function parseMulDiv(): ExprNode | null {
    let left = parseUnary();
    if (!left) return null;
    while (['*', '/', '%'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseUnary();
      if (!right) return null;
      left = { op, left, right };
    }
    return left;
  }

  function parseAddSub(): ExprNode | null {
    let left = parseMulDiv();
    if (!left) return null;
    while (['+', '-'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseMulDiv();
      if (!right) return null;
      left = { op, left, right };
    }
    return left;
  }

  function parseComparison(): ExprNode | null {
    let left = parseAddSub();
    if (!left) return null;
    while (['==', '!=', '>', '<', '>=', '<=', 'in'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseAddSub();
      if (!right) return null;
      left = { op, left, right };
    }
    return left;
  }

  function parseLogical(): ExprNode | null {
    let left = parseComparison();
    if (!left) return null;
    while (['&&', '||', '=>'].includes(peek() || '')) {
      const op = consume() as Operator;
      const right = parseComparison();
      if (!right) return null;
      left = { op, left, right };
    }
    return left;
  }

  function parseExpressionPart(): ExprNode | null {
    return parseLogical();
  }

  const tree = parseExpressionPart();
  if (pos !== tokens.length) return null;
  return tree;
}

function tokenizeExpr(expr: string): string[] {
  // Match multi-char operators first
  return expr.match(/("[^"]*"|'[^']*'|\d+|[a-zA-Z_]\w*|>=|<=|==|!=|=>|<=>|&&|\||[!+*/%^(),-<>])/g) || [];
}

function isNumber(token: string): boolean {
  return /\d+/.test(token);
}

function isString(token: string): boolean {
  return (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));
}

function isIdentifier(token: string): boolean {
  return /[a-zA-Z_]\w*/.test(token);
}

function evalExpr(tree: ExprNode, context: any): any {
  if (tree.value !== undefined) return context[tree.value] || tree.value;
  if (tree.func) {
    const args = tree.args?.map(a => evalExpr(a, context)) || [];
    if (tree.func === 'error') {
      return { type: 'error', message: args[0] };
    }
    return null;
  }
  // Short-circuit for logical ops
  if (tree.op === '&&') {
    const left = tree.left ? evalExpr(tree.left, context) : undefined;
    if (!left) return left;
    return tree.right ? evalExpr(tree.right, context) : undefined;
  }
  if (tree.op === '||') {
    const left = tree.left ? evalExpr(tree.left, context) : undefined;
    if (left) return left;
    return tree.right ? evalExpr(tree.right, context) : undefined;
  }
  if (tree.op === '=>') {
    const left = tree.left ? evalExpr(tree.left, context) : undefined;
    if (!left) return true;
    return tree.right ? evalExpr(tree.right, context) : undefined;
  }
  const left = tree.left ? evalExpr(tree.left, context) : undefined;
  const right = tree.right ? evalExpr(tree.right, context) : undefined;
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
    default: return null;
  }
}