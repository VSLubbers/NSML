# NSML Developer Guide

Version: 1.0  
Author: V. S. Lubbers  
License: Apache 2.0  

## 1. Purpose

This document describes the internal development structure, contribution workflow, and design conventions for the **Neuro-Symbolic Markup Language (NSML)** project.  
It is intended for engineers extending the NSML engine, maintaining the codebase, or implementing new domain modules.


## 2. Repository Structure

```
nsml/
├── src/
│   ├── lexer.ts
│   ├── parser.ts
│   ├── resolver.ts
│   ├── compiler.ts
│   ├── evaluator.ts
│   ├── domains/
│   │   ├── core.ts
│   │   ├── math.ts
│   │   ├── logic.ts
│   │   └── ...
│   └── utils/
│       ├── errors.ts
│       ├── types.ts
│       ├── graph.ts
│       ├── logging.ts
│       └── tracing.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── regression/
├── docs/
│   ├── language-spec.md
│   ├── architecture.md
│   ├── integration-guide.md
│   └── developer-guide.md
├── examples/
│   ├── arithmetic.nsml
│   ├── logic.nsml
│   └── counterfactual.nsml
├── package.json
├── tsconfig.json
└── README.md
````

Each module is isolated and independently testable.  
There are **no runtime side effects** at import time — the entire system is functionally pure.

## 3. Development Environment

### 3.1 Requirements

- Node.js ≥ 18  
- TypeScript ≥ 5.0  
- Jest ≥ 29 for testing  
- ESLint + Prettier for static analysis  

### 3.2 Setup

```bash
git clone https://github.com/VSLubbers/NSML.git
cd NSML
npm install
npm run build
npm test
````

### 3.3 Build Targets

| Command         | Description                            |
| --------------- | -------------------------------------- |
| `npm run build` | Compile TypeScript to `/dist`          |
| `npm run test`  | Run all tests                          |
| `npm run lint`  | Lint codebase                          |
| `npm run watch` | Continuous rebuild during development  |
| `npm run docs`  | Generate Markdown → HTML documentation |

## 4. Code Conventions

### 4.1 Language and Style

* Strict **TypeScript** only — no implicit `any`.
* Functional purity: no global mutable state.
* Prefer immutability over mutation (`const` by default).
* Deterministic output: no reliance on `Date`, `Math.random()`, or environment state.
* Use JSDoc annotations for all exported functions.

### 4.2 Naming Conventions

| Entity     | Convention       | Example           |
| ---------- | ---------------- | ----------------- |
| Modules    | lowerCamelCase   | `lexer.ts`        |
| Classes    | PascalCase       | `ASTNode`         |
| Functions  | lowerCamelCase   | `parseTokens()`   |
| Interfaces | PascalCase       | `SymbolTable`     |
| Constants  | UPPER_SNAKE_CASE | `DEFAULT_VERSION` |

### 4.3 File Headers

Each source file should begin with:

```ts
/**
 * @file lexer.ts
 * @brief Tokenizes NSML markup into a stream of lexical tokens.
 * @license Apache-2.0
 */
```

## 5. Internal APIs

### 5.1 Module Entry Points

```ts
// src/index.ts
export { lex } from "./lexer";
export { parse } from "./parser";
export { resolve } from "./resolver";
export { compile } from "./compiler";
export { evaluate } from "./evaluator";
export { registerDomain } from "./domains/core";
export { errors } from "./utils/errors";
```

The public API intentionally mirrors the internal pipeline.
Additional helper functions are re-exported through `utils`.

### 5.2 Data Structures

#### Token

```ts
interface Token {
  type: string;
  value: string;
  position: { line: number; column: number };
}
```

#### ASTNode

```ts
interface ASTNode {
  type: string;
  name?: string;
  attributes?: Record<string, string>;
  children?: ASTNode[];
  content?: string;
  position?: { line: number; column: number };
}
```

#### SymbolTable

```ts
interface SymbolEntry {
  name: string;
  type: string;
  value?: any;
  scope: "global" | "local" | "counterfactual";
}

type SymbolTable = Record<string, SymbolEntry>;
```

#### CompiledNode

```ts
interface CompiledNode {
  id: string;
  type: "rule" | "query" | "assert" | "symbol";
  evaluate: (ctx: EvaluationContext) => any;
  dependencies: string[];
}
```


## 6. Evaluation Context Lifecycle

Each NSML document goes through a deterministic five-stage pipeline:

1. **Lexing** – tokenization of input markup
2. **Parsing** – AST construction
3. **Resolution** – symbol binding and scope validation
4. **Compilation** – functional transformation into executable nodes
5. **Evaluation** – computation and trace generation

Example lifecycle in code:

```ts
function runNSML(input: string): EvaluationResult {
  const tokens = lex(input);
  const ast = parse(tokens);
  const { symbols } = resolve(ast);
  const compiled = compile(ast, symbols);
  return evaluate(compiled);
}
```

## 7. Error Model

All internal errors extend from a base `NSMLError` class.

```ts
class NSMLError extends Error {
  constructor(
    public type: string,
    public message: string,
    public position?: { line: number; column: number }
  ) {
    super(message);
  }
}
```

Subclasses include:

* `LexicalError`
* `SyntaxError`
* `ResolutionError`
* `TypeError`
* `CompilationError`
* `EvaluationError`

**Design guideline:**
Do not throw untyped errors. Always use one of the structured subclasses.

## 8. Logging and Tracing

Tracing is optional but must be non-intrusive.

All trace statements use the unified logger in `utils/logging.ts`:

