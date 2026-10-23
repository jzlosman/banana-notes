import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOTKEY, HOTKEY_MODIFIERS, macKeyCodeForBrowserCode, shortcutFromKeyEvent } from '../src/domain/hotkey';

test('browser physical keys map to macOS virtual key codes for letters, digits, navigation, function, and punctuation keys', () => {
  const expected: Record<string, number> = {
    KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, KeyB: 11,
    KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, KeyO: 31, KeyU: 32, KeyI: 34, KeyP: 35,
    KeyL: 37, KeyJ: 38, KeyK: 40, KeyN: 45, KeyM: 46,
    Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit5: 23, Digit6: 22, Digit7: 26, Digit8: 28, Digit9: 25, Digit0: 29,
    Space: 49, Enter: 36, Tab: 48, ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
    F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
    Minus: 27, Equal: 24, BracketLeft: 33, BracketRight: 30, Backslash: 42, Semicolon: 41, Quote: 39, Comma: 43, Period: 47, Slash: 44, Backquote: 50,
  };
  for (const [code, keyCode] of Object.entries(expected)) assert.equal(macKeyCodeForBrowserCode(code), keyCode, code);
  assert.equal(macKeyCodeForBrowserCode('Numpad1'), null);
});

test('global shortcut recording requires Command, Control, or Option and uses Carbon modifier masks', () => {
  assert.deepEqual(DEFAULT_HOTKEY, { keyCode: 49, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.shift });
  assert.deepEqual(shortcutFromKeyEvent({ code: 'KeyK', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false }), {
    ok: true, shortcut: { keyCode: 40, modifiers: 1 << 8 },
  });
  assert.deepEqual(shortcutFromKeyEvent({ code: 'Space', metaKey: false, shiftKey: true, altKey: false, ctrlKey: true }), {
    ok: true, shortcut: { keyCode: 49, modifiers: (1 << 9) | (1 << 12) },
  });
  assert.deepEqual(shortcutFromKeyEvent({ code: 'KeyA', metaKey: false, shiftKey: true, altKey: false, ctrlKey: false }), { ok: false, reason: 'modifier-required' });
  assert.deepEqual(shortcutFromKeyEvent({ code: 'Numpad1', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false }), { ok: false, reason: 'unmapped-key' });
});
