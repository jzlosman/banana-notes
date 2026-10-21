import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNote, updateNote, navigate, orderedNotes, notebookTags, selectNotebook, splitDocument, withTag, tagsOf, titleOf, validateLibrary, trashNote, restoreNote, trashedNotes, type Library } from '../src/domain';
const time = (n:number) => `2026-10-${String(n).padStart(2,'0')}T12:00:00.000Z`;
const empty = (): Library => ({version:1, notes:[], selectedID:null, activeTag:null});
function fixture(): Library {
  let lib = empty();
  for (const [id, md, n] of [['one','# One\n#project',1],['two','# Two\n#personal',2],['three','# Three\n#project #ideas',3]] as const) {
    lib=createNote(lib,id,time(n)); lib=updateNote(lib,id,md,time(n));
  }
  return lib;
}
test('hashtags and YAML tags normalize, deduplicate, and ignore code/headings/URL fragments',()=>{
  const markdown='---\ntags: [Project, ideas]\ntitle: Keep me\n---\n# A heading\n#project (#work/project) #café\n`#literal` [link](https://site/#fragment) \\#escaped\n```js\n#not-a-tag\n```';
  assert.deepEqual(tagsOf(markdown),['café','ideas','project','work/project']);
});
test('Markdown literals, unclosed fences, indented code and escaped hashes do not create tags',()=>{
  assert.deepEqual(tagsOf('#actual **#bold** \\#escaped\n\n    #indented\n\n~~~js\n#unclosed'),['actual','bold']);
  assert.deepEqual(tagsOf('[#visible](https://example.com/#not-a-tag) ![#alt](image.png)'),['visible']);
});
test('block-list frontmatter and space-separated tags work',()=>{
  assert.deepEqual(tagsOf('---\ntags:\n  - Project\n  - personal\n---\nHello'),['personal','project']);
  assert.deepEqual(tagsOf('---\ntags: project, ideas\n---\nHello'),['ideas','project']);
});
test('adding a tag preserves other frontmatter fields and document body',()=>{
  const next=withTag('---\ntitle: Meeting\ntags: [ideas]\n---\n# Note\n\nBody','Project');
  const parts=splitDocument(next);
  assert.equal(parts.body,'# Note\n\nBody'); assert.equal(parts.metadata.title,'Meeting');
  assert.deepEqual(tagsOf(next),['ideas','project']); assert.equal(withTag(next,'#project'),next);
});
test('invalid frontmatter never drops text or permits destructive rewrite',()=>{
  const bad='---\ntags: [oops\n---\nPrivate text';
  assert.equal(splitDocument(bad).body,bad); assert.ok(splitDocument(bad).error);
  assert.throws(()=>withTag(bad,'project')); assert.throws(()=>withTag('hello','not a tag'));
});
test('notebook navigation is stable by creation, excludes other tags, and clamps',()=>{
  let lib=selectNotebook(fixture(),'project');
  assert.deepEqual(orderedNotes(lib).map(n=>n.id),['three','one']);
  lib=navigate(lib,1); assert.equal(lib.selectedID,'one');
  assert.equal(navigate(lib,1).selectedID,'one'); assert.equal(navigate(lib,-1).selectedID,'three');
  lib=updateNote(lib,'one','# Edited #project',time(20));
  assert.deepEqual(orderedNotes(lib).map(n=>n.id),['three','one']);
  assert.equal(selectNotebook(lib,'personal').selectedID,'two');
});
test('new notes inherit current notebook and selection',()=>{
  const lib=createNote(selectNotebook(fixture(),'project'),'four',time(4));
  assert.equal(lib.selectedID,'four'); assert.deepEqual(tagsOf(lib.notes[0].markdown),['project']);
  assert.throws(()=>createNote(lib,'four',time(5)));
});
test('empty scopes have no selected note; leaving restores whole collection',()=>{
  const lib=selectNotebook(fixture(),'missing'); assert.equal(lib.selectedID,null);
  assert.deepEqual(orderedNotes(lib),[]); assert.equal(navigate(lib,1).selectedID,null);
  assert.equal(selectNotebook(lib,null).notes.length,3);
  assert.throws(()=>selectNotebook(lib,'not valid!'));
});
test('tag counts are per note, not occurrences; title ignores frontmatter',()=>{
  assert.deepEqual(notebookTags(fixture()),[{tag:'ideas',count:1},{tag:'personal',count:1},{tag:'project',count:2}]);
  assert.equal(titleOf('---\ntags: [project]\n---\n# First thought\nBody'),'First thought');
  assert.equal(titleOf('#project\n\n# A real title'),'A real title');
});
test('leading media cannot replace the note heading with an asset URL',()=>{
  assert.equal(titleOf('![Photo](foldnote-asset://media/12345678-1234-1234-1234-123456789abc.png)\n\n# A real heading\nBody'),'A real heading');
  assert.equal(titleOf('<audio controls src="foldnote-asset://media/12345678-1234-1234-1234-123456789abc.mp3"></audio>\n\n# Audio notes'),'Audio notes');
});
test('repository input rejects corrupt schema and duplicate IDs',()=>{
  assert.deepEqual(validateLibrary(fixture()),fixture());
  assert.throws(()=>validateLibrary({version:2,notes:[]}));
  const lib=fixture(); lib.notes.push(lib.notes[0]); assert.throws(()=>validateLibrary(lib));
});
test('trash preserves note content and timestamps, then restore round-trips the note',()=>{
  const original=fixture();
  const before=original.notes.find(note=>note.id==='two')!;
  const trashed=trashNote(original,'two',time(20));
  assert.deepEqual(trashed.notes.find(note=>note.id==='two'),{...before,trashedAt:time(20)});
  assert.equal(trashed.selectedID,original.selectedID);
  const restored=restoreNote(trashed,'two');
  assert.deepEqual(restored.notes.find(note=>note.id==='two'),before);
  assert.equal(restored.activeTag,trashed.activeTag);
});
test('trash is excluded from active lists, tags and notebook navigation; trash query ignores scope',()=>{
  const lib=trashNote(selectNotebook(fixture(),'project'),'three',time(20));
  assert.deepEqual(orderedNotes(lib).map(note=>note.id),['one']);
  assert.deepEqual(notebookTags(lib),[{tag:'personal',count:1},{tag:'project',count:1}]);
  assert.equal(navigate(lib,1).selectedID,'one');
  assert.deepEqual(trashedNotes(lib).map(note=>note.id),['three']);
});
test('trashing selected note chooses nearest surviving neighbor in scoped order',()=>{
  const scoped=selectNotebook(fixture(),'project');
  const deletingLast=trashNote({...scoped,selectedID:'one'},'one',time(20));
  assert.equal(deletingLast.selectedID,'three');
  const deletingFirst=trashNote({...scoped,selectedID:'three'},'three',time(20));
  assert.equal(deletingFirst.selectedID,'one');
  assert.equal(trashNote(scoped,'two',time(20)).selectedID,scoped.selectedID);
});
test('trash handles only, last-in-scope and empty scopes without clearing the notebook',()=>{
  const single=selectNotebook(createNote(empty(),'only',time(1)),'project');
  const after=trashNote(single,'only',time(20));
  assert.equal(after.selectedID,null); assert.equal(after.activeTag,'project');
  assert.deepEqual(orderedNotes(after),[]);
  const emptyScope=selectNotebook(fixture(),'missing');
  assert.equal(trashNote(emptyScope,'one',time(20)).selectedID,null);
});
test('trash and restore are idempotent; edits cannot mutate hidden notes',()=>{
  const lib=fixture();
  const trashed=trashNote(lib,'one',time(20));
  assert.equal(trashNote(trashed,'one','bad-time'),trashed);
  assert.equal(trashNote(lib,'missing','bad-time'),lib);
  assert.equal(restoreNote(lib,'one'),lib);
  assert.throws(()=>updateNote(trashed,'one','changed',time(21)));
  assert.deepEqual(updateNote(trashed,'missing','changed',time(21)).notes,trashed.notes);
});
test('trash timestamps are validated and malformed persisted markers are rejected',()=>{
  const lib=fixture();
  for (const bad of ['', 'not-a-date', '2026-02-30T12:00:00.000Z', null, false]) {
    assert.throws(()=>trashNote(lib,'one',bad as string));
    const persisted={...lib,notes:lib.notes.map(note=>note.id==='one'?{...note,trashedAt:bad}:note)};
    assert.throws(()=>validateLibrary(persisted));
  }
  const trashed=trashNote(lib,'one',time(20));
  assert.deepEqual(validateLibrary(trashed),{...trashed,selectedID:trashed.selectedID});
});
test('legacy libraries without trashedAt remain valid and selected trashed notes are repaired',()=>{
  const legacy=fixture();
  assert.deepEqual(validateLibrary(legacy),legacy);
  const withTrash=trashNote({...legacy,selectedID:'one'},'one',time(20));
  const invalidSelection={...withTrash,selectedID:'one'};
  assert.equal(validateLibrary(invalidSelection).selectedID,'three');
});
