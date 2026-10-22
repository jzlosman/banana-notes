import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryCommands } from '../src/application/library-commands';
import { LibrarySession } from '../src/application/session';
import { ProjectCommands } from '../src/application/project-commands';
import { projectContent } from '../src/domain/project-content';
import type { Library } from '../src/domain/library';

const now = '2026-05-03T12:00:00.000Z';
const original: Library = {
  version: 1,
  selectedID: 'note-1',
  activeTag: null,
  notes: [{ id: 'note-1', markdown: '# Existing\n\n- [ ] Ship it', createdAt: now, updatedAt: now }],
};
const commands = () => new LibraryCommands({ now: () => now }, { next: () => 'note-2' });

test('library commands apply deterministic time and identity ports to state transitions', () => {
  const useCases = commands();
  const created = useCases.create(original);
  assert.equal(created.kind, 'applied');
  if (created.kind !== 'applied') return;
  const note = created.library.notes.find(item => item.id === 'note-2')!;
  assert.equal(note.createdAt, now);
  assert.equal(note.updatedAt, now);

  const edited = useCases.edit(created.library, 'note-1', '# Updated');
  assert.equal(edited.kind, 'applied');
  if (edited.kind !== 'applied') return;
  assert.equal(edited.library.notes.find(item => item.id === 'note-1')?.updatedAt, now);

  const trashed = useCases.trash(edited.library, 'note-1');
  assert.equal(trashed.notes.find(item => item.id === 'note-1')?.trashedAt, now);
  const restored = useCases.restore(trashed, 'note-1');
  assert.equal(restored.notes.find(item => item.id === 'note-1')?.trashedAt, undefined);
});

test('library session publishes one authoritative snapshot and changes version only on replacement', () => {
  const session = new LibrarySession(original);
  assert.equal(session.library, original);
  assert.equal(session.version, 0);
  session.replace(original);
  assert.equal(session.version, 0);
  const next = commands().selectNotebook(original, 'project');
  assert.equal(session.replace(next), next);
  assert.equal(session.library, next);
  assert.equal(session.version, 1);
});

test('project command rejects a task reference after its source note changes', () => {
  const task = projectContent(original.notes).tasks[0];
  const useCases = new ProjectCommands({ now: () => now });
  const changed = commands().edit(original, 'note-1', '# Existing\n\n- [x] Ship it');
  assert.equal(changed.kind, 'applied');
  if (changed.kind !== 'applied') return;
  assert.deepEqual(useCases.toggleTask(changed.library, task, true), { ok: false, error: 'stale-source' });
});
