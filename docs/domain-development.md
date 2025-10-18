# NSML Domain Development Guide

Version: 1.0  
Author: V. S. Lubbers  
License: Apache 2.0  

## 1. Purpose

This document specifies how to design, implement, and maintain **domain modules** for the **Neuro-Symbolic Markup Language (NSML)** runtime.  
Domains extend NSML with custom tags, evaluators, and reasoning primitives that integrate seamlessly into the core pipeline.

A domain defines *semantic behavior* for a set of markup constructs (e.g., `<math>`, `<logic>`, `<query>`) and exposes a consistent API to the NSML engine.

## 2. Conceptual Overview

### 2.1 Domain Definition

A **domain** is a pluggable module that registers one or more **tag handlers** implementing domain-specific semantics.  
Handlers control how NSML interprets, resolves, and evaluates those tags during execution.

Each domain module exports a `DomainHandler` object that includes:

```ts
interface DomainHandler {
  parse?: (node: ASTNode, ctx: DomainContext) => ASTNode;
  resolve?: (node: ASTNode, ctx: DomainContext) => void;
  evaluate: (node: ASTNode, ctx: EvaluationContext) => any;
}
````

Domains are registered dynamically using the `registerDomain()` function:

```ts
import { registerDomain } from "nsml";

registerDomain("math", mathDomainHandler);
```

## 3. Domain Lifecycle and Integration Points

A domain integrates into the five-stage NSML pipeline through well-defined hooks:

| Stage           | Hook         | Purpose                                    |
| --------------- | ------------ | ------------------------------------------ |
| **Lexing**      | —            | Domains do not modify tokenization         |
| **Parsing**     | `parse()`    | Transform raw nodes, inject sub-structures |
| **Resolution**  | `resolve()`  | Bind symbols or define scope semantics     |
| **Compilation** | —            | (Optional) influence symbol emission       |
| **Evaluation**  | `evaluate()` | Implement runtime behavior                 |

Each hook is optional, but at least one (`evaluate`) must be defined.

## 4. Domain Context Interfaces

### 4.1 DomainContext

```ts
interface DomainContext {
  symbols: SymbolTable;
  parent?: DomainContext;
  registerSymbol: (entry: SymbolEntry) => void;
  resolveSymbol: (name: string) => SymbolEntry | undefined;
  trace: (msg: string, data?: any) => void;
}
```

Used during `parse` and `resolve` phases for scope manipulation and symbol registration.

### 4.2 EvaluationContext

```ts
interface EvaluationContext {
  symbols: Record<string, any>;
  call: (fn: string, ...args: any[]) => any;
  evaluate: (node: ASTNode) => any;
  trace: (msg: string, data?: any) => void;
}
```

Provided to the `evaluate()` hook to perform runtime computation.

## 5. Domain Module Structure

A typical domain is implemented as a self-contained file under `src/domains/`.

Example:

```
src/domains/
├── math.ts
├── logic.ts
├── query.ts
└── finance.ts
```

Each file exports one or more handlers and registers them with the runtime.

Example structure:

```ts
// src/domains/math.ts
import { registerDomain } from "../domains/core";

export const mathDomain = {
  evaluate(node, ctx) {
    const expr = node.attributes?.expr;
    if (!expr) throw new Error("Missing 'expr' attribute");
    return Function("symbols", `with(symbols){return ${expr}}`)(ctx.symbols);
  },
};

registerDomain("math", mathDomain);
```

## 6. Domain Tag Design

### 6.1 Tag Naming

* Tags must be **lowercase** and **namespace-prefixed** if domain-specific.
  Example: `<math:expr>`, `<logic:assert>`, `<finance:rate>`.
* Avoid reserved core tags: `nsml`, `define`, `assert`, `query`, `scope`.

### 6.2 Attributes

Attributes define declarative parameters for evaluation.
Convention:

* Boolean attributes: `"true"` / `"false"` strings.
* Numeric attributes: stringified numbers parsed at runtime.
* Expressions: use the domain's own syntax (e.g., JavaScript for `<math>`, propositional logic for `<logic>`).

### 6.3 Children

Child nodes represent nested computations or logical dependencies.
For example:

```xml
<logic:and>
  <logic:expr expr="A"/>
  <logic:expr expr="B"/>
</logic:and>
```

## 7. Example: Mathematical Domain

### 7.1 Definition

```ts
// src/domains/math.ts
export const mathDomain = {
  evaluate(node, ctx) {
    switch (node.name) {
      case "math:expr": {
        const expr = node.attributes?.expr ?? "";
        return Function("symbols", `with(symbols){return ${expr}}`)(ctx.symbols);
      }
      case "math:add": {
        const values = node.children?.map(c => ctx.evaluate(c)) ?? [];
        return values.reduce((a, b) => a + b, 0);
      }
      case "math:mul": {
        const values = node.children?.map(c => ctx.evaluate(c)) ?? [];
        return values.reduce((a, b) => a * b, 1);
      }
      default:
        throw new Error(`Unknown math tag: ${node.name}`);
    }
  },
};
```

### 7.2 Registration

```ts
import { registerDomain } from "../domains/core";
registerDomain("math", mathDomain);
```

### 7.3 Example Usage

```xml
<nsml>
  <math:add>
    <math:expr expr="2 + 3"/>
    <math:expr expr="x"/>
  </math:add>
