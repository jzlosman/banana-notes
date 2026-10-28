import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScopeCommands } from '../src/application/scope-commands';
import { scopeKey, type ScopePreferences } from '../src/domain/scope-preferences';
import type { Library } from '../src/domain/library';

const date = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const library: Library = {
  version: 1, activeTag: null, selectedID: 'all-note', notes: [
    { id: 'all-note', markdown: '# All note\nEverywhere', createdAt: date(1), updatedAt: date(1) },
    { id: 'project-old', markdown: '#project\nOlder edit', createdAt: date(5), updatedAt: date(6) },
    { id: 'project-recent', markdown: '#project\nRecent edit', createdAt: date(2), updatedAt: date(10) },
  ],
};

test('scope application commands preserve the prior scope bookmark and restore it on return', () => {
  const commands = new ScopeCommands();
  let preferences: ScopePreferences = { pinnedTags: [], bookmarks: {} };
  const project = commands.select(library, ['project'], preferences);
  preferences = project.preferences;
  assert.equal(project.library.selectedID, 'project-recent');

  const selectedProject = { ...project.library, selectedID: 'project-old' };
  preferences = commands.rememberSelection(project.library, selectedProject, preferences);
  const all = commands.select(selectedProject, [], preferences);
  preferences = all.preferences;
  assert.equal(all.library.selectedID, 'all-note');

  const restored = commands.select(all.library, ['project'], preferences);
  assert.equal(restored.library.selectedID, 'project-old');
  assert.equal(restored.preferences.bookmarks[scopeKey(['project'])], 'project-old');
});

test('pin preference commands are idempotent and preserve user ordering', () => {
  const commands = new ScopeCommands();
  const pinned = commands.pin({ pinnedTags: [], bookmarks: {} }, ' Work ');
  const next = commands.pin(pinned, '#ideas');
  assert.deepEqual(next.pinnedTags, ['work', 'ideas']);
  assert.deepEqual(commands.move(next, 'ideas', -1).pinnedTags, ['ideas', 'work']);
  assert.deepEqual(commands.unpin(next, 'work').pinnedTags, ['ideas']);
});
