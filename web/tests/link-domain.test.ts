import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactRawLinkLabel, isRawURLLabel, normalizeLinkDestination } from '../src/domain/links';

test('normalizes safe bare web addresses and preserves valid destinations', () => {
  assert.deepEqual(normalizeLinkDestination(' example.com/path?q=1 '), { ok: true, href: 'https://example.com/path?q=1' });
  assert.deepEqual(normalizeLinkDestination('example.com:8443/path'), { ok: true, href: 'https://example.com:8443/path' });
  assert.deepEqual(normalizeLinkDestination('localhost:3000/path'), { ok: true, href: 'https://localhost:3000/path' });
  assert.deepEqual(normalizeLinkDestination('HTTP://example.com/a'), { ok: true, href: 'HTTP://example.com/a' });
  for (const value of ['mailto:notes@example.com', 'banananotes://note/123', 'foldnote:note/123']) assert.equal(normalizeLinkDestination(value).ok, true);
});

test('rejects empty, unsafe, malformed, credential-bearing and recipient-less destinations', () => {
  for (const value of ['', '   ', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@example.com', 'http://user@example.com', 'mailto:', 'banananotes:', 'foldnote:', 'https://exa mple.com', 'https://example.com\n.test']) {
    assert.equal(normalizeLinkDestination(value).ok, false, value);
  }
});

test('raw URL labels compare canonically without confusing descriptive labels', () => {
  assert.equal(isRawURLLabel('example.com/path', 'https://example.com/path'), true);
  assert.equal(isRawURLLabel('https://example.com/path', 'https://EXAMPLE.com/path'), true);
  assert.equal(isRawURLLabel('Read the docs', 'https://example.com/path'), false);
  assert.equal(isRawURLLabel('example.com/other', 'https://example.com/path'), false);
});

test('compacts only long raw labels to the exact Unicode-safe budget', () => {
  const href = 'https://example.com/a/very/long/path/that/continues/with/more/segments?query=hello';
  const text = href.replace(/^https:\/\//, '');
  const compact = compactRawLinkLabel(text, href);
  assert.equal(Array.from(compact!).length, 36);
  assert.equal(compact, `${Array.from(text).slice(0, 23).join('')}…${Array.from(text).slice(-12).join('')}`);
  assert.equal(compactRawLinkLabel('https://example.com/short', 'https://example.com/short'), null);
  assert.equal(compactRawLinkLabel('A useful article', href), null);
  const emojiURL = `https://example.com/${'😀'.repeat(45)}`;
  const emojiCompact = compactRawLinkLabel(emojiURL, emojiURL);
  assert.equal(Array.from(emojiCompact!).length, 36);
  assert.equal(emojiCompact, `${Array.from(emojiURL).slice(0, 23).join('')}…${Array.from(emojiURL).slice(-12).join('')}`);
});
