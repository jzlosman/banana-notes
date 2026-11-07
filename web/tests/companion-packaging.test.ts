import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tasksHTML = readFileSync(fileURLToPath(new URL('../tasks.html', import.meta.url)), 'utf8');

test('bundled Tasks content has no network, frame, inline-script, or form-submission capability', () => {
  const policy = tasksHTML.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy, 'the shipped entry point must declare its CSP');
  const directives = new Map(policy.split(';').filter(part => part.trim()).map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values] as const;
  }));
  for (const name of ['default-src', 'connect-src', 'frame-src', 'media-src', 'object-src', 'base-uri', 'form-action']) {
    assert.deepEqual(directives.get(name), ["'none'"], `${name} must fail closed`);
  }
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.deepEqual(directives.get('font-src'), ["'self'"]);
  assert.doesNotMatch(tasksHTML, /<script\b[^>]*>\s*[^<\s]/i);
  for (const match of tasksHTML.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi)) {
    assert.match(match[1], /^[a-z0-9][a-z0-9/.-]*$/i);
    assert.ok(!match[1].split('/').includes('..'), 'bundled resources cannot escape their app directory');
  }
  assert.match(tasksHTML, /src="tasks\.js"/);
  assert.match(tasksHTML, /href="tasks\.css"/);
});