</nsml>
```

Result when evaluated with `{ x: 5 }`:
→ `10`

## 8. Example: Logic Domain

### 8.1 Definition

```ts
// src/domains/logic.ts
export const logicDomain = {
  evaluate(node, ctx) {
    switch (node.name) {
      case "logic:and":
        return node.children?.every(c => ctx.evaluate(c));
      case "logic:or":
        return node.children?.some(c => ctx.evaluate(c));
      case "logic:not":
        return !ctx.evaluate(node.children?.[0]);
      case "logic:expr":
        const expr = node.attributes?.expr ?? "";
        return Function("symbols", `with(symbols){return ${expr}}`)(ctx.symbols);
      default:
        throw new Error(`Unknown logic tag: ${node.name}`);
    }
  },
};
```

### 8.2 Example Usage

```xml
<logic:and>
  <logic:expr expr="x > 0"/>
  <logic:expr expr="x < 10"/>
</logic:and>
```

Evaluates to `true` when `0 < x < 10`.

## 9. Domain Error Handling

All domain-specific exceptions must derive from `NSMLError`:

```ts
import { NSMLError } from "../utils/errors";

class MathEvaluationError extends NSMLError {
  constructor(message, position) {
    super("MathEvaluationError", message, position);
  }
}
```

Domains should throw *typed errors* for better traceability:

```ts
if (!expr) throw new MathEvaluationError("Missing 'expr' attribute", node.position);
```

## 10. Symbol Binding in Domains

Domains that define variables or functions must integrate with the symbol table during `resolve()`.

Example:

```ts
resolve(node, ctx) {
  if (node.name === "logic:define") {
    const name = node.attributes?.name;
    ctx.registerSymbol({ name, type: "boolean", scope: "local" });
  }
}
```

Symbol entries can later be referenced through `<logic:expr expr="A && B"/>`.

## 11. Advanced Features

### 11.1 Counterfactual Domains

Domains can define alternative evaluation contexts for “what-if” scenarios:

```ts
evaluate(node, ctx) {
  if (node.name === "logic:counterfactual") {
    const altCtx = { ...ctx, symbols: { ...ctx.symbols, ...node.attributes } };
    return ctx.evaluate(node.children?.[0], altCtx);
  }
}
```

This pattern enables comparative reasoning between hypothetical states.

### 11.2 Domain-Scoped State

Avoid shared mutable state between domains.
If temporary state is needed, store it in the evaluation context:

```ts
ctx.state = ctx.state ?? {};
ctx.state.tempResults = [];
```

Never use global variables.

## 12. Domain Testing

### 12.1 Unit Tests

Each domain must include comprehensive unit tests under `tests/domains/`.

Example:

```ts
import { evaluate } from "../../src/evaluator";
import { registerDomain } from "../../src/domains/core";
import { mathDomain } from "../../src/domains/math";

registerDomain("math", mathDomain);

test("math:add evaluates correctly", () => {
  const input = `<math:add><math:expr expr="2"/><math:expr expr="3"/></math:add>`;
  const result = evaluate(input);
  expect(result).toBe(5);
});
```

### 12.2 Coverage Requirements

* ≥ 95% line coverage per domain.
* All tags and edge cases tested.
* Include malformed input tests to validate error recovery.

### 12.3 Snapshot Testing

Integration behavior can be validated using Jest snapshots:

```ts
expect(evaluate(input)).toMatchSnapshot();
```

## 13. Versioning and Backward Compatibility

* Each domain must declare a semantic version number internally:

```ts
export const version = "1.0.0";
```

* Changes to evaluation semantics require a **minor** version bump.
* Breaking attribute or tag name changes require a **major** version bump.

Backward compatibility must be preserved for all stable releases.

## 14. Documentation Standards

Each domain must provide a reference page under `docs/domains/<domain>.md` including:

* Overview
* Supported tags and attributes
* Evaluation semantics
* Examples
* Version history

Example structure:

```
docs/domains/
├── math.md
└── logic.md
```

## 15. Performance Guidelines

* Evaluation of domain nodes must be O(n) in the number of child nodes.
* Avoid repeated function compilation (`new Function`) inside loops.
* Cache parsed expressions when feasible.
* Prefer immutable data structures.

Benchmark results should be reproducible via `npm run test:perf`.

## 16. Security Considerations

* Never execute unvalidated input directly with `eval` or `Function` unless explicitly sandboxed.
* Use controlled environments for expression evaluation (e.g., `vm` in Node or isolated interpreter).
* Disallow filesystem, network, or process access from within domains.
* Validate numeric or symbolic attributes before evaluation.

## 17. Publishing and Distribution

### 17.1 Internal Domains

Core domains (e.g., `math`, `logic`) are distributed with NSML itself and reside under `src/domains/`.

### 17.2 External Domains

Third-party developers can distribute custom domains as npm packages following the naming convention:

```
@nsml/domain-<name>
```

Example:

```
npm install @nsml/domain-finance
```

Each external domain must expose:

```ts
export const domain = { ... };
export function register() {
  registerDomain("finance", domain);
}
```

## 18. Domain Discovery

Future versions of NSML will support automatic discovery through a `domains.json` manifest:

```json
{
  "domains": [
    "@nsml/domain-math",
    "@nsml/domain-logic",
    "@custom/domain-finance"
  ]
}
```

The runtime will resolve and register all listed domains at startup.

## 19. Recommended Development Workflow

1. Fork NSML and create a feature branch (`feature/domain-<name>`).
2. Implement and register your domain handler.
3. Add test cases under `tests/domains/`.
4. Create `docs/domains/<name>.md`.
5. Run full validation suite (`npm test`).
6. Submit pull request with summary and rationale.

## 20. Summary

Domain modules are the **core extensibility mechanism** of NSML.
They encapsulate semantics, isolate side effects, and enable declarative integration of symbolic reasoning, computation, and knowledge modeling.