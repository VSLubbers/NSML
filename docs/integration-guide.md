# NSML Integration Guide

Version: 1.0  
Author: V. S. Lubbers  
License: Apache 2.0  

## 1. Overview

This guide describes how to integrate **NSML (Neuro-Symbolic Markup Language)** into external applications and reasoning frameworks.  
It is intended for developers building neuro-symbolic systems, agent pipelines, or LLM-based interpreters that require deterministic evaluation and logical grounding.

NSML can be embedded as a standalone library, a microservice, or an evaluation backend for model-generated markup.

## 2. Integration Modes

NSML supports three primary integration modes:

| Mode | Description | Typical Use Case |
|------|--------------|------------------|
| **Embedded Library** | Import directly in a JavaScript/TypeScript project | Web agents, IDE plugins, local reasoning |
| **CLI Interface** | Command-line invocation via `nsml` binary | Batch evaluation, testing, CI/CD |
| **Remote Service** | Exposed via HTTP or WebSocket API | LLM backend, distributed reasoning nodes |

Each mode uses the same deterministic evaluation core.

## 3. Embedded Integration

### 3.1 Installation

NSML can be added as a standard package:

```bash
npm install nsml
# or
yarn add nsml
````

### 3.2 Minimal Example

```ts
import { lex, parse, resolve, compile, evaluate } from "nsml";

const input = `
<nsml version="1.0">
  <symbols>
    <var name="x" type="number">5</var>
  </symbols>
  <rules>
    <rule name="double">x * 2</rule>
  </rules>
  <queries>
    <query name="result">double</query>
  </queries>
</nsml>
`;

const tokens = lex(input);
const ast = parse(tokens);
const { symbols } = resolve(ast);
const compiled = compile(ast, symbols);
const result = evaluate(compiled);

console.log(result.results.result); // → 10
```

### 3.3 Error Handling

All errors are structured objects and can be inspected programmatically:

```ts
if (result.errors.length) {
  for (const err of result.errors) {
    console.error(`${err.type}: ${err.message}`);
  }
}
```

## 4. CLI Integration

The NSML runtime can be used from the command line.

### 4.1 Basic Usage

```bash
nsml run example.nsml
```

Output is printed as a formatted JSON object.

### 4.2 Options

| Flag             | Description                         |
| ---------------- | ----------------------------------- |
| `--trace`        | Include detailed evaluation trace   |
| `--validate`     | Run syntax and type validation only |
| `--out <file>`   | Write JSON output to file           |
| `--import <dir>` | Add custom domain modules           |
| `--quiet`        | Suppress non-error output           |

### 4.3 Example

```bash
nsml run scenario.nsml --trace --out result.json
```

Produces `result.json` with structured evaluation output and trace data.

## 5. Remote (Service-Based) Integration

NSML can be deployed as a lightweight HTTP or WebSocket reasoning service.

### 5.1 REST API Example

**Endpoint:** `POST /evaluate`

**Request:**

```json
{
  "nsml": "<nsml version='1.0'><symbols>...</symbols>...</nsml>"
}
```

**Response:**

```json
{
  "results": { "queryName": 42 },
  "errors": [],
  "trace": ["Bind x=10", "Execute rule: result = x*2"]
}
```

### 5.2 Node.js Microservice Example

```ts
import express from "express";
import { lex, parse, resolve, compile, evaluate } from "nsml";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/evaluate", (req, res) => {
  try {
    const { nsml } = req.body;
    const tokens = lex(nsml);
    const ast = parse(tokens);
    const { symbols } = resolve(ast);
    const compiled = compile(ast, symbols);
    const result = evaluate(compiled);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(8080, () => console.log("NSML service running on port 8080"));
```

## 6. Integration with LLMs

### 6.1 Typical Workflow

1. **Prompt** — The model is asked to express reasoning steps in NSML format.
2. **Validation** — The generated markup is parsed and validated locally.
3. **Evaluation** — The NSML engine deterministically computes results.
4. **Feedback** — The results (or error traces) are sent back to the model for correction.

This cycle forms a **closed neuro-symbolic reasoning loop**.

### 6.2 Example Integration (TypeScript)

```ts
import { evaluateNSML } from "nsml";
import { openai } from "openai"; // Example LLM client

async function loop(prompt: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "system", content: "Respond in NSML only." },
               { role: "user", content: prompt }]
  });

  const nsmlOutput = response.choices[0].message.content;
  const result = evaluateNSML(nsmlOutput);

  if (result.errors.length) {
    // Send error feedback back to the model
    return loop(`Fix the following NSML errors: ${JSON.stringify(result.errors)}`);
  }

  return result.results;
}
```

### 6.3 Recommended Model Instructions

When prompting LLMs, use explicit generation constraints:

```
Respond strictly in valid NSML 1.0 format.
Do not include commentary or explanations outside of tags.
Ensure <nsml> root tags are properly closed.
```

This improves parsing reliability and determinism.

## 7. Integration with Agent Frameworks

### 7.1 LangChain Integration

```ts
import { Tool } from "langchain/tools";
import { evaluateNSML } from "nsml";

