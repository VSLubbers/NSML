# NSML Language Specification
Version: 1.0  
Author: V. S. Lubbers  
License: Apache 2.0  

## 1. Introduction

The **Neuro-Symbolic Markup Language (NSML)** is a declarative domain-specific language designed for deterministic symbolic reasoning.  
It provides a structured, XML-like syntax for representing logic, variables, rules, and queries in a form that can be generated, parsed, and evaluated by both human developers and Large Language Models (LLMs).

This document defines the formal syntax, element semantics, and evaluation rules for NSML.

## 2. Design Principles

1. **Declarativity** – NSML describes what to compute, not how to compute it.  
2. **Determinism** – identical inputs yield identical outputs.  
3. **Transparency** – each computation can be traced and verified.  
4. **Extensibility** – new domains can be registered without modifying the core grammar.  
5. **LLM Compatibility** – syntax designed to minimize generation ambiguity and maximize parse stability.

## 3. Document Structure

Each NSML document must have a single root element `<nsml>` with version information.

```xml
<nsml version="1.0">
  ...
</nsml>
````

Child elements must be well-formed and properly nested.
Ordering of sections (`<symbols>`, `<rules>`, `<queries>`, etc.) is recommended but not strictly enforced.

## 4. Grammar (EBNF)

Below is a formalized grammar for NSML using Extended Backus–Naur Form.

```
nsml          ::= '<nsml' version_attr? '>' section* '</nsml>'
version_attr  ::= 'version="' number '"' 

section       ::= symbols | rules | queries | assertions | counterfactual | simulate | import | domain_block

symbols       ::= '<symbols>' symbol* '</symbols>'
symbol        ::= var | const | set | entity | graph
var           ::= '<var' attr_list? '>' value? '</var>'
const         ::= '<const' attr_list? '>' value? '</const>'
set           ::= '<set' attr_list? '/>'
entity        ::= '<entity' attr_list? '/>'
graph         ::= '<graph' attr_list? '/>'

rules         ::= '<rules>' rule* '</rules>'
rule          ::= '<rule' attr_list? '>' expression '</rule>'

queries       ::= '<queries>' query* '</queries>'
query         ::= '<query' attr_list? '>' expression? '</query>'

assertions    ::= '<assertions>' assertion* '</assertions>'
assertion     ::= '<assert' attr_list? '>' expression '</assert>'

counterfactual ::= '<counterfactual' attr_list? '>' section* '</counterfactual>'
simulate      ::= '<simulate' attr_list? '/>'
import        ::= '<import' attr_list? '/>'

