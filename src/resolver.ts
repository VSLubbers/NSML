// src/resolver.ts - NSML Symbol Resolution

import { AstNode, SymbolTable, SymbolEntry, Graph, EvalError, allowedSymbolTypes, SymbolType } from './types';

interface ResolveResult {
  symbols: SymbolTable;
  errors: EvalError[];
}

export function resolve(ast: AstNode | null): ResolveResult {
  const symbols: SymbolTable = new Map();
  const errors: EvalError[] = [];

  if (!ast) {
    errors.push({ type: 'semantic', message: 'Invalid or null AST from parser' });
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

    const attrType = node.attributes.type;
    let resolvedType: SymbolType = 'any';
    if (attrType) {
      if (allowedSymbolTypes.includes(attrType as SymbolType)) {
        resolvedType = attrType as SymbolType;
      } else {
        errors.push({ type: 'semantic', message: `Invalid type '${attrType}' for '${name}'`, line: node.line });
        return;
      }
    }

    let entry: SymbolEntry;
    switch (node.type) {
      case 'var':
        entry = {
          kind: 'var',
          type: resolvedType,
          value: parseValue(node.attributes.init || node.text || 'undefined', resolvedType),
          mutable: true,
        };
        break;
      case 'const':
        entry = {
          kind: 'const',
          type: resolvedType,
          value: parseValue(node.attributes.value || node.text || 'undefined', resolvedType),
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
          p = p.trim();
          if (!p) return;  // Skip empty
          const splitParts = p.split('=');
          const key = splitParts[0].trim();
          const val = splitParts[1]?.trim();  // ? for undefined
          if (!key || val === undefined) {
            errors.push({ type: 'semantic', message: `Invalid prop '${p}' for '${name}'`, line: node.line });
            return;
          }
          let stripped = val;
          if (val.startsWith('"') || val.startsWith("'")) {
            stripped = val.slice(1, -1);
          }
          props[key] = parseValue(stripped, 'any');
        });
        entry = { kind: 'entity', type: 'object', value: props, mutable: true };
        break;
      default:
        errors.push({ type: 'semantic', message: `Unknown symbol type '${node.type}'`, line: node.line });
        return;
    }

    // Basic type check (only for primitives)
    if (entry.type !== 'any' && ['number', 'string', 'boolean'].includes(entry.type) && typeof entry.value !== entry.type) {
      errors.push({ type: 'semantic', message: `Type mismatch for '${name}'`, line: node.line });
    }

    symbols.set(name, entry);
  }

  function parseValue(val: string, type: SymbolType): any {
    if (val === 'undefined') return undefined;
    switch (type) {
      case 'number': return parseFloat(val);
      case 'boolean': return val.toLowerCase() === 'true';
      default: return val;
    }
  }

  resolveSymbols(ast);
  return { symbols, errors };
}