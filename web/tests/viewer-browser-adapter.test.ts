import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BrowserViewerAdapter } from '../src/viewer/adapters/browser-viewer';
import { DEFAULT_VIEWER_PREFERENCES } from '../src/viewer/domain/model';

const MAX_BYTES = 8 * 1024 * 1024;
function makeFile(name: string, bytes: Uint8Array, arrayBuffer: () => Promise<ArrayBuffer> = async () => bytes.slice().buffer as ArrayBuffer, size = bytes.byteLength): File {
  return { name, size, arrayBuffer } as unknown as File;
}
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/viewer.html' });
  class StubFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
    onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
    onabort: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
    readAsArrayBuffer(file: Blob) {
      void (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer().then(value => {
        this.result = value;
        this.onload?.call(this as unknown as FileReader, new dom.window.ProgressEvent('load') as unknown as ProgressEvent<FileReader>);
      }, error => {
        this.error = new dom.window.DOMException(String(error));
        this.onerror?.call(this as unknown as FileReader, new dom.window.ProgressEvent('error') as unknown as ProgressEvent<FileReader>);
      });
    }
  }
  Object.defineProperty(dom.window, 'FileReader', { value: StubFileReader, configurable: true });
  const adapter = new BrowserViewerAdapter(dom.window as unknown as Window);
  const events: Array<{ kind: string; snapshot?: any }> = [];
  adapter.subscribe(event => events.push(event as any));
  const input = dom.window.document.querySelector<HTMLInputElement>('input[type=file]')!;
  const select = (file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change'));
  };
  return { dom, adapter, events, input, select };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('browser fallback stores only its independent preferences and reads supported Markdown extensions', async () => {
  const { dom, adapter, select, events } = setup();
  dom.window.localStorage.setItem('foldnote-preview-v1', '{"notes":[]}');
  dom.window.localStorage.setItem('banana-viewer-preferences-v1', JSON.stringify({ ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, glass: 0.5 }));
  const boot = await adapter.bootstrap();
  assert.equal(boot.preferences.focusedOpacity, 0.6);
  assert.equal(boot.preferences.glass, 0.5);
  const bytes = new TextEncoder().encode('# Keep original\r\n\r\n');
  select(makeFile('readme.mkd', bytes)); await tick();
  assert.equal(events.at(-1)?.snapshot.document.markdown, '# Keep original\r\n\r\n');
  assert.equal(events.at(-1)?.snapshot.document.name, 'readme.mkd');
  const firstDocumentID = events.at(-1)?.snapshot.document.documentID;
  await adapter.reload();
  assert.equal(events.at(-1)?.snapshot.document.documentID, firstDocumentID, 'reload keeps the selected file identity');
  select(makeFile('readme.mkd', bytes)); await tick();
  assert.notEqual(events.at(-1)?.snapshot.document.documentID, firstDocumentID, 'a new file selection gets a different identity even with the same name');
  select(makeFile('bom.md', new Uint8Array([0xef, 0xbb, 0xbf, 0x23]))); await tick();
  assert.equal(events.at(-1)?.snapshot.document.markdown, '\uFEFF#', 'the source BOM remains visible to the Markdown/source views');
  const saved = await adapter.savePreferences({ ...DEFAULT_VIEWER_PREFERENCES, focusedOpacity: 0.6, glass: 0.5 });
  assert.equal(saved.preferences.focusedOpacity, 0.6);
  assert.equal(dom.window.localStorage.getItem('banana-viewer-preferences-v1') !== null, true);
  assert.equal(dom.window.localStorage.getItem('foldnote-preview-v1'), '{"notes":[]}');
  assert.equal(dom.window.localStorage.length, 2);
  adapter.dispose(); dom.window.close();
});

test('browser preview maps the recent-menu affordance to its supported file picker', async () => {
  const { dom, adapter, input } = setup();
  let pickerRequests = 0; input.click = () => { pickerRequests++; };
  assert.equal(adapter.supportsNativeOpenMenu, false);
  await adapter.openMenu({ x: 10, y: 5, width: 30, height: 30 });
  assert.equal(pickerRequests, 1);
  adapter.dispose(); dom.window.close();
});

test('browser preview explicitly reports editing unavailable and never fakes writes', async () => {
  const { dom, adapter, select } = setup();
  const snapshot = await adapter.bootstrap();
  assert.deepEqual(snapshot.editing, { kind: 'unavailable' });
  select(makeFile('read-only.md', new TextEncoder().encode('# Read only'))); await tick();
  await assert.rejects(adapter.unlockDocument(), /available in the Mac app/);
  await assert.rejects(adapter.saveDocument('browser-1', '# Changed'), /available in the Mac app/);
  adapter.dispose(); dom.window.close();
});

test('browser fallback enforces extension, 8 MiB and fatal UTF-8 boundaries', async () => {
  const { dom, adapter, select, events } = setup();
  const unsupported = makeFile('notes.txt', new TextEncoder().encode('not Markdown'));
  select(unsupported); await tick();
  assert.equal(events.at(-1)?.snapshot.document.kind, 'error');
  assert.match(events.at(-1)?.snapshot.document.message, /\.mdown, or \.mkd/);

  let oversizedRead = false;
  const oversized = makeFile('large.md', new Uint8Array(), async () => { oversizedRead = true; return new ArrayBuffer(0); }, MAX_BYTES + 1);
  select(oversized); await tick();
  assert.equal(oversizedRead, false);
  assert.match(events.at(-1)?.snapshot.document.message, /8 MB/);

  select(makeFile('invalid.md', new Uint8Array([0xc3, 0x28]))); await tick();
  assert.match(events.at(-1)?.snapshot.document.message, /valid UTF-8/);
  adapter.dispose(); dom.window.close();
});

test('only the latest selected file wins when asynchronous browser reads overlap', async () => {
  const { dom, adapter, select, events } = setup();
  let resolveFirst!: (value: ArrayBuffer) => void;
  const first = makeFile('first.md', new Uint8Array(), () => new Promise(resolve => { resolveFirst = resolve; }));
  const latest = makeFile('latest.md', new TextEncoder().encode('# Latest'));
  select(first); select(latest); await tick();
  resolveFirst(new TextEncoder().encode('# Stale').buffer as ArrayBuffer); await tick();
  assert.equal(events.at(-1)?.snapshot.document.name, 'latest.md');
  assert.equal(events.at(-1)?.snapshot.document.markdown, '# Latest');
  adapter.dispose(); dom.window.close();
});
