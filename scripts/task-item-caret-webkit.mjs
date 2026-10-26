import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { webkit } from 'playwright';

const projectRoot = process.cwd();
const webRoot = path.join(projectRoot, 'web', 'dist');
const build = spawnSync(process.execPath, ['scripts/build-web.mjs'], { cwd: projectRoot, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(path.join(webRoot, 'index.html'))) throw new Error('Web build did not produce web/dist/index.html');

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${webRoot}${path.sep}`) && file !== path.join(webRoot, 'index.html')) throw new Error('Invalid path');
    response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const stamp = '2026-01-01T00:00:00.000Z';
const seed = markdown => ({
  version: 1,
  notes: [{ id: 'synthetic-task-caret-check', createdAt: stamp, updatedAt: stamp, markdown }],
  selectedID: 'synthetic-task-caret-check',
  activeTag: null,
});

let browser;
try {
  browser = await webkit.launch({ headless: true });
} catch (error) {
  server.close();
  console.error('Install the WebKit browser once with: npx playwright install webkit');
  throw error;
}

async function open(markdown, viewport = { width: 900, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(library => {
    localStorage.setItem('foldnote-preview-v1', JSON.stringify(library));
    document.addEventListener('keydown', event => { window.__taskCaretLastKeydown = event; }, true);
    document.addEventListener('keyup', event => {
      const keydown = window.__taskCaretLastKeydown;
      if (keydown?.key === event.key) window.__taskCaretKey = { key: keydown.key, defaultPrevented: keydown.defaultPrevented };
    }, true);
  }, seed(markdown));
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('.markdown-editor').waitFor();
  await page.waitForTimeout(100);
  return { page, context };
}

async function run(name, markdown, action, viewport) {
  const { page, context } = await open(markdown, viewport);
  try {
    await action(page);
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  } finally {
    await context.close();
  }
}

function exactParagraph(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`);
}

async function clickParagraphStart(page, text, selector = 'li[data-checked] > div > p') {
  const paragraph = page.locator(selector).filter({ hasText: exactParagraph(text) }).first();
  const box = await paragraph.boundingBox();
  assert.ok(box, `Could not find paragraph: ${text}`);
  await page.mouse.click(box.x - 3, box.y + box.height / 2);
  await page.waitForTimeout(30);
}

async function clickParagraphEnd(page, text, selector = 'li[data-checked] > div > p') {
  const paragraph = page.locator(selector).filter({ hasText: exactParagraph(text) }).first();
  const box = await paragraph.boundingBox();
  assert.ok(box, `Could not find paragraph: ${text}`);
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.waitForTimeout(30);
}

async function setTextCaret(page, text, offset, selector = 'li[data-checked] > div > p') {
  const point = await page.locator(selector).filter({ hasText: exactParagraph(text) }).first().evaluate((paragraph, offset) => {
    const textNode = paragraph.firstChild;
    if (!(textNode instanceof Text)) throw new Error('Expected a plain text paragraph');
    const range = document.createRange();
    const index = Math.min(offset, textNode.length - 1);
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.25, y: rect.top + rect.height / 2 };
  }, offset);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(30);
}

