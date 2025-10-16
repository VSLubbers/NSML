// src/types.ts - Core interfaces and types for NSML Parser

/**
 * AST Node: Represents parsed elements from NSML markup.
 */
export interface AstNode {
  type: string; // e.g., 'var', 'rule', 'query'
  attributes: Record<string, string>; // e.g., { name: 'x', type: 'number' }
  children: AstNode[]; // Nested nodes
  text?: string; // Content between tags
  line: number; // For error reporting
}

/**
 * Allowed Symbol Types: Literal union for validation.
 */
export const allowedSymbolTypes = [
  'number',
  'string',
  'boolean',
  'list',
  'set',
  'graph',
  'object',
  'any',
] as const;
export type SymbolType = (typeof allowedSymbolTypes)[number];

/**
 * Symbol Entry: Details for a symbol (var, const, etc.).
 */
export interface SymbolEntry {
  kind: 'var' | 'const' | 'set' | 'graph' | 'entity';
  type: SymbolType; // Use extracted type
  value: any; // Dynamic: number, string, Set<any>, Graph, etc.
  mutable: boolean;
}

/**
 * Symbol Table: Maps symbol names to entries.
 */
export type SymbolTable = Map<string, SymbolEntry>;

/**
 * Graph Structure: For <graph> elements.
 */
export interface Graph {
  nodes: Set<string>;
  edges: Map<string, Map<string, string>>; // from -> {relation -> to}
}

/**
 * Expression Operators: Supported ops in expressions.
 */
export type Operator =
  | '&&'
  | '||'
  | '!'
  | '=>'
  | '<=>'
  | '=='
  | '!=' // Logical
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '>='
  | '<='
  | '>'
  | '<' // Arithmetic
  | 'in'
  | 'union'
  | 'intersect'
  | 'diff'
  | 'path'; // Set/Graph

/**
 * Expression Node: Tree for parsed expressions.
 */
export interface ExprNode {
  op?: Operator;
  left?: ExprNode;
  right?: ExprNode;
  value?: any; // Literal or symbol reference
  func?: string; // For function calls like error(...)
  args?: ExprNode[]; // Arguments for functions
  line?: number; // Added for error reporting in eval
}

/**
 * Evaluation Error: Structured error details.
 */
export interface EvalError {
  type: 'syntax' | 'semantic' | 'runtime';
  message: string;
  suggestedFix?: string;
  line?: number;
}

/**
 * Evaluation Result: Output from parser/evaluator.
 */
export interface EvalResult {
  results: Record<string, any>; // Query names to values
  errors: EvalError[]; // Array of errors
  trace?: string[]; // Optional simulation trace
}

/**
 * Token: Basic unit from lexing, with type, value, and position.
 */
export interface Token {
  type:
    | 'openTag'
    | 'closeTag'
    | 'selfClose'
    | 'attribute'
    | 'text'
    | 'operator'
    | 'comment'
    | 'eof';
  value: string;
  line: number;
  column: number;
}

/**
 * Domain Registry: Maps domain tag types to handlers.
 */
export type DomainRegistry = Map<
  string,
  (node: AstNode, context: SymbolTable) => { result: any; error?: EvalError }
>;
