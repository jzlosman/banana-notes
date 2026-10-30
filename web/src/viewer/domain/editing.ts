export type ViewerEditState = { kind: 'locked' } | { kind: 'unlocked'; dirty: boolean };

export type DocumentWriteResult =
  | { kind: 'saved'; revision: string }
  | { kind: 'conflict' }
  | { kind: 'failed'; reason: 'readOnlyFile' | 'permissionDenied' | 'tooLarge' | 'unknown' };

export function unlock(state: ViewerEditState): ViewerEditState {
  if (state.kind === 'unlocked') return state;
  return { kind: 'unlocked', dirty: false };
}

export function markDirty(state: ViewerEditState, dirty: boolean): ViewerEditState {
  if (state.kind === 'locked') throw new Error('A locked document cannot be edited.');
  return { kind: 'unlocked', dirty };
}

export function lock(state: ViewerEditState): ViewerEditState {
  if (state.kind === 'unlocked' && state.dirty) throw new Error('A document with unsaved edits cannot be locked.');
  return { kind: 'locked' };
}

export function canSave(state: ViewerEditState): boolean {
  return state.kind === 'unlocked' && state.dirty;
}

type EditHunk = { start: number; end: number; replacement: string[] };
type Operation = { kind: 'equal' | 'delete' | 'insert'; value: string };

function lineBody(line: string): string { return line.replace(/\r\n$|\r$|\n$/, ''); }
function sameLine(left: string, right: string): boolean { return lineBody(left) === lineBody(right); }

/** Myers line diff; line tokens retain their terminators so unchanged source bytes are reusable. */
function diffLines(before: readonly string[], after: readonly string[]): Operation[] {
  const n = before.length, m = after.length;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let distance = 0;
  outer: for (let d = 0; d <= n + m; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && sameLine(before[x]!, after[y]!)) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) { distance = d; break outer; }
    }
  }

  let x = n, y = m;
  const reversed: Operation[] = [];
  for (let d = distance; d >= 0; d--) {
    const previous = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = d === 0 ? 0 : (previous.get(previousK) ?? 0);
    const previousY = d === 0 ? 0 : previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push({ kind: 'equal', value: before[x - 1]! }); x--; y--;
    }
    if (d === 0) break;
    if (x === previousX) { reversed.push({ kind: 'insert', value: after[y - 1]! }); y--; }
    else { reversed.push({ kind: 'delete', value: before[x - 1]! }); x--; }
  }
  return reversed.reverse();
}

function hunks(before: readonly string[], after: readonly string[]): EditHunk[] {
  const result: EditHunk[] = [];
  let oldIndex = 0;
  let pending: EditHunk | undefined;
  for (const operation of diffLines(before, after)) {
    if (operation.kind === 'equal') {
      pending = undefined;
      oldIndex++;
    } else {
      if (!pending) { pending = { start: oldIndex, end: oldIndex, replacement: [] }; result.push(pending); }
      if (operation.kind === 'delete') { pending.end++; oldIndex++; }
      else pending.replacement.push(operation.value);
    }
  }
  return result;
}

function lines(text: string): string[] {
  const result = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g);
  return result ?? [];
}

function dominantLineEnding(source: string): string {
  const counts = new Map<string, number>();
  for (const ending of source.match(/\r\n|\r|\n/g) ?? []) counts.set(ending, (counts.get(ending) ?? 0) + 1);
  let dominant = '\n', highestCount = 0;
  for (const [ending, count] of counts) {
    if (count > highestCount) { dominant = ending; highestCount = count; }
  }
  return dominant;
}

type SourceAlignment = {
  baselineToOriginal: (number | undefined)[];
  changedRegions: { originalStart: number; originalEnd: number; baselineStart: number; baselineEnd: number }[];
};

