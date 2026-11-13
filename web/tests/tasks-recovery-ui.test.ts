import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import type { TasksFacade, TasksState } from '../src/tasks/application/controller';
import type { TasksWindowEvent, TasksWindowPort } from '../src/tasks/application/ports';
import { DEFAULT_NOTE_FONT_STATE } from '../src/domain/note-font';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/tasks/ui/settings.css') || url.endsWith('/tasks/ui/planning.css') || url.endsWith('/tasks/ui/detail.css') || url.endsWith('/tasks/ui/tag-picker.css')) {
      return { format: 'module', source: 'export {};', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { mountTasksRecovery } = await import('../src/tasks/ui/recovery');
const { mountTasksApp } = await import('../src/tasks/ui/app');

type RecoveryState = Extract<TasksState, { kind: 'recovery' }>;
type RecoveryOutcome = { kind: 'restored' } | { kind: 'conflict' } | { kind: 'unavailable' } | { kind: 'failed' };
type HarnessOptions = {
  restore?: (publish: (next: TasksState) => void, calls: { restore: number; check: number }) => Promise<RecoveryOutcome>;
  check?: (publish: (next: TasksState) => void, calls: { restore: number; check: number }) => Promise<TasksState>;
};

function candidate(taskCount = 6, savedAt = Date.UTC(2026, 1, 18, 16, 42)): RecoveryState {
  return { kind: 'recovery', reason: 'unreadable', message: 'Private native recovery details are not displayed.',
    resolution: { kind: 'candidate', backup: { taskCount, savedAt } } };
}
function recovery(resolution: Record<string, unknown>, message = 'Private native recovery details are not displayed.'): RecoveryState {
  return { kind: 'recovery', reason: 'unreadable', message, resolution } as unknown as RecoveryState;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function harness(initial: TasksState = candidate(), options: HarnessOptions = {}) {
  let state = initial;
  const listeners = new Set<(next: TasksState) => void>();
  const calls = { restore: 0, check: 0 };
  const publish = (next: TasksState): void => {
    state = next;
    for (const listener of [...listeners]) listener(next);
  };
  const facade = {
    getState: () => state,
    subscribe: (listener: (next: TasksState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvents: () => () => undefined,
    initialize: async () => state,
    restoreBackup: async () => {
      calls.restore++;
      publish(recovery({ kind: 'restoring', backup: { taskCount: 6, savedAt: Date.UTC(2026, 1, 18, 16, 42) } }));
      return options.restore ? options.restore(publish, calls) : { kind: 'failed' as const };
    },
    checkBackupAgain: async () => {
      calls.check++;
      return options.check ? options.check(publish, calls) : candidate();
    },
  } as unknown as TasksFacade & { checkBackupAgain(): Promise<TasksState> };
  return { facade, calls, publish, getState: () => state };
}

function mount(initial: TasksState = candidate(), options: HarnessOptions = {}) {
  const app = harness(initial, options);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/tasks.html', pretendToBeVisual: true });
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  const screen = mountTasksRecovery(root, app.facade, initial as RecoveryState);
  return { ...app, dom, root, screen };
}

function click(root: HTMLElement, selector: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(selector);
  assert.ok(button, `Expected button ${selector}`);
  button.click();
  return button;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await new Promise<void>(resolve => setImmediate(resolve));
}

async function until(condition: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

test('restore requires a second explicit action, and busy state focuses status and blocks duplicate or Escape cancellation', async () => {
  const restoreGate = deferred<RecoveryOutcome>();
  const app = mount(candidate(), { restore: async () => restoreGate.promise });
  try {
    const primary = click(app.root, '.tasks-recovery-primary');
    assert.equal(app.calls.restore, 0, 'the first Restore backup click only opens inline confirmation');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.textContent, 'Restore this backup?');
    assert.equal(primary.getAttribute('aria-describedby'), 'tasks-recovery-warning');
    assert.equal(app.root.querySelector('.tasks-recovery-column')?.getAttribute('aria-describedby'), 'tasks-recovery-warning');
    assert.equal(app.root.querySelector('[role="dialog"]'), null, 'confirmation stays inline, not modal');
    assert.equal(app.dom.window.document.activeElement, app.root.querySelector('.tasks-recovery-title'));
    click(app.root, '.tasks-recovery-cancel');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.textContent, 'Tasks need recovery');
    assert.equal(app.calls.restore, 0, 'Cancel returns to the candidate without restoring');
    click(app.root, '.tasks-recovery-primary');
    const cancelEscape = new app.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    app.dom.window.document.dispatchEvent(cancelEscape);
    assert.equal(cancelEscape.defaultPrevented, true);
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.textContent, 'Tasks need recovery');
    assert.equal(app.calls.restore, 0, 'Escape returns to the candidate without restoring');
    click(app.root, '.tasks-recovery-primary');

    const confirm = click(app.root, '.tasks-recovery-primary');
    assert.equal(app.calls.restore, 1, 'the second explicit click issues exactly one restore');
    assert.equal(app.root.querySelector('.tasks-recovery-column')?.getAttribute('aria-busy'), 'true');
    assert.equal(app.dom.window.document.activeElement, app.root.querySelector('.tasks-recovery-title'));
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.getAttribute('role'), 'status');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.getAttribute('aria-live'), 'polite');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.getAttribute('aria-atomic'), 'true');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.textContent, "Restoring backup. Banana Tasks will reload when it's ready.");
    assert.equal(confirm.disabled, true);
    assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-cancel')?.disabled, true);
    confirm.click();
    assert.equal(app.calls.restore, 1, 'disabled confirmation cannot submit twice');

    const escape = new app.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    app.dom.window.document.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.textContent, "Restoring backup. Banana Tasks will reload when it's ready.");

    restoreGate.resolve({ kind: 'failed' });
    await until(() => app.root.querySelector('.tasks-recovery-body')?.textContent?.includes("The restore couldn't finish") === true,
      'Restore failure did not enter the explicit reinspection state.');
    assert.equal(app.calls.restore, 1);
    assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-primary'), null);
    assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-check')?.hidden, false);
    assert.equal(app.root.querySelector('.tasks-recovery-column')?.getAttribute('aria-busy'), 'false');
    assert.equal(app.root.querySelector('.tasks-recovery-title')?.getAttribute('role'), 'alert');
    assert.equal(app.dom.window.document.activeElement, app.root.querySelector('.tasks-recovery-title'));
  } finally {
    app.screen.dispose(); app.dom.window.close();
  }
});

