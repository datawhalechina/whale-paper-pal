import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Bundle the production parser, request builder, and executor. The transport
// below records inputs so these checks never call an external model provider.
const { outputFiles } = await build({
  stdin: {
    contents: 'export * from "./src/lib/page-translation"; export * from "./src/lib/pdf";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { buildPageTranslationRequests, translatePageRequests, translatePageBatches, batchPageTranslationRequests, buildPdfTextBlocks } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`,
);

const rect = { left: 0.1, top: 0.4, width: 0.35, height: 0.013 };
const block = (order, text, rects = [rect], kind) => ({ id: `b${order}`, pageNumber: 1, order, text, rects, kind });

const prose = [
  block(0, "Abstract"),
  block(1, "Our method uses a shared model. It preserves the full paragraph."),
  block(2, "A second paragraph has a URL: https://example.org/paper."),
];
const originals = structuredClone(prose);
const requests = buildPageTranslationRequests([...prose].reverse(), "");
assert.equal(requests.length, 3, "each detected paragraph must stay an independent request");
assert.deepEqual(requests.map((request) => request.sourceText), prose.map((item) => item.text));
assert.deepEqual(requests.map((request) => request.sourceBlockIds), prose.map((item) => [item.id]));
assert.deepEqual(prose, originals, "request building must not mutate layout blocks");

const recorded = [];
const page = await translatePageRequests(requests, async (source) => {
  recorded.push(source);
  if (source.includes("__KEEP_TOKEN_")) {
    const placeholder = source.match(/__KEEP_TOKEN_\d+__/)[0];
    return `第二段译文：${placeholder}`;
  }
  return `译文 ${recorded.length}`;
});
assert.equal(recorded.length, 3, "one provider call per natural paragraph");
assert.equal(page.segments.length, 3);
assert.equal(page.segments[1].sourceText, prose[1].text, "wrapped source lines must remain complete");
assert.equal(page.segments[2].targetText, "第二段译文：https://example.org/paper.");
for (const segment of page.segments) {
  assert.equal(page.content.slice(segment.targetRange.start, segment.targetRange.end), segment.targetText);
}

const mixed = [
  block(0, "Some prose."),
  block(1, "Table 1\n|Model|Score|\n|A|90|"),
  block(2, "Figure 2: Evaluation."),
  block(3, "x = y + z"),
  block(4, "† Equal contribution.", [{ ...rect, top: 0.9 }], "footnote"),
  block(5, "Prose resumes."),
];
const structural = buildPageTranslationRequests(mixed, "");
assert.equal(structural.length, mixed.length, "tables, captions, formulas, and notes must not join adjacent prose");
assert.deepEqual(structural.map((request) => request.kind), ["text", "table", "figure-caption", "formula", "footnote", "text"]);
assert.equal(structural[1].sourceText, mixed[1].text, "table layout remains one source unit");

const figureRegion = { kind: "image", left: 0.08, top: 0.28, width: 0.44, height: 0.3 };
const figureText = {
  ...block(6, "Accuracy Baseline Proposed Figure 3: Evaluation results."),
  lines: [
    { text: "Accuracy", rect: { left: 0.12, top: 0.32, width: 0.08, height: 0.02 } },
    { text: "Baseline Proposed", rect: { left: 0.2, top: 0.48, width: 0.2, height: 0.02 } },
    { text: "Figure 3: Evaluation results.", rect: { left: 0.1, top: 0.6, width: 0.36, height: 0.02 } },
  ],
};
figureText.rects = figureText.lines.map((line) => line.rect);
const outsideFigure = block(7, "The result improves accuracy.", [{ left: 0.55, top: 0.32, width: 0.35, height: 0.02 }]);
const visualFiltered = buildPageTranslationRequests([figureText, outsideFigure], "", 8000, [figureRegion]);
assert.deepEqual(visualFiltered.map((request) => request.sourceText), ["Figure 3: Evaluation results.", outsideFigure.text],
  "chart labels inside a detected figure must be omitted while its caption and nearby prose remain");
const chartOnly = block(8, "Accuracy 0.8 0.9", [{ left: 0.12, top: 0.38, width: 0.2, height: 0.02 }]);
assert.equal(buildPageTranslationRequests([chartOnly], "", 8000, [figureRegion]).length, 0,
  "legacy blocks fully covered by a figure must not be translated");
const tableRegion = { kind: "table", left: 0.08, top: 0.64, width: 0.5, height: 0.2 };
const tableText = {
  ...block(9, "Table 2: Main results. Model Accuracy Baseline 82 Proposed 91"),
  lines: [
    { text: "Table 2: Main results.", rect: { left: 0.1, top: 0.64, width: 0.35, height: 0.02 } },
    { text: "Model Accuracy", rect: { left: 0.12, top: 0.7, width: 0.3, height: 0.02 } },
    { text: "Baseline 82", rect: { left: 0.12, top: 0.74, width: 0.3, height: 0.02 } },
    { text: "Proposed 91", rect: { left: 0.12, top: 0.78, width: 0.3, height: 0.02 } },
  ],
};
tableText.rects = tableText.lines.map((line) => line.rect);
assert.deepEqual(buildPageTranslationRequests([tableText], "", 8000, [tableRegion]).map((request) => request.sourceText),
  ["Table 2: Main results."], "table cells must be omitted while the table caption remains translatable");

const fallback = buildPageTranslationRequests([], "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
assert.deepEqual(fallback.map((request) => request.sourceText), ["First paragraph.", "Second paragraph.", "Third paragraph."]);
assert.equal(buildPageTranslationRequests([], "  ").length, 0);
const bounded = buildPageTranslationRequests([block(0, "x".repeat(50)), block(1, "y".repeat(60))], "", 80);
assert.equal(bounded.length, 2, "the size hint must never merge separate paragraphs");
assert.equal(buildPageTranslationRequests([block(0, "a".repeat(10_000))], "", 80).length, 1, "one long paragraph stays intact");
const batches = batchPageTranslationRequests(requests, 300);
assert.ok(batches.length < requests.length, "adjacent paragraphs should share transport batches");
const batched = await translatePageBatches(requests, async (_batch, items) => Object.fromEntries(items.map((item) => [item.id, `批量译文：${item.sourceText}`])));
assert.equal(batched.segments.length, requests.length, "batch responses must restore every paragraph");
assert.equal(batched.segments[0].targetText, "批量译文：Abstract");

await assert.rejects(translatePageRequests([structural[0]], async () => " "), /空内容/);
await assert.rejects(translatePageRequests([structural[0]], async () => { throw new Error("provider failure"); }), /provider failure/);
console.log("PASS: paragraph-sized API inputs, complete responses, structural units, links, ranges, fallback, failures.");

// Optional real-document check: node scripts/verify-page-translation.mjs /path/paper.pdf
if (process.argv[2]) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(process.argv[2])),
    standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
  }).promise;
  try {
    const pages = await buildPdfTextBlocks(pdf);
    for (const [index, blocks] of pages.entries()) {
      const requestsForPage = buildPageTranslationRequests(blocks, "");
      assert.equal(requestsForPage.length, blocks.length, `page ${index + 1}: separate blocks cannot merge`);
      assert.deepEqual(requestsForPage.flatMap((request) => request.sourceBlockIds), blocks.map((item) => item.id));
    }
    const first = pages[0] || [];
    const firstText = first.map((item) => item.text).join("\n\n");
    if (firstText.includes("RISE: Recursive Improvement")) {
      const abstract = first.find((item) => item.text.startsWith("On-policy distillation (OPD) provides dense"));
      assert.ok(abstract && abstract.rects.length >= 10, "RISE abstract must remain one multi-line paragraph");
      assert.equal(first.filter((item) => item.text.startsWith("A central aspiration") || item.text.startsWith("On-policy distillation (OPD) offers") || item.text.startsWith("We propose a shift")).length, 3,
        "RISE introduction paragraphs must remain distinct");
    }
    if (firstText.includes("GCPO: Diagnosing")) {
      const intro = first.find((item) => item.text.startsWith("Rollout-based reinforcement learning"));
      assert.ok(intro?.text.includes("to construct the next update"), "GCPO paragraph must continue from left to right column");
      assert.equal(first.filter((item) => item.kind === "footnote").length, 3, "GCPO footnotes must not interrupt body text");
    }
    console.log(`PASS: ${pages.length} PDF pages retain one API request per detected paragraph.`);
  } finally {
    await pdf.destroy();
  }
}