function sourceAlignment(original: readonly string[], baseline: readonly string[]): SourceAlignment {
  const baselineToOriginal: (number | undefined)[] = Array(baseline.length).fill(undefined);
  const changedRegions: SourceAlignment['changedRegions'] = [];
  let originalIndex = 0, baselineIndex = 0;
  let changed: SourceAlignment['changedRegions'][number] | undefined;
  const finishRegion = () => { if (changed) { changedRegions.push(changed); changed = undefined; } };
  for (const operation of diffLines(original, baseline)) {
    if (operation.kind === 'equal') {
      finishRegion();
      baselineToOriginal[baselineIndex] = originalIndex;
      originalIndex++; baselineIndex++;
    } else {
      changed ??= { originalStart: originalIndex, originalEnd: originalIndex, baselineStart: baselineIndex, baselineEnd: baselineIndex };
      if (operation.kind === 'delete') { originalIndex++; changed.originalEnd = originalIndex; }
      else { baselineIndex++; changed.baselineEnd = baselineIndex; }
    }
  }
  finishRegion();
  return { baselineToOriginal, changedRegions };
}

function projectHunk(hunk: EditHunk, alignment: SourceAlignment, originalLength: number): { start: number; end: number } {
  const mapping = alignment.baselineToOriginal;
  let left: number | undefined, right: number | undefined;
  for (let index = hunk.start - 1; index >= 0; index--) {
    if (mapping[index] !== undefined) { left = mapping[index]!; break; }
  }
  for (let index = hunk.end; index < mapping.length; index++) {
    if (mapping[index] !== undefined) { right = mapping[index]!; break; }
  }
  const start = left === undefined ? 0 : left + 1;
  const end = right === undefined ? originalLength : right;
  let projectedStart = Math.min(start, end), projectedEnd = Math.max(start, end);
  for (const region of alignment.changedRegions) {
    const intersects = hunk.start < region.baselineEnd && hunk.end > region.baselineStart;
    const insertedInside = hunk.start === hunk.end && hunk.start >= region.baselineStart && hunk.start < region.baselineEnd;
    const replacesDeletedRegion = region.baselineStart === region.baselineEnd && hunk.start === region.baselineStart;
    if (intersects || insertedInside || replacesDeletedRegion) {
      projectedStart = Math.min(projectedStart, region.originalStart);
      projectedEnd = Math.max(projectedEnd, region.originalEnd);
    }
  }
  return { start: projectedStart, end: projectedEnd };
}

/**
 * Apply only the editor's changed line hunks to the exact original source. The rich editor can
 * normalize Markdown while parsing; O↔B alignment confines that normalization to hunks actually
 * changed by the user. Unchanged original line tokens, including their line endings, are reused.
 */
export function patchRichMarkdown(original: string, baseline: string, edited: string): string {
  if (edited === baseline) return original;
  const originalLines = lines(original), baselineLines = lines(baseline), editedLines = lines(edited);
  const lineEnding = dominantLineEnding(original);
  const alignment = sourceAlignment(originalLines, baselineLines);
  const changes = hunks(baselineLines, editedLines).map(hunk => ({
    ...projectHunk(hunk, alignment, originalLines.length),
    replacement: hunk.replacement.map(line => `${lineBody(line)}${lineEnding}`),
  }));
  if (!changes.length) return original;
  const output: { token: string; replacement: boolean }[] = [];
  const appendOriginal = (sourceLines: readonly string[]) => {
    output.push(...sourceLines.map(token => ({ token, replacement: false })));
  };
  let cursor = 0;
  for (const change of changes) {
    const start = Math.max(cursor, change.start);
    const end = Math.max(start, change.end);
    appendOriginal(originalLines.slice(cursor, start));
    output.push(...change.replacement.map(token => ({ token, replacement: true })));
    cursor = end;
  }
  appendOriginal(originalLines.slice(cursor));
  let result = output.map(line => line.token).join('');
  const originalHasFinalNewline = /(?:\r\n|\r|\n)$/.test(original);
  if (originalHasFinalNewline && !/(?:\r\n|\r|\n)$/.test(result)) result += lineEnding;
  else if (!originalHasFinalNewline && output.at(-1)?.replacement) result = result.replace(/(?:\r\n|\r|\n)$/, '');
  return result;
}

/** Source editor text is already the exact document representation; never serialize or normalize it. */
export function markdownForSave(original: string, baseline: string, edited: string, sourceMode = false): string {
  return sourceMode ? edited : patchRichMarkdown(original, baseline, edited);
}
