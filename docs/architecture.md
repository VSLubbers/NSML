# NSML Architecture

Version: 1.0  
Author: V. S. Lubbers  
License: Apache 2.0  


## 1. Overview

The **Neuro-Symbolic Markup Language (NSML)** runtime is implemented as a modular, deterministic evaluation engine written in TypeScript.  
It provides parsing, resolution, and execution of declarative reasoning structures expressed in NSML markup.

The system is organized as a sequence of processing stages:

```
Input (NSML Text)
↓
Lexer → Parser → Resolver → Compiler → Evaluator
↓
Output (JSON Evaluation Result)


Each stage is implemented as a self-contained module and can be used independently or as part of the full `parseNSML()` pipeline.
```

## 2. Core Pipeline

### 2.1 Data Flow Summary

| Stage | Input | Output | Responsibility |
|--------|--------|---------|----------------|
| **Lexer** | Raw NSML text | Token stream | Convert characters to tokens |
| **Parser** | Token stream | Abstract Syntax Tree (AST) | Construct hierarchical document structure |
| **Resolver** | AST | Bound Symbol Table | Bind identifiers, enforce type and scope rules |
| **Compiler** | Bound AST | Executable Graph | Translate rules and expressions into functional closures |
| **Evaluator** | Executable Graph | Result Object | Execute logic deterministically and return structured output |

Each stage conforms to a pure functional interface: no side effects or hidden state.


## 3. Module Architecture

### 3.1 Lexer (`src/lexer.ts`)

The **lexer** transforms raw NSML markup into a sequence of typed tokens.

**Responsibilities**
- Recognize XML-style tags and attributes  
- Emit symbol, operator, literal, and punctuation tokens  
- Normalize whitespace and escape sequences  
- Detect and report lexical errors with positional metadata  

**Core Interfaces**
```ts
interface Token {
  type: string;      // e.g., 'TAG_OPEN', 'IDENTIFIER', 'NUMBER'
  value: string;
  position: { line: number; column: number };
}

function lex(input: string): Token[];
````

**Key Characteristics**

* Stateless and reentrant
* Supports UTF-8 input
* Error recovery: skips invalid segments and emits `LexicalError` tokens

### 3.2 Parser (`src/parser.ts`)

The **parser** consumes tokens and constructs an **Abstract Syntax Tree (AST)** conforming to the NSML grammar.

**Responsibilities**

* Validate structural correctness (well-formed tags, nesting, matching end-tags)
* Build a hierarchical node tree with attributes and content
* Attach positional and lexical metadata
* Emit `SyntaxError` for malformed structures

**Core Interfaces**

```ts
interface ASTNode {
  type: string;                // e.g., 'Rule', 'Query', 'Symbol'
  name?: string;
  attributes?: Record<string, string>;
  children?: ASTNode[];
  content?: string;
  position?: { line: number; column: number };
}

function parse(tokens: Token[]): ASTNode;
```

**Implementation Notes**

* Recursive descent parser with a minimal grammar subset
* Uses internal context stack for tag balancing
* Supports domain extensions through dynamic tag registration

### 3.3 Resolver (`src/resolver.ts`)

The **resolver** performs symbol binding, type inference, and dependency analysis.

**Responsibilities**

* Resolve references to variables, constants, and rules
* Validate type compatibility and scoping rules
* Detect cycles in rule dependencies
* Build a **Symbol Table** and **Dependency Graph**

**Core Interfaces**

```ts
interface SymbolEntry {
  name: string;
  type: string;
  value?: any;
  scope: 'global' | 'local' | 'counterfactual';
}

interface SymbolTable {
  [name: string]: SymbolEntry;
}

function resolve(ast: ASTNode): { ast: ASTNode; symbols: SymbolTable };
```

**Error Handling**

* `ResolutionError`: undefined identifiers or circular dependencies
* `TypeError`: incompatible assignments or operations

### 3.4 Compiler (`src/compiler.ts`)

The **compiler** translates the resolved AST into an executable representation.
It performs expression compilation, logical rule transformation, and evaluation graph construction.

**Responsibilities**

* Convert logical and arithmetic expressions to executable closures
* Encode implication chains (`=>`) and Boolean expressions
* Precompute constant expressions for optimization
* Generate an **Execution Graph** representing dependencies between rules and queries

**Core Interfaces**

```ts
interface CompiledNode {
  id: string;
  type: 'rule' | 'query' | 'assert' | 'symbol';
  evaluate: (context: EvaluationContext) => any;
  dependencies: string[];
}

