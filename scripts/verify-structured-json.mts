import assert from "node:assert/strict";
import { parseStructuredJson, StructuredJsonParseError } from "../src/lib/structured-json.ts";

assert.deepEqual(parseStructuredJson('{"score":1,"issues":[]}'), { score: 1, issues: [] });

assert.deepEqual(
  parseStructuredJson('Result:\n```json\n{"score":2,"issues":[],}\n```'),
  { score: 2, issues: [] },
);

const latex = parseStructuredJson<{ evidence: string }>(
  String.raw`{"evidence":"\alpha + \beta, see \ref{eq:one} and \textbf{result}"}`,
);
assert.equal(latex.evidence, String.raw`\alpha + \beta, see \ref{eq:one} and \textbf{result}`);

assert.deepEqual(
  parseStructuredJson('{"reasoning":"line one\nline two","score":1}'),
  { reasoning: "line one\nline two", score: 1 },
);

assert.deepEqual(parseStructuredJson('Explanation first. {"safe":true} Done.'), { safe: true });
assert.deepEqual(parseStructuredJson('[{"id":"one"},{"id":"two"}]'), [{ id: "one" }, { id: "two" }]);

assert.throws(
  () => parseStructuredJson('{"score":2,"issues":['),
  (error) => error instanceof StructuredJsonParseError && error.likelyTruncated,
);

console.log("structured JSON parser: all checks passed");