attr_list     ::= (attribute)+
attribute     ::= key '=' '"' value '"'
key           ::= NAME
value         ::= STRING | NUMBER | BOOLEAN
NAME          ::= [A-Za-z_][A-Za-z0-9_-]*
STRING        ::= '"' [^"]* '"'
NUMBER        ::= [0-9]+('.'[0-9]+)?
BOOLEAN       ::= 'true' | 'false'

expression    ::= or_expr
or_expr       ::= and_expr ( '||' and_expr )*
and_expr      ::= eq_expr  ( '&&' eq_expr )*
eq_expr       ::= rel_expr ( ('==' | '!=') rel_expr )*
rel_expr      ::= add_expr ( ('>' | '<' | '>=' | '<=') add_expr )*
add_expr      ::= mul_expr ( ('+' | '-') mul_expr )*
mul_expr      ::= unary_expr ( ('*' | '/') unary_expr )*
unary_expr    ::= ('!' | '-')? primary
primary       ::= variable | literal | '(' expression ')'
variable      ::= NAME
literal       ::= NUMBER | STRING | BOOLEAN
```

## 5. Element Semantics

### 5.1 `<symbols>`

Defines identifiers available throughout the document.
Symbols are globally scoped unless defined inside a `<counterfactual>` block.

| Element    | Description                 | Attributes                             |
| ---------- | --------------------------- | -------------------------------------- |
| `<var>`    | Mutable variable            | `name`, `type`, optional initial value |
| `<const>`  | Immutable constant          | `name`, `type`, required value         |
| `<set>`    | Collection of values        | `name`, `elements` (comma-separated)   |
| `<entity>` | Named entity (opaque type)  | `name`, optional `type`                |
| `<graph>`  | Directed relation structure | `name`, `edges="A->relation->B,..."`   |

Example:

```xml
<symbols>
  <var name="x" type="number">10</var>
  <const name="pi" type="number">3.14159</const>
  <set name="numbers" elements="1,2,3,4,5"/>
  <entity name="Alice" />
  <graph name="family" edges="Alice->parentOf->Bob"/>
</symbols>
```

### 5.2 `<rules>`

Defines logical or functional mappings between expressions.

| Attribute | Description                                       |
| --------- | ------------------------------------------------- |
| `name`    | Rule identifier (unique within document)          |
| `type`    | Optional category (e.g., `logical`, `functional`) |
| `scope`   | Optional variable scope                           |

Example:

```xml
<rules>
  <rule name="adultRule">age >= 18 => true</rule>
</rules>
```

Rules may include multiple implications or chained expressions.

### 5.3 `<queries>`

Specifies computations or evaluations to be performed.

| Attribute | Description                                      |
| --------- | ------------------------------------------------ |
| `name`    | Query name                                       |
| `target`  | Optional variable or entity reference            |
| `chain`   | Sequential rule composition                      |
| `count`   | Boolean flag to return cardinality of true cases |

Example:

```xml
<queries>
  <query name="checkAdult" target="Alice">eval(adultRule)</query>
</queries>
```

### 5.4 `<assertions>`

Defines invariants that must hold after evaluation.

```xml
<assertions>
  <assert name="nonNegative">x >= 0</assert>
</assertions>
```

If an assertion fails, the evaluator emits an error with trace context.

### 5.5 `<counterfactual>`

Declares a scoped alternative scenario.
Variables within the block shadow outer definitions.

```xml
<counterfactual if="x=5">
  <queries>
    <query name="alt">x * 2</query>
  </queries>
</counterfactual>
```

### 5.6 `<simulate>`

Requests evaluation tracing or stepwise simulation.

```xml
<simulate steps="trace" />
```

Attributes:

* `steps` — `"trace"` or `"verbose"`
* `limit` — maximum number of evaluation steps

### 5.7 `<import>`

Imports another NSML module or domain definition.

```xml
<import src="math.nsml" />
```

Imported symbols and rules are merged into the current environment.

### 5.8 Domain Extensions

Domain-specific elements are defined externally and registered via:

```ts
registerDomain(tagName: string, handler: DomainHandler);
```

Example domain tag:

```xml
<math:matrix multiply="A,B" />
```


## 6. Evaluation Semantics

1. **Lexing**: Input is tokenized into symbols, operators, and literals.
2. **Parsing**: An abstract syntax tree (AST) is constructed per section.
3. **Resolution**: Identifiers are bound to their declared values or types.
4. **Compilation**: Rules are transformed into internal function representations.
5. **Execution**: Queries and assertions are evaluated in dependency order.
6. **Tracing**: Each step is logged if `<simulate>` or debug mode is active.

The evaluation model is **side-effect free**; all operations are pure and deterministic.


## 7. Type System

| Type      | Description                  | Example                                          |
| --------- | ---------------------------- | ------------------------------------------------ |
| `number`  | IEEE 754 double precision    | `<var name="x" type="number">5</var>`            |
| `string`  | UTF-8 text                   | `<const name="name" type="string">Alice</const>` |
| `boolean` | Logical truth value          | `<var name="flag" type="boolean">true</var>`     |
| `set`     | Homogeneous collection       | `<set name="nums" elements="1,2,3"/>`            |
| `entity`  | Opaque identifier            | `<entity name="Car"/>`                           |
| `graph`   | Directed adjacency structure | `<graph name="G" edges="A->rel->B"/>`            |

Type checking occurs at resolution time.
Invalid assignments or incompatible comparisons raise type errors.

## 8. Error Model

Each evaluation step can emit structured errors:

| Field          | Description                                                                       |
| -------------- | --------------------------------------------------------------------------------- |
| `type`         | Error category (`SyntaxError`, `TypeError`, `ResolutionError`, `EvaluationError`) |
| `message`      | Human-readable explanation                                                        |
| `suggestedFix` | Optional automated fix suggestion                                                 |
| `location`     | Line/column range (if available)                                                  |

Errors are recoverable; evaluation proceeds unless explicitly halted.

## 9. Serialization and Output

Evaluation produces a JSON object of the form:

```json
{
  "results": {
    "<queryName>": { "result": <value>, "trace": [ ... ] }
  },
  "errors": [ ... ],
  "trace": [ ... ]
}
```

All numeric, boolean, and string types are serialized according to ECMAScript conventions.

## 10. Conformance

A conforming NSML parser must:

1. Support all core elements listed in Section 5.
2. Preserve document order and namespace information.
3. Reject malformed XML and cyclic rule dependencies.
4. Produce deterministic output for identical input.
5. Support UTF-8 input encoding.

## 11. Future Extensions

The following features are reserved for future specification:

* Probabilistic reasoning blocks (`<stochastic>`)
* Temporal logic operators
* Graph query language integration (SPARQL subset)
* Embedded domain annotations (`<domain:*>`)
* Metadata and provenance tracing

## 12. References

* Lubbers, V. S. (2025). *Neuro-Symbolic Markup Language (NSML): A Lightweight Declarative Bridge for LLM Reasoning.*
* Dijkstra, E. W. (1976). *A Discipline of Programming.*
* ISO/IEC 14977:1996(E). *Extended Backus–Naur Form (EBNF).*