export class NSMLTool extends Tool {
  name = "NSML";
  description = "Evaluates NSML markup deterministically.";

  async _call(input: string) {
    const result = evaluateNSML(input);
    return JSON.stringify(result.results);
  }
}
```

Agents can then call this tool directly during reasoning sequences.

### 7.2 AutoGen / OpenDevin / SemanticKernel

In these frameworks, NSML evaluation functions as a **trusted execution substrate**:

* The agent generates NSML logic blocks
* The evaluator runs them deterministically
* Results are returned as validated state updates

This approach enforces safety and predictability in LLM-driven automation.

## 8. Interfacing with Custom Domains

NSML supports domain-specific extensions.
Integration typically involves registering a domain handler for custom tags.

### 8.1 Example: Registering a Domain

```ts
import { registerDomain } from "nsml";

registerDomain("finance", {
  evaluate(node, ctx) {
    const expr = node.attributes?.expr;
    return Function("symbols", `with(symbols){return ${expr}}`)(ctx.symbols);
  }
});
```

Then within NSML:

```xml
<finance expr="revenue - cost" />
```

### 8.2 Domain Packaging

To distribute custom domains:

* Export handlers as ES modules
* Place in `domains/` directory
* Import dynamically using `--import ./domains` in CLI or service mode

## 9. Integration Testing

When embedding NSML, include automated validation for both markup and evaluation correctness.

Example test (Jest):

```ts
import { evaluateNSML } from "nsml";

test("arithmetic evaluation", () => {
  const nsml = `
  <nsml version="1.0">
    <symbols><var name="x" type="number">4</var></symbols>
    <rules><rule name="square">x * x</rule></rules>
    <queries><query name="result">square</query></queries>
  </nsml>`;
  
  const result = evaluateNSML(nsml);
  expect(result.results.result).toBe(16);
  expect(result.errors.length).toBe(0);
});
```

## 10. Deployment Considerations

| Environment                      | Recommendation                                                |
| -------------------------------- | ------------------------------------------------------------- |
| **Serverless (e.g. AWS Lambda)** | Use bundled version (`nsml.min.js`) to reduce cold start time |
| **Browser**                      | Run in a Web Worker to isolate execution                      |
| **Edge/IoT**                     | Deploy minimal build (~44 KB) compiled to ES5                 |
| **Distributed Systems**          | Use message-passing via JSON-RPC for evaluation requests      |

All builds are deterministic and platform-independent.

## 11. Security Model

* NSML evaluation is **purely declarative** — no arbitrary code execution.
* Custom domain handlers must be sandboxed if user-defined.
* Avoid passing untrusted input to `Function()` or `eval()` within handlers.
* Recommended: run in isolated worker threads or containers for untrusted NSML.

## 12. Example End-to-End Integration

Example flow combining LLM reasoning with NSML verification:

```ts
async function verifyModelOutput(prompt: string) {
  const llm = await model.generateNSML(prompt);
  const result = evaluateNSML(llm);

  if (result.errors.length > 0) {
    console.warn("Validation errors detected:", result.errors);
    return { success: false, feedback: result.errors };
  }

  return { success: true, output: result.results };
}
```

This pattern enforces logical correctness before accepting model conclusions.

## 13. Troubleshooting

| Issue                         | Possible Cause                           | Resolution                                       |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------ |
| **“Unclosed tag” error**      | LLM output malformed XML                 | Post-process with an XML repair step             |
| **“Undefined variable”**      | Symbol declared after use                | Reorder `<symbols>` before `<rules>`             |
| **Evaluation returns `null`** | Rule or query missing `return`           | Verify `<rule>` content                          |
| **Circular dependency**       | Rules referencing each other recursively | Introduce base condition or flatten dependencies |

Use `--trace` to inspect evaluation order and dependency resolution.

## 14. Summary

Integrating NSML provides:

* Deterministic symbolic reasoning
* Structured validation for LLM-generated logic
* Extensibility via domains and custom evaluators
* Compatibility across local, CLI, and remote execution environments