import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createAnnotatedPdf } from "../src/lib/export.ts";

const inputPath = process.argv[2] ? resolve(process.argv[2]) : null;
const outputPath = resolve(process.argv[3] || "output/pdf/annotated-export-regression.pdf");
let inputBytes;

if (inputPath) {
  inputBytes = new Uint8Array(await readFile(inputPath));
} else {
  const fixture = await PDFDocument.create();
  fixture.addPage([612, 792]);
  inputBytes = await fixture.save();
}
const now = new Date().toISOString();

const document = {
  id: "export-regression",
  file: { name: inputPath ? basename(inputPath) : "generated-fixture.pdf", data: inputBytes },
  proxy: null,
  title: "Annotated export regression",
  author: "WhalePaper",
  pageCount: 1,
};

const annotations = [{
  id: "manual-highlight",
  documentId: document.id,
  pageNumber: 1,
  type: "highlight",
  color: "yellow",
  quote: "Manual highlight export regression",
  note: "",
  rects: [{ left: 0.08, top: 0.08, width: 0.35, height: 0.025 }],
  createdAt: now,
  updatedAt: now,
}];

const workspace = {
  comments: [],
  notes: [],
  citations: [],
  quiz: [],
  translations: [],
  chats: [],
  explanations: [],
  autoHighlights: [{
    id: "automatic-highlight",
    pageNumber: 1,
    quote: "Automatic highlight export regression",
    category: "method",
    explanation: "Regression marker",
    rects: [{ left: 0.08, top: 0.12, width: 0.35, height: 0.025 }],
  }],
  ink: [{
    id: "ink-stroke",
    documentId: document.id,
    pageNumber: 1,
    color: "#dc3c64",
    width: 3,
    points: [
      { x: 0.08, y: 0.17 },
      { x: 0.2, y: 0.155 },
      { x: 0.32, y: 0.17 },
    ],
    createdAt: now,
  }],
  preferences: {
    theme: "original",
    zoom: 1,
    rotation: 0,
    translationFontSize: 15,
    translationViewOpen: false,
  },
};

const outputBytes = await createAnnotatedPdf(document, annotations, workspace);
const reopened = await PDFDocument.load(outputBytes);
const original = await PDFDocument.load(inputBytes);

if (reopened.getPageCount() !== original.getPageCount()) {
  throw new Error(`Page count changed from ${original.getPageCount()} to ${reopened.getPageCount()}`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputBytes);

console.log(JSON.stringify({
  inputPath: inputPath ?? "generated in memory",
  outputPath,
  inputBytes: inputBytes.byteLength,
  outputBytes: outputBytes.byteLength,
  pageCount: reopened.getPageCount(),
}, null, 2));
