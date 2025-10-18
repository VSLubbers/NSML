import {
  AstNode,
  SymbolTable,
  SymbolEntry,
  Graph,
  EvalError,
  allowedSymbolTypes,
  SymbolType,
} from './types';

interface ResolveResult {
  symbols: SymbolTable;
  errors: EvalError[];
}

export function resolve(
  ast: AstNode | null,
  namespace: string = ''
): ResolveResult {
  const symbols: SymbolTable = new Map();
  const errors: EvalError[] = [];

  if (!ast) {
    errors.push({
      type: 'semantic',
      message: 'Invalid or null AST from parser',
      suggestedFix: 'Check parsing stage for errors',
    });
    return { symbols, errors };
  }

  function resolveSymbols(node: AstNode | null) {
    if (!node) return;

    if (node.type === 'symbols') {
      for (const child of node.children) {
        resolveSymbol(child, symbols, errors);
      }
    }
    for (const child of node.children) {
      resolveSymbols(child);
    }
  }

  function resolveSymbol(
    node: AstNode,
    symbols: SymbolTable,
    errors: EvalError[]
  ) {
    const origName = node.attributes.name;
    if (!origName) {
      errors.push({
        type: 'semantic',
        message: 'Missing name attribute',
        line: node.line,
        suggestedFix: 'Add name="..." to the element',
      });
      return;
    }
    const name = namespace ? `${namespace}.${origName}` : origName;

    if (symbols.has(name)) {
      errors.push({
        type: 'semantic',
        message: `Duplicate symbol '${name}'`,
        line: node.line,
        suggestedFix: 'Rename or remove duplicate',
      });
      return;
    }

    const attrType = node.attributes.type;
    let resolvedType: SymbolType = 'any';
    if (attrType) {
      if (allowedSymbolTypes.includes(attrType as SymbolType)) {
        resolvedType = attrType as SymbolType;
      } else {
        errors.push({
          type: 'semantic',
          message: `Invalid type '${attrType}' for '${name}'`,
          line: node.line,
          suggestedFix: `Use one of: ${allowedSymbolTypes.join(', ')}`,
        });
        return;
      }
    }

    let entry: SymbolEntry;
    switch (node.type) {
      case 'var':
        entry = {
          kind: 'var',
          type: resolvedType,
          value: parseValue(
            node.attributes.init || node.text || 'undefined',
            resolvedType,
            symbols,
            errors,
            node.line
          ),
          mutable: true,
        };
        break;
      case 'const':
        entry = {
          kind: 'const',
          type: resolvedType,
          value: parseValue(
            node.attributes.value || node.text || 'undefined',
            resolvedType,
            symbols,
            errors,
            node.line
          ),
          mutable: false,
        };
        break;
      case 'set':
        entry = {
          kind: 'set',
          type: 'set',
          value: new Set(
            node.attributes.elements
              ?.split(',')
              .map((v) =>
                parseValue(v.trim(), 'number', symbols, errors, node.line)
              ) || []
          ),
          mutable: true,
        };
        break;
      case 'graph':
        const graph: Graph = { nodes: new Set(), edges: new Map() };
        // Treat nodes as string literals, not references
        node.attributes.nodes
          ?.split(',')
          .forEach((n) => graph.nodes.add(n.trim()));
        node.attributes.edges?.split(',').forEach((e) => {
          const parts = e.split('->');
          if (parts.length < 2 || parts.length > 3) {
            errors.push({
              type: 'semantic',
              message: `Invalid edge format '${e}' in graph '${name}'`,
              line: node.line,
              suggestedFix: 'Use from->to or from->relation->to',
            });
            return;
          }
          const from = parts[0].trim();
          const relation = parts.length === 3 ? parts[1].trim() : 'to';
          const to = parts[parts.length - 1].trim();
          // Add nodes to graph.nodes if not already present
          graph.nodes.add(from);
          graph.nodes.add(to);
          if (!graph.edges.has(from)) {
            graph.edges.set(from, new Map());
          }
          graph.edges.get(from)!.set(relation, to);
        });
        entry = { kind: 'graph', type: 'graph', value: graph, mutable: true };
        break;
      case 'entity':
        const props: Record<string, any> = {};
        node.attributes.props
          ?.split(',')
          .forEach((p) => {
            const [key, val] = p.split('=').map((s) => s.trim());
            if (!key || !val) {
              errors.push({
                type: 'semantic',
                message: `Invalid prop '${p}' in entity '${name}'`,
                line: node.line,
                suggestedFix: 'Use format key=value',
              });
              return;
            }
            // For entity props, use 'any' type to allow flexible literals
            props[key] = parseValue(val, 'any', symbols, errors, node.line);
          });
        entry = { kind: 'entity', type: 'object', value: props, mutable: true };
        break;
      default:
        errors.push({
          type: 'semantic',
          message: `Unknown symbol type '${node.type}'`,
          line: node.line,
          suggestedFix: 'Use valid symbol tag like <var> or <const>',
        });
        return;
    }

    // Basic type check (only for primitives)
    if (
      entry.type !== 'any' &&
      ['number', 'string', 'boolean'].includes(entry.type) &&
      typeof entry.value !== entry.type
    ) {
      // Skip type mismatch error if already reported as invalid number
      if (!(entry.type === 'number' && isNaN(entry.value))) {
        errors.push({
          type: 'semantic',
          message: `Type mismatch for '${name}'`,
          line: node.line,
          suggestedFix: `Change value to match type '${entry.type}'`,
        });
      }
    }

    symbols.set(name, entry);
  }

  resolveSymbols(ast);
  return { symbols, errors };
}

export function parseValue(
  val: string,
  type: SymbolType,
  symbols: SymbolTable,
  errors: EvalError[],
  line: number
): any {
  if (val === 'undefined') return undefined;

  // Handle quoted strings as literals
  if (val.startsWith('"') || val.startsWith("'")) {
    const stripped = val.slice(1, -1);
    return stripped; // Return as string literal, no further reference checking
  }

  // Check if it's a reference (identifier pattern)
  if (isIdentifier(val)) {
    if (symbols.has(val)) {
      const refEntry = symbols.get(val)!;
      // Basic type compatibility if specified
      if (type !== 'any' && refEntry.type !== type) {
        errors.push({
          type: 'semantic',
          message: `Reference type mismatch for '${val}' (expected ${type}, got ${refEntry.type})`,
          line,
          suggestedFix: 'Ensure referenced symbol matches type',
        });
        return undefined;
      }
      return refEntry.value;
    } else {
      errors.push({
        type: 'semantic',
        message: `Unresolved reference '${val}'`,
        line,
        suggestedFix: 'Define the symbol before referencing it',
      });
      return undefined;
    }
  }

  // Parse as literal based on type
  switch (type) {
    case 'number':
      const num = parseFloat(val);
      if (isNaN(num)) {
        errors.push({
          type: 'semantic',
          message: `Invalid number value '${val}'`,
          line,
          suggestedFix: 'Provide a valid number',
        });
        return undefined;
      }
      return num;
    case 'boolean':
      if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') {
        return val.toLowerCase() === 'true';
      }
      errors.push({
        type: 'semantic',
        message: `Invalid boolean value '${val}'`,
        line,
        suggestedFix: 'Use true or false',
      });
      return undefined;
    default:
      return val; // Treat as string literal for 'any' or other types
  }
}

function isIdentifier(token: string): boolean {
  return /^[a-zA-Z_][\w.]*$/.test(token); // Allow dotted
}