async function caret(page) {
  return page.evaluate(() => {
    const selection = getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const paragraph = element?.closest('p');
    const item = paragraph?.closest('li[data-checked]');
    let rect = null;
    if (anchor?.nodeType === Node.TEXT_NODE) {
      const text = anchor.textContent ?? '';
      const offset = selection.anchorOffset;
      const from = offset < text.length ? offset : Math.max(0, offset - 1);
      const range = document.createRange();
      range.setStart(anchor, from);
      range.setEnd(anchor, Math.min(text.length, from + 1));
      const bounds = range.getBoundingClientRect();
      rect = { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    }
    return {
      text: paragraph?.textContent ?? null,
      offset: selection?.anchorOffset ?? null,
      collapsed: selection?.isCollapsed ?? true,
      taskItem: Boolean(item),
      checked: item?.getAttribute('data-checked') === 'true',
      rect,
    };
  });
}

async function key(page, key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(10);
  return {
    caret: await caret(page),
    prevented: await page.evaluate(() => window.__taskCaretKey?.defaultPrevented ?? null),
  };
}

try {
const tasks = 'Before line\n\n- [ ] unchecked task\n- [x] checked task\n  - [ ] nested task\n\nAfter line';

await run('click left of task text and gap after checkbox', tasks, async page => {
  await clickParagraphStart(page, 'unchecked task');
  assert.equal((await caret(page)).offset, 0);
  const right = await key(page, 'ArrowRight');
  assert.equal(right.prevented, true);
  assert.equal(right.caret.offset, 1);
  assert.equal(right.caret.text, 'unchecked task');

  const gap = await page.evaluate(() => {
    const paragraph = document.querySelector('li[data-checked="false"] > div > p');
    return paragraph.getBoundingClientRect();
  });
  await page.mouse.click(gap.x - 4, gap.y + gap.height / 2);
  assert.equal((await caret(page)).offset, 0);
  assert.equal((await key(page, 'ArrowRight')).caret.offset, 1);
  assert.equal(await page.locator('li[data-checked="false"] input').first().isChecked(), false);
});

await run('Home and Command-Left', tasks, async page => {
  await clickParagraphEnd(page, 'unchecked task');
  const home = await key(page, 'Home');
  assert.equal(home.prevented, true);
  assert.equal(home.caret.offset, 0);

  await clickParagraphEnd(page, 'checked task');
  const commandLeft = await key(page, 'Meta+ArrowLeft');
  assert.equal(commandLeft.prevented, true);
  assert.equal(commandLeft.caret.offset, 0);
  assert.equal(commandLeft.caret.checked, true);
});

const upper = `${'Upper paragraph uses proportional characters and wraps across several visual lines so the caret can be tested against a real adjacent row in WebKit. '.repeat(4)}The final visual row remains long enough for a same-column caret target.`;
const lower = 'Lower paragraph uses different word lengths and wraps across several visual lines so vertical movement can be tested against its visual rows. '.repeat(4);
const wrappedAroundTask = `${upper}\n\n- [ ] anchor task\n\n${lower}`;

await run('Up and Down from task start target the adjacent visual line in long paragraphs', wrappedAroundTask, async page => {
  // Keep block gaps out of these probes so posAtCoords hits the adjacent text row, not a margin boundary.
  await page.addStyleTag({ content: '.markdown-editor { font-family: Arial, sans-serif !important; line-height: 1.1 !important } .markdown-editor p { margin-bottom: 0 !important } .markdown-editor ul[data-type="taskList"] { margin: 0 !important } .markdown-editor li[data-checked] > div > p { margin: 0 !important }' });
  await clickParagraphStart(page, 'anchor task');
  const start = await caret(page);
  assert.equal(start.offset, 0);
  const up = await key(page, 'ArrowUp');
  assert.equal(up.prevented, true);
  assert.equal(up.caret.taskItem, false);
  assert.ok(up.caret.text?.startsWith('Upper paragraph'));
  assert.ok(up.caret.rect.top < start.rect.top);
  assert.ok(Math.abs(up.caret.rect.left - start.rect.left) <= 16, `up x drift: ${up.caret.rect.left} vs ${start.rect.left}`);

  await clickParagraphStart(page, 'anchor task');
  const downStart = await caret(page);
  const down = await key(page, 'ArrowDown');
  assert.equal(down.prevented, true);
  assert.equal(down.caret.taskItem, false);
  assert.ok(down.caret.text?.startsWith('Lower paragraph'));
  assert.ok(down.caret.rect.top > downStart.rect.top);
  assert.ok(Math.abs(down.caret.rect.left - downStart.rect.left) <= 16, `down x drift: ${down.caret.rect.left} vs ${downStart.rect.left}`);
}, { width: 560, height: 900 });

const wrappedTask = `- [ ] ${'wrapped task begins here and continues through many visual lines with varied words to exercise down movement from its first caret position. '.repeat(5)}`;
await run('Down from offset zero moves to the next visual line inside a wrapped task', wrappedTask, async page => {
  const text = await page.locator('li[data-checked] > div > p').first().textContent();
  await clickParagraphStart(page, text);
  const start = await caret(page);
  const down = await key(page, 'ArrowDown');
  assert.equal(down.prevented, true);
  assert.equal(down.caret.taskItem, true);
  assert.equal(down.caret.text, text);
  assert.ok(down.caret.offset > 0, `caret stayed at ${down.caret.offset}`);
  assert.ok(down.caret.rect.top > start.rect.top);
}, { width: 560, height: 900 });

await run('native Left and modified arrows remain unhandled', '- [ ] alpha beta gamma delta epsilon', async page => {
  await setTextCaret(page, 'alpha beta gamma delta epsilon', 3);
  const left = await key(page, 'ArrowLeft');
  assert.equal(left.caret.offset, 2);

  await setTextCaret(page, 'alpha beta gamma delta epsilon', 1);
  const shiftRight = await key(page, 'Shift+ArrowRight');
  assert.equal(shiftRight.caret.collapsed, false);

  await setTextCaret(page, 'alpha beta gamma delta epsilon', 1);
  const optionRight = await key(page, 'Alt+ArrowRight');
  assert.ok(optionRight.caret.offset > 1, `Option+Right moved only to ${optionRight.caret.offset}`);

  await setTextCaret(page, 'alpha beta gamma delta epsilon', 1);
  const controlRight = await key(page, 'Control+ArrowRight');
  assert.notEqual(controlRight.caret.offset, null);
  await setTextCaret(page, 'alpha beta gamma delta epsilon', 1);
  const commandRight = await key(page, 'Meta+ArrowRight');
  assert.notEqual(commandRight.caret.offset, null);
});

await run('Shift+Down remains native inside a wrapped task', wrappedTask, async page => {
  const text = await page.locator('li[data-checked] > div > p').first().textContent();
  await setTextCaret(page, text, 1);
  const shifted = await key(page, 'Shift+ArrowDown');
  assert.equal(shifted.caret.collapsed, false);
}, { width: 560, height: 900 });

await run('checked and nested task starts remain navigable', tasks, async page => {
  await clickParagraphStart(page, 'checked task');
  assert.equal((await key(page, 'ArrowRight')).caret.offset, 1);
  await clickParagraphStart(page, 'nested task');
  assert.equal((await key(page, 'ArrowRight')).caret.offset, 1);
});

await run('checkbox toggling remains native', tasks, async page => {
  const checkbox = page.getByRole('checkbox', { name: 'Task item checkbox for unchecked task' });
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), true);
});

await run('[ ] input rule creates a navigable task', 'Before line', async page => {
  await page.locator('.markdown-editor > p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[ ] New task');
  const paragraph = page.locator('li[data-checked] > div > p').filter({ hasText: /^New task$/ }).first();
  assert.ok(await paragraph.count());
  await page.keyboard.press('Home');
  assert.equal((await caret(page)).offset, 0);
  const right = await key(page, 'ArrowRight');
  assert.equal(right.prevented, true);
  assert.equal(right.caret.offset, 1);
});

await run('Return-created task item remains navigable', tasks, async page => {
  await clickParagraphEnd(page, 'unchecked task');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Return item');
  await page.keyboard.press('Home');
  assert.equal((await caret(page)).offset, 0);
  const right = await key(page, 'ArrowRight');
  assert.equal(right.prevented, true);
  assert.equal(right.caret.offset, 1);
});

} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
