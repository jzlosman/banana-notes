import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{url:'http://localhost'});
for(const key of ['window','document','navigator','Node','HTMLElement','Element','MutationObserver','DOMParser','getComputedStyle','KeyboardEvent','MouseEvent','ClipboardEvent'] as const) {
  if(key in dom.window)Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true,writable:true});
}
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(0),0) as any;
globalThis.cancelAnimationFrame=id=>clearTimeout(id);
const {createMarkdownEditor}=await import('../src/ui/editor');
function mount(markdown:string,onChange=(md:string)=>{}) { const el=document.createElement('div'); document.body.append(el); return createMarkdownEditor(el,markdown,onChange); }
test('live editor renders common Markdown, tasks, tables and fenced code in one editable surface',()=>{
  const editor=mount('# Heading\n\n**Strong** and *emphasis* and ~~gone~~.\n\n- Bullet\n\n1. Ordered\n\n- [ ] A task\n\n> Quote\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| One | Two |');
  const html=editor.getHTML();
  for(const selector of ['h1','strong','em','s','ul','ol','input[type=checkbox]','blockquote','pre code','table th','table td'])assert.ok(editor.view.dom.querySelector(selector),`${selector} missing: ${html}`);
  const md=editor.getMarkdown(); assert.match(md,/# Heading/); assert.match(md,/\*\*Strong\*\*/); assert.match(md,/- \[ \] A task/); assert.match(md,/```js/); assert.match(md,/\| A\s*\| B/);
  editor.destroy();
});
test('editing and reparsing preserve Markdown semantics, including task completion',()=>{
  let saved=''; const editor=mount('## Before\n\n- [ ] Check me',md=>saved=md);
  editor.commands.setContent('## After\n\n- [x] Check me\n\nRegular paragraph',{contentType:'markdown'});
  assert.match(saved,/- \[x\] Check me/); const second=mount(saved);
  assert.equal(second.view.dom.querySelector('h2')?.textContent,'After');
  assert.equal(second.view.dom.querySelector('li')?.getAttribute('data-checked'),'true');
  assert.match(second.getText(),/Regular paragraph/); editor.destroy(); second.destroy();
});
test('opening multiple editors cannot change tag queries or another editor parser',async()=>{
  const {tagsOf,welcomeLibrary}=await import('../src/domain');
  const markdown=welcomeLibrary('welcome','2026-10-01T12:00:00.000Z').notes[0].markdown;
  const first=mount(markdown);
  for(let i=0;i<4;i++) {
    const other=mount('- [ ] A #work task\n\n# Header');
    assert.deepEqual(tagsOf(markdown),['project']);
    assert.deepEqual(tagsOf('- [ ] A #work task'),['work']);
    assert.match(first.getMarkdown(),/#project/);other.destroy();
  }
  first.destroy();
});
test('focusing a table-ending note cannot silently rewrite its source',async()=>{
  const writes:string[]=[]; const editor=mount('| A | B |\n|---|---|\n| One | Two |',markdown=>writes.push(markdown));
  editor.commands.focus('start',{scrollIntoView:false});
  await new Promise(resolve=>setTimeout(resolve,20));
  editor.commands.setTextSelection(2);
  assert.deepEqual(writes,[],'selection/focus normalization is not a note edit');
  editor.commands.insertContent('Edited'); assert.equal(writes.length,1);
  editor.destroy();
});
test('script and arbitrary HTML cannot execute as editor nodes',()=>{
  const editor=mount('<script>window.bad=true</script>\n\n[bad](javascript:alert(1))\n\nSafe text');
  assert.equal(editor.view.dom.querySelector('script'),null);
  assert.equal(editor.view.dom.querySelector('a[href^="javascript:"]'),null); editor.destroy();
});