test('conflict and failure require Check backup again and a fresh confirmation after candidate metadata changes', async () => {
  for (const [outcome, expectedCopy] of [
    [{ kind: 'conflict' } as const, 'Task files changed while recovery was open. Nothing was restored. Check the backup again before choosing restore.'],
    [{ kind: 'failed' } as const, "The restore couldn't finish. Check backup availability before choosing what to do next."],
  ] as const) {
    let restoreAttempt = 0;
    const app = mount(candidate(), {
      restore: async publish => {
        restoreAttempt++;
        if (restoreAttempt === 1) {
          publish(candidate(2, Date.UTC(2026, 1, 19, 10, 0)));
          return outcome;
        }
        publish(recovery({ kind: 'restore-failed', backup: { taskCount: 2, savedAt: Date.UTC(2026, 1, 19, 10, 0) } }));
        return { kind: 'failed' };
      },
      check: async publish => {
        const checking = recovery({ kind: 'checking' });
        publish(checking);
        const fresh = candidate(2, Date.UTC(2026, 1, 19, 10, 0));
        publish(fresh);
        return fresh;
      },
    });
    try {
      click(app.root, '.tasks-recovery-primary');
      click(app.root, '.tasks-recovery-primary');
      await until(() => app.root.querySelector('.tasks-recovery-body')?.textContent === expectedCopy,
        `${outcome.kind} did not require explicit reinspection.`);
      assert.equal(app.calls.restore, 1);
      assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-primary'), null, 'a refreshed candidate cannot auto-confirm after an error');
      click(app.root, '.tasks-recovery-check');
      await until(() => app.calls.check === 1 && app.root.querySelector('.tasks-recovery-body')?.textContent === "The saved task list couldn't be opened. Nothing has been changed.",
        'Check backup again did not return to a fresh candidate.');
      assert.equal(app.calls.restore, 1, 'inspection never calls restore');
      assert.match(app.root.querySelector('.tasks-recovery-backup-count')?.textContent ?? '', /2 tasks/);
      assert.equal(app.root.querySelector<HTMLParagraphElement>('.tasks-recovery-warning')?.hidden, true, 'fresh candidate still requires a new confirmation');

      click(app.root, '.tasks-recovery-primary');
      assert.equal(app.calls.restore, 1, 'the next first click only opens confirmation');
      click(app.root, '.tasks-recovery-primary');
      await until(() => app.calls.restore === 2, 'A fresh explicit confirmation did not issue the second restore.');
      assert.equal(app.calls.check, 1);
    } finally {
      app.screen.dispose(); app.dom.window.close();
    }
  }
});