```ts
log.trace("Bind variable", { name: "x", value: 10 });
log.debug("Execute rule", { rule: "adultRule" });
log.error("Assertion failed", { name: "nonNegative" });
```

The logger interface:

```ts
interface Logger {
  trace(msg: string, data?: any): void;
  debug(msg: string, data?: any): void;
  error(msg: string, data?: any): void;
}
```

Implementations can route output to console, file, or in-memory trace collector.

## 9. Domain Extension Framework

### 9.1 Overview

Domain modules extend NSML by introducing custom tags and evaluation logic.
Each domain registers a `DomainHandler` through the central registry.

### 9.2 Registration API

```ts
interface DomainHandler {
  parse?: (node: ASTNode, ctx: DomainContext) => ASTNode;
  evaluate: (node: ASTNode, ctx: EvaluationContext) => any;
}

function registerDomain(tag: string, handler: DomainHandler): void;
```

### 9.3 Example

```ts
registerDomain("math", {
  evaluate(node, ctx) {
    const expr = node.attributes?.expr;
    return Function("symbols", `with(symbols){return ${expr}}`)(ctx.symbols);
  }
});
```

### 9.4 Testing Domains

Domain modules must include dedicated tests in `tests/domains/<domain>.test.ts`.
Each test verifies:

* Proper tag parsing
* Deterministic evaluation
* Type correctness
* Error recovery behavior

## 10. Testing Standards

### 10.1 Framework

* Unit tests: **Jest**
* Coverage target: **≥ 95% line coverage**
* No reliance on random or time-dependent values

### 10.2 Test Directory Layout

```
tests/
├── lexer.test.ts
├── parser.test.ts
├── resolver.test.ts
├── compiler.test.ts
├── evaluator.test.ts
└── domains/
```

### 10.3 Golden Files

Integration tests compare outputs against precomputed “golden” JSON snapshots:

```ts
expect(result).toMatchSnapshot();
```

To update golden files:

```bash
npm run test -- -u
```

## 11. Performance and Optimization

### 11.1 Complexity Targets

| Stage     | Expected Complexity | Notes                         |
| --------- | ------------------- | ----------------------------- |
| Lexer     | O(n)                | Linear in characters          |
| Parser    | O(n)                | Linear in tokens              |
| Resolver  | O(n + e)            | n = symbols, e = edges        |
| Compiler  | O(n)                | Precomputed closures          |
| Evaluator | O(d)                | d = depth of dependency graph |

### 11.2 Memory Targets

* Core runtime: ≤ 50 KB minified
* Evaluation context: ≤ 10 MB per document (typical)
* Domain extensions: isolated memory scopes

### 11.3 Optimization Guidelines

* Avoid deep recursion in expression evaluation
* Cache resolved types and constant expressions
* Use immutable data structures for context propagation
* Avoid runtime code generation except in isolated sandboxed domains

## 12. Contribution Workflow

### 12.1 Branching Model

* `main` — stable release branch
* `dev` — integration branch for feature PRs
* Feature branches follow: `feature/<topic>`
* Bugfix branches follow: `fix/<issue>`

### 12.2 Pull Request Requirements

* Reference related issue
* Include tests and documentation updates
* Pass linting and all CI checks
* Adhere to code conventions

### 12.3 Commit Format

Follow **Conventional Commits**:

```
feat(parser): support counterfactual scope shadowing
fix(lexer): handle multiline attributes
docs(language-spec): clarify EBNF expression rules
```

### 12.4 Code Review Criteria

Reviewers evaluate:

* Determinism of outputs
* Test coverage
* API stability
* Performance impact
* Backward compatibility

## 13. Release Process

1. Ensure all tests pass on `main`
2. Update version in `package.json`
3. Regenerate documentation (`npm run docs`)
4. Create Git tag `vX.Y.Z`
5. Publish to npm:

   ```bash
   npm publish --access public
   ```
6. Push tag to GitHub for release automation

Releases must include changelog updates in `CHANGELOG.md`.

## 14. Extensibility Guidelines

When adding new features or modules:

* Maintain functional purity (no global mutable state).
* Ensure backward compatibility in public APIs.
* Document all new attributes or tags in `language-spec.md`.
* Provide an example in `examples/`.
* Add test coverage for edge cases and invalid input.

**Rule:** No change is accepted without corresponding documentation and tests.

## 15. Security Considerations

* Never use direct `eval()` on user input outside controlled domain handlers.
* All dynamic evaluation must be sandboxed.
* Avoid filesystem or network access in evaluator modules.
* Validate untrusted input using XML schema validation where applicable.
* Use strict type enforcement in all interfaces.

## 16. Documentation Standards

All documentation is written in **Markdown** and stored in `/docs`.
Diagrams (if added) should be rendered as ASCII blocks or embedded SVGs for portability.

Use consistent section numbering, heading style, and tone.
Avoid informal language or emoticons in any developer-facing documentation.

## 17. Roadmap for Contributors

| Area                     | Planned Development                               |
| ------------------------ | ------------------------------------------------- |
| Probabilistic Evaluation | Extend rule engine with weighted inference        |
| Graph Queries            | Integrate SPARQL subset for `<graph>` reasoning   |
| Temporal Logic           | Add time-indexed variable evaluation              |
| Streaming Parser         | Enable incremental input evaluation               |
| LSP Integration          | Provide syntax highlighting and schema validation |
| Visualization            | Add web-based AST and trace viewer                |

## 18. Summary

The NSML development framework is designed around **clarity, determinism, and modularity**.
Every contribution should enhance one of the following properties:

* Predictable, side-effect-free computation
* Extensible design through domain registration
* Transparent evaluation and debugging
* Robust test and documentation coverage