// src/resolver.ts - NSML Symbol Resolution

import { AstNode, SymbolTable, SymbolEntry, Graph, EvalError } from './types';

interface ResolveResult {
  symbols: SymbolTable;
  errors: EvalError[];
}

export function resolve(ast: AstNode): ResolveResult {
  const symbols: SymbolTable = new Map();
  const errors: EvalError[] = [];

  function resolveSymbols(node: AstNode) {
    if (node.type === 'symbols') {
      for (const child of node.children) {
        resolveSymbol(child, symbols, errors);
      }
    }
    // Recurse for nested (though NSML symbols are top-level, support for modularity)
    for (const child of node.children) {
      resolveSymbols(child);
    }
  }

  function resolveSymbol(node: AstNode, symbols: SymbolTable, errors: EvalError[]) {
    const name = node.attributes.name;
    if (!name) {
      errors.push({ type: 'semantic', message: 'Missing name attribute', line: node.line });
      return;
    }
    if (symbols.has(name)) {
      errors.push({ type: 'semantic', message: `Duplicate symbol '${name}'`, line: node.line });
      return;
    }

    let entry: SymbolEntry;
    switch (node.type) {
      case 'var':
        entry = {
          kind: 'var',
          type: node.attributes.type || 'any',
          value: parseValue(node.attributes.init || node.text || 'undefined', node.attributes.type),
          mutable: true,
        };
        break;
      case 'const':
        entry = {
          kind: 'const',
          type: node.attributes.type || 'any',
          value: parseValue(node.attributes.value || node.text || 'undefined', node.attributes.type),
          mutable: false,
        };
        break;
      case 'set':
        entry = {
          kind: 'set',
          type: 'set',
          value: new Set(node.attributes.elements?.split(',').map(v => parseValue(v.trim(), 'any')) || []),
          mutable: true,
        };
        break;
      case 'graph':
        const graph: Graph = { nodes: new Set(), edges: new Map() };
        node.attributes.nodes?.split(',').forEach(n => graph.nodes.add(n.trim()));
        node.attributes.edges?.split(',').forEach(e => {
          const [from, rel, to] = e.split('->').map(s => s.trim());
          if (!graph.edges.has(from)) graph.edges.set(from, new Map());
          graph.edges.get(from)!.set(rel, to);
        });
        entry = { kind: 'graph', type: 'graph', value: graph, mutable: true };
        break;
      case 'entity':
        const props: Record<string, any> = {};
        node.attributes.props?.split(',').forEach(p => {
          const [key, val] = p.split('=').map(s => s.trim());
          props[key] = parseValue(val?.slice(1, -1) || val, 'any');  // Handle quotes
        });
        entry = { kind: 'entity', type: 'object', value: props, mutable: true };
        break;
      default:
        errors.push({ type: 'semantic', message: `Unknown symbol type '${node.type}'`, line: node.line });
        return;
    }

    // Basic type check (expand later)
    if (entry.type !== 'any' && typeof entry.value !== entry.type) {
      errors.push({ type: 'semantic', message: `Type mismatch for '${name}'`, line: node.line });
    }

    symbols.set(name, entry);
  }

  function parseValue(val: string, type: string): any {
    if (val === 'undefined') return undefined;
    switch (type) {
      case 'number': return parseFloat(val);
      case 'boolean': return val.toLowerCase() === 'true';
      default: return val;  // String or complex
    }
  }

  resolveSymbols(ast);
  return { symbols, errors };
}