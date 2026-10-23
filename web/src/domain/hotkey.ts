export const HOTKEY_MODIFIERS = { command: 1 << 8, shift: 1 << 9, option: 1 << 11, control: 1 << 12 } as const;
export const DEFAULT_HOTKEY = { keyCode: 49, modifiers: HOTKEY_MODIFIERS.control | HOTKEY_MODIFIERS.shift } as const;

const keyCodes: Readonly<Record<string, number>> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9,
  KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19,
  Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
  Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32, BracketLeft: 33, KeyI: 34, KeyP: 35,
  Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44,
  KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
};

export interface ShortcutKeyInput {
  code: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}
export type RecordedShortcut = { keyCode: number; modifiers: number };
export type ShortcutRecordingResult = { ok: true; shortcut: RecordedShortcut } | { ok: false; reason: 'unmapped-key' | 'modifier-required' };

export function macKeyCodeForBrowserCode(code: string): number | null {
  return keyCodes[code] ?? null;
}

export function shortcutFromKeyEvent(event: ShortcutKeyInput): ShortcutRecordingResult {
  const keyCode = macKeyCodeForBrowserCode(event.code);
  if (keyCode === null) return { ok: false, reason: 'unmapped-key' };
  let modifiers = 0;
  if (event.metaKey) modifiers |= HOTKEY_MODIFIERS.command;
  if (event.shiftKey) modifiers |= HOTKEY_MODIFIERS.shift;
  if (event.altKey) modifiers |= HOTKEY_MODIFIERS.option;
  if (event.ctrlKey) modifiers |= HOTKEY_MODIFIERS.control;
  if (!(modifiers & (HOTKEY_MODIFIERS.command | HOTKEY_MODIFIERS.option | HOTKEY_MODIFIERS.control))) return { ok: false, reason: 'modifier-required' };
  return { ok: true, shortcut: { keyCode, modifiers } };
}
