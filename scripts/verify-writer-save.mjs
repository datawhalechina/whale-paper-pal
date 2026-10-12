import assert from "node:assert/strict";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { useWriterBuffers } from "../src/features/writer/useWriterBuffers.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const buffer = (content, savedContent = "original") => ({ content, savedContent, saving: false });

async function mount(initial) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const jobs = [];
  const saves = [];
  const errors = [];
  let api;
  let closed = false;
  let navigation;
  let navigationError;
  const writers = new Map();
  const writerFor = (project) => {
    if (!writers.has(project)) writers.set(project, (path, content) => new Promise((resolve, reject) => {
      const job = { project, path, content, settled: false };
      job.resolve = () => { job.settled = true; resolve(); };
      job.reject = (error) => { job.settled = true; reject(error); };
      jobs.push(job);
    }));
    return writers.get(project);
  };
  const onError = (error) => errors.push(error);
  const save = () => {
    const promise = api.saveAll();
    saves.push(promise);
    void promise.catch(() => {});
    return promise;
  };
  function Editor({ writeFile }) {
    api = useWriterBuffers(writeFile, onError);
    return createElement("button", { onClick: () => {
      navigation = save().then(() => { closed = true; }).catch((error) => { navigationError = error; });
    } }, "Return to library");
  }
  const render = (project) => createElement(StrictMode, null, createElement(Editor, { key: project, writeFile: writerFor(project) }));
  await act(async () => root.render(render("first")));
  await act(async () => api.setBuffers(initial));
  return {
    get api() { return api; }, jobs, errors,
    get closed() { return closed; },
    get navigationError() { return navigationError; },
    async save() { let promise; await act(async () => { promise = save(); }); return { promise }; },
    async edit(path, content) { await act(async () => api.setBuffers((current) => ({ ...current, [path]: { ...current[path], content } }))); },
    async close() { await act(async () => container.querySelector("button").click()); },
    async openProject(project, initialBuffers) {
      await act(async () => root.render(render(project)));
      await act(async () => api.setBuffers(initialBuffers));
    },
    async settle(index, error) { await act(async () => error ? jobs[index].reject(error) : jobs[index].resolve()); },
    async cleanup() {
      // Finish delayed writes even after a failed assertion, then unmount React.
      for (let pass = 0; pass < 8; pass += 1) {
        await act(async () => { for (const job of jobs) if (!job.settled) job.resolve(); });
      }
      await act(async () => { await Promise.allSettled(saves); await navigation; root.unmount(); });
      container.remove();
    },
  };
}

const checks = [
  ["concurrent saves share the pending write", async () => {
    const editor = await mount({ "main.tex": buffer("A") });
    try {
      const first = await editor.save();
      const second = await editor.save();
      assert.equal(second.promise, first.promise);
      assert.equal(editor.jobs.length, 1);
      let finished = false;
      void second.promise.then(() => { finished = true; });
      await act(async () => {});
      assert.equal(finished, false);
      await editor.settle(0);
      await second.promise;
      assert.equal(editor.api.buffers["main.tex"].savedContent, "A");
    } finally { await editor.cleanup(); }
  }],
  ["navigation waits for edits made during every write round", async () => {
    const editor = await mount({ "main.tex": buffer("A") });
    try {
      await editor.save();
      await editor.edit("main.tex", "B");
      await editor.close();
      assert.equal(editor.closed, false, "must not navigate during the original autosave");
      await editor.settle(0);
      assert.equal(editor.jobs[1]?.content, "B");
      assert.equal(editor.closed, false);
      await editor.edit("main.tex", "C");
      await editor.settle(1);
      assert.equal(editor.jobs[2]?.content, "C");
      assert.equal(editor.closed, false, "waiting once must not drop a later edit");
      await editor.settle(2);
      assert.equal(editor.closed, true);
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("C", "C"));
    } finally { await editor.cleanup(); }
  }],
  ["a failed batch waits for other writes, blocks navigation and keeps newer edits dirty", async () => {
    const editor = await mount({ "main.tex": buffer("A"), "refs.bib": buffer("references") });
    try {
      const first = await editor.save();
      await editor.edit("main.tex", "B");
      await editor.close();
      const failure = new Error("disk unavailable");
      await editor.settle(0, failure);
      const joining = await editor.save();
      assert.equal(joining.promise, first.promise, "other file writes must finish before a retry can start");
      assert.equal(editor.closed, false);
      assert.equal(editor.navigationError, undefined);
      await editor.settle(1);
      await assert.rejects(first.promise, (error) => error === failure);
      assert.equal(editor.navigationError, failure);
      assert.deepEqual(editor.errors, [failure]);
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("B"));
      assert.deepEqual(editor.api.buffers["refs.bib"], buffer("references", "references"));
      const retry = await editor.save();
      assert.deepEqual(editor.jobs.map(({ path, content }) => [path, content]), [
        ["main.tex", "A"], ["refs.bib", "references"], ["main.tex", "B"],
      ]);
      await editor.settle(2);
      await retry.promise;
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("B", "B"));
    } finally { await editor.cleanup(); }
  }],
  ["reverting to saved text still waits for the older write and restores the reverted text", async () => {
    const editor = await mount({ "main.tex": buffer("A", "A") });
    try {
      await editor.edit("main.tex", "B");
      await editor.save();
      await editor.edit("main.tex", "A");
      await editor.close();
      assert.equal(editor.closed, false);
      await editor.settle(0);
      assert.equal(editor.jobs[1]?.content, "A");
      assert.equal(editor.closed, false);
      await editor.settle(1);
      assert.equal(editor.closed, true);
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("A", "A"));
    } finally { await editor.cleanup(); }
  }],
  ["a project remount isolates late writes from the new project's buffers", async () => {
    const editor = await mount({ "main.tex": buffer("A") });
    try {
      await editor.save();
      await editor.edit("main.tex", "B");
      await editor.openProject("second", { "main.tex": buffer("new project", "new project") });
      await editor.settle(0);
      assert.equal(editor.jobs[1]?.project, "first");
      assert.equal(editor.jobs[1]?.content, "B");
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("new project", "new project"));
      await editor.edit("main.tex", "new edit");
      const saving = await editor.save();
      assert.equal(editor.jobs[2]?.project, "second");
      await editor.settle(1);
      await editor.settle(2);
      await saving.promise;
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("new edit", "new edit"));
    } finally { await editor.cleanup(); }
  }],
  ["an edit and save in one React event use the newest buffer", async () => {
    const editor = await mount({ "main.tex": buffer("original", "original") });
    try {
      let saving;
      await act(async () => {
        editor.api.setBuffers((current) => ({ ...current, "main.tex": { ...current["main.tex"], content: "B" } }));
        saving = editor.api.saveAll();
      });
      assert.equal(editor.jobs[0]?.content, "B");
      await editor.settle(0);
      await saving;
      assert.deepEqual(editor.api.buffers["main.tex"], buffer("B", "B"));
    } finally { await editor.cleanup(); }
  }],
];

let failures = 0;
for (const [name, check] of checks) {
  try { await check(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}\n${error.stack}`); }
}
dom.window.close();
console.log(`Writer save checks: ${checks.length - failures}/${checks.length} passed`);
process.exitCode = failures ? 1 : 0;