function compile(ast: ASTNode, symbols: SymbolTable): CompiledNode[];
```

**Design Notes**

* Expression compilation is purely functional
* Supports rule composition (`chain` attributes)
* Uses lazy evaluation for dependency resolution

### 3.5 Evaluator (`src/evaluator.ts`)

The **evaluator** executes compiled nodes deterministically, producing the final result object.

**Responsibilities**

* Execute rules, queries, and assertions in dependency order
* Maintain isolated evaluation contexts
* Handle counterfactual and simulation blocks
* Record stepwise traces when requested

**Core Interfaces**

```ts
interface EvaluationResult {
  results: Record<string, any>;
  errors: EvaluationError[];
  trace?: string[];
}

function evaluate(nodes: CompiledNode[]): EvaluationResult;
```

**Evaluation Model**

1. Topological sort of the execution graph
2. Sequential or parallel evaluation depending on dependency structure
3. Rule results memoized for re-use across queries
4. Assertions checked at the end of the cycle

## 4. Domain Architecture

NSML supports **domain extensions**, which allow specialized logic to be defined externally.

### 4.1 Domain Registration

```ts
interface DomainHandler {
  parse(node: ASTNode, context: DomainContext): any;
  evaluate(node: ASTNode, context: EvaluationContext): any;
}

function registerDomain(tag: string, handler: DomainHandler): void;
```

Registered domain tags (e.g., `<chess>`, `<math>`) are recognized during parsing and handled by the corresponding module.

### 4.2 Example

```ts
registerDomain("math", {
  evaluate: (node, ctx) => {
    const expr = node.attributes?.expr;
    return eval(expr);
  }
});
```

## 5. Evaluation Context

Each evaluation step operates within a context object that encapsulates the symbol table and runtime state.

```ts
interface EvaluationContext {
  symbols: SymbolTable;
  results: Record<string, any>;
  trace?: string[];
  options?: {
    tracing: boolean;
    counterfactual?: boolean;
  };
}
```

Contexts are immutable; updates create shallow copies to ensure functional purity.

## 6. Error Handling

All modules emit structured errors.

| Error Type         | Source    | Description                              |
| ------------------ | --------- | ---------------------------------------- |
| `LexicalError`     | Lexer     | Invalid tokens, malformed syntax         |
| `SyntaxError`      | Parser    | Structural violation or unbalanced tags  |
| `ResolutionError`  | Resolver  | Undefined or cyclic symbol               |
| `TypeError`        | Resolver  | Incompatible types or invalid operations |
| `CompilationError` | Compiler  | Expression translation failure           |
| `EvaluationError`  | Evaluator | Runtime logic or assertion failure       |

Errors are aggregated in the result object and do not halt execution unless severity is critical.

## 7. Extensibility and Composition

### 7.1 Modular Usage

Each component can be imported and used independently:

```ts
import { lex, parse, resolve, compile, evaluate } from "nsml";

const tokens = lex(input);
const ast = parse(tokens);
const { symbols } = resolve(ast);
const compiled = compile(ast, symbols);
const result = evaluate(compiled);
```

### 7.2 Integration with LLMs

NSML can serve as an execution backend for LLM-based reasoning systems.
The typical loop includes:

1. LLM generates NSML markup.
2. The NSML engine parses and executes it.
3. Results (including error traces) are returned as JSON.
4. The LLM self-corrects based on feedback.

This design enables neuro-symbolic reasoning with closed-loop verification.

## 8. Performance Characteristics

| Metric           | Property                                         |
| ---------------- | ------------------------------------------------ |
| Complexity       | O(n) per stage, linear in document size          |
| Memory footprint | ~44 KB core bundle (no external dependencies)    |
| Determinism      | Guaranteed for identical input                   |
| Parallelism      | Possible per query if dependency graph permits   |
| Streaming        | Planned future extension for incremental parsing |

## 9. Logging and Tracing

The evaluator supports deterministic tracing.

Example trace fragment:

```
[TRACE] Bind var 'x' = 10
[TRACE] Execute rule 'adultRule' → true
[TRACE] Query 'checkAdult' = true
```

Traces are accessible in the final `EvaluationResult.trace` field and can be serialized to JSON or text.

## 10. Testing Infrastructure

All core modules are unit-tested using Jest.

Test structure:

```
tests/
├── lexer.test.ts
├── parser.test.ts
├── resolver.test.ts
├── compiler.test.ts
├── evaluator.test.ts
└── examples/
```

Tests include golden files for reference outputs and error conditions.

## 11. Future Architectural Extensions

Planned modules include:

* **Visualizer** — browser-based evaluation trace renderer
* **RDF Bridge** — translation layer to/from RDF triples
* **Probabilistic Evaluator** — optional Bayesian logic mode
* **Streaming Parser** — incremental evaluation for large inputs

## 12. Summary

The NSML architecture implements a fully deterministic, modular reasoning engine with the following guarantees:

* Functional purity and referential transparency
* Stable, formally defined data flow
* Extensibility through external domains
* Compatibility with LLM-generated symbolic output

This architecture serves as the foundation for reproducible neuro-symbolic reasoning systems.