test('unavailable, unsupported and absent-backup states fail closed with only supported inspection actions', () => {
  const cases: Array<{ state: RecoveryState; restoreVisible: boolean; checkVisible: boolean; copy: string }> = [
    { state: recovery({ kind: 'unavailable' }), restoreVisible: false, checkVisible: false,
      copy: "Banana Tasks couldn't check for a valid backup. Nothing has been changed." },
    { state: recovery({ kind: 'unsupported-version' }), restoreVisible: false, checkVisible: false,
      copy: "This task data isn't supported by this version of Banana Tasks. Use a compatible version to continue." },
    { state: recovery({ kind: 'no-valid-backup' }), restoreVisible: false, checkVisible: true,
      copy: 'No valid backup is available. Nothing has been changed.' },
    { state: recovery({ kind: 'inspection-failed' }), restoreVisible: false, checkVisible: true,
      copy: "Banana Tasks couldn't check for a valid backup. Nothing has been changed." },
  ];
  for (const item of cases) {
    const app = mount(item.state);
    try {
      assert.equal(app.root.querySelector('.tasks-recovery-body')?.textContent, item.copy);
      assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-primary') !== null, item.restoreVisible);
      assert.equal(app.root.querySelector<HTMLButtonElement>('.tasks-recovery-check')?.hidden, !item.checkVisible);
      assert.equal(app.root.querySelector('.tasks-recovery-column')?.getAttribute('aria-busy'), 'false');
    } finally {
      app.screen.dispose(); app.dom.window.close();
    }
  }
});

test('backup count and saved time use bounded text rendering and never interpret untrusted values as markup', () => {
  const app = mount(candidate());
  try {
    assert.equal(app.root.querySelector('.tasks-recovery-backup-count')?.textContent, '6 tasks');
    assert.match(app.root.querySelector('.tasks-recovery-backup-saved')?.textContent ?? '', /^Saved /);
    const malformed = recovery({ kind: 'candidate', backup: {
      taskCount: '<img src=x onerror=alert(1)>' as unknown as number,
      savedAt: Number.NaN,
    } });
    app.screen.update(malformed);
    assert.equal(app.root.querySelector<HTMLElement>('.tasks-recovery-backup')?.hidden, true);
    assert.equal(app.root.querySelector('img[onerror]'), null);
    assert.doesNotMatch(app.root.textContent ?? '', /<img|alert\(1\)/);
  } finally {
    app.screen.dispose(); app.dom.window.close();
  }
});

test('the mounted startup recovery surface removes capture, normal task controls and the task footer', async () => {
  const state = candidate();
  const listeners = new Set<(event: { kind: 'window'; event: Exclude<TasksWindowEvent, { kind: 'flush' }> }) => void>();
  const facade = {
    ...harness(state).facade,
    getState: () => state,
    initialize: async () => state,
    subscribeEvents: (listener: (event: { kind: 'window'; event: Exclude<TasksWindowEvent, { kind: 'flush' }> }) => void) => {
      listeners.add(listener); return () => listeners.delete(listener);
    },
  } as unknown as TasksFacade;
  const windowPort: TasksWindowPort = {
    environment: 'native', subscribe: () => () => undefined, acknowledgeFlush: async () => undefined,
    setDragRegion: async () => undefined, copyText: async () => undefined,
  };
  const dom = new JSDOM('<!doctype html><html><body><div id="app" aria-busy="true"></div></body></html>', {
    url: 'http://localhost/tasks.html', pretendToBeVisual: true,
  });
  const root = dom.window.document.querySelector<HTMLElement>('#app')!;
  const screen = mountTasksApp(root, facade, { window: windowPort, fontState: DEFAULT_NOTE_FONT_STATE });
  try {
    await settle();
    assert.equal(root.querySelector('.tasks-recovery-screen') !== null, true);
    assert.equal(root.querySelector('.tasks-capture-form'), null);
    assert.equal(root.querySelector('.tasks-list-heading'), null);
    assert.equal(root.querySelector('.tasks-state-tabs'), null);
    assert.equal(root.querySelector('.tasks-plan-button'), null);
    assert.equal(root.querySelector('.tasks-footer-icon'), null);
    assert.equal(root.querySelector('.tasks-settings'), null);
    assert.equal(root.querySelector('.tasks-list-footer'), null);
    assert.equal(root.querySelector('.tasks-recovery-footer') !== null, true);
    assert.equal(dom.window.document.activeElement, root.querySelector('.tasks-recovery-title'));
    for (const listener of [...listeners]) {
      listener({ kind: 'window', event: { kind: 'command', command: 'newTask' } });
      listener({ kind: 'window', event: { kind: 'command', command: 'settings' } });
    }
    assert.equal(root.querySelector('.tasks-capture-form'), null, 'keyboard capture commands stay blocked during recovery');
    assert.equal(root.querySelector('.tasks-settings'), null, 'keyboard Settings commands stay blocked during recovery');
    assert.equal(root.getAttribute('aria-busy'), 'false');
  } finally {
    screen.dispose(); dom.window.close();
  }
});
