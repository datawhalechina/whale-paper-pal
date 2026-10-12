import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const repo = fileURLToPath(new URL('../', import.meta.url));
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, DOMParser: dom.window.DOMParser,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const cache = join(repo, 'node_modules/.cache/verify-writer-agent-session');
await mkdir(cache, { recursive: true });
const output = join(cache, 'panel.mjs');
await build({
  absWorkingDir: repo, entryPoints: ['src/features/writer/WriterAgentPanel.tsx'],
  outfile: output, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
  plugins: [{ name: 'omit-styles', setup(plugin) {
    plugin.onResolve({ filter: /\.css$/ }, ({ path }) => ({ path, namespace: 'styles' }));
    plugin.onLoad({ filter: /.*/, namespace: 'styles' }, () => ({ contents: '', loader: 'js' }));
  } }],
});
const { WriterAgentPanel } = await import(pathToFileURL(output).href);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const reply = (message) => JSON.stringify({ message, changes: [{ path: 'main.tex', content: 'New text' }] });

async function mount(options = {}) {
  localStorage.clear();
  const calls = [];
  // The component and Tauri JS invoke path are real; only native IPC is controlled.
  window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    calls.push({ command, args });
    switch (command) {
      case 'agent_runtime_status': return ['claude_code', 'codex_runtime'].map((id) => ({ id, label: id, available: true, authenticated: true }));
      case 'agent_model_list': return [];
      case 'list_agent_messages': case 'list_user_memories': return [];
      case 'run_writer_agent': return options.run ? options.run(args.request) : reply('CURRENT_REPLY');
      case 'save_user_memory': return options.saveMemory?.();
      case 'stop_writer_agent': case 'save_agent_message': return;
      default: throw new Error(`Unexpected command: ${command}`);
    }
  } };
  const root = createRoot(document.getElementById('root'));
  const props = {
    project: { name: 'Test project' }, rootPath: '/test/project', activePath: 'main.tex',
    files: { 'main.tex': 'Example text' }, onSaveAll: options.save || (async () => {}),
    onApplyChanges: async () => {},
  };
  const render = async () => act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(WriterAgentPanel, props))));
  await render();
  let mounted = true;
  return {
    calls,
    command: (name) => calls.filter((call) => call.command === name),
    session: () => localStorage.getItem('whalepaper.writer.agent-session:/test/project'),
    async send(text) {
      const textarea = document.querySelector('textarea');
      assert.equal(textarea.disabled, false, 'Current conversation should accept a new request');
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, text);
        textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    },
    async reset() { await act(async () => document.querySelector('[aria-label="新建会话"]').click()); },
    async setDefaultRuntime(runtime) { props.defaultRuntime = runtime; await render(); },
    async unmount() { if (mounted) { mounted = false; await act(async () => root.unmount()); } },
  };
}

const tests = [
  ['normal turn displays revisions and saves its messages', async (h) => {
    await h.send('CURRENT_REQUEST');
    assert.match(document.body.textContent, /CURRENT_REPLY/);
    assert.match(document.body.textContent, /1 个文件待修改/);
    assert.deepEqual(h.command('save_agent_message').map((call) => call.args.request.role), ['user', 'assistant']);
    assert.ok(h.command('save_agent_message').every((call) => call.args.request.sessionId === h.session()));
  }],
  ['new session cancels a turn waiting for project saves', async (h, gate) => {
    await h.send('OLD_REQUEST');
    await h.reset();
    await act(async () => gate.resolve());
    assert.equal(h.command('run_writer_agent').length, 0);
    assert.doesNotMatch(document.body.textContent, /OLD_REQUEST|CURRENT_REPLY/);
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'save'],
  ['old reply and finalizer cannot replace a new pending turn', async (h, gate, next) => {
    await h.send('OLD_REQUEST');
    const oldSession = h.session();
    await h.reset();
    await h.send('NEW_REQUEST');
    assert.notEqual(h.session(), oldSession);
    await act(async () => gate.resolve(reply('OLD_REPLY')));
    assert.doesNotMatch(document.body.textContent, /OLD_REPLY/);
    assert.equal(h.command('save_agent_message').length, 0);
    assert.equal(document.querySelector('textarea').disabled, true, 'New turn must remain busy');
    await act(async () => next.resolve(reply('NEW_REPLY')));
    assert.match(document.body.textContent, /NEW_REPLY/);
    assert.ok(h.command('save_agent_message').every((call) => call.args.request.sessionId === h.session()));
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'run'],
  ['old runtime error is ignored after reset', async (h, gate) => {
    await h.send('OLD_REQUEST');
    await h.reset();
    await act(async () => gate.reject(new Error('OLD_RUNTIME_ERROR')));
    assert.equal(Boolean(document.querySelector('.writer-agent-error')), false);
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'run'],
  ['switching runtime cancels the turn awaiting saves', async (h, gate) => {
    await h.send('OLD_REQUEST');
    await act(async () => document.querySelector('.writer-agent-runtime').click());
    await act(async () => [...document.querySelectorAll('.writer-agent-runtime-menu button')].find((button) => button.textContent.includes('codex_runtime')).click());
    await act(async () => gate.resolve());
    assert.equal(h.command('run_writer_agent').length, 0);
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'save'],
  ['unmount cancels the turn awaiting saves', async (h, gate) => {
    await h.send('OLD_REQUEST');
    await h.unmount();
    await act(async () => gate.resolve());
    assert.equal(h.command('run_writer_agent').length, 0);
  }, 'save'],
  ['runtime changes from settings cancel the pending turn', async (h, gate) => {
    await h.send('OLD_REQUEST');
    await h.setDefaultRuntime('codex_runtime');
    await act(async () => gate.resolve());
    assert.equal(h.command('run_writer_agent').length, 0);
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'save'],
  ['cancelled dream response does not save a profile', async (h, gate) => {
    await h.send('/dream');
    await h.reset();
    await act(async () => gate.resolve(reply('OLD_PROFILE')));
    assert.equal(h.command('save_user_memory').length, 0);
    assert.doesNotMatch(document.body.textContent, /OLD_PROFILE/);
  }, 'run'],
  ['remember completion does not add messages to a replacement session', async (h, gate) => {
    await h.send('/remember Prefer concise answers');
    await h.reset();
    await act(async () => gate.resolve());
    assert.equal(h.command('save_user_memory').length, 1, 'Already submitted memory write is not rolled back');
    assert.equal(document.querySelectorAll('.writer-agent-message').length, 0);
    assert.equal(document.querySelector('textarea').disabled, false);
  }, 'memory'],
];
let failures = 0;
try {
  for (const [name, check, mode] of tests) {
    const gate = deferred(), next = deferred();
    let runs = 0;
    const h = await mount({
      save: mode === 'save' ? () => gate.promise : undefined,
      run: mode === 'run' ? () => (++runs === 1 ? gate.promise : next.promise) : undefined,
      saveMemory: mode === 'memory' ? () => gate.promise : undefined,
    });
    try { await check(h, gate, next); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
    finally {
      await act(async () => { gate.resolve(reply('CLEANUP')); next.resolve(reply('CLEANUP')); });
      await h.unmount();
    }
  }
} finally { dom.window.close(); }
console.log(`${tests.length - failures}/${tests.length} writer Agent session checks passed`);
process.exitCode = failures ? 1 : 0;
