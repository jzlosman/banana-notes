export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').normalize('NFC').toLocaleLowerCase('en-US');
}
export function validTag(value: string): boolean { return /^[\p{L}][\p{L}\p{N}_/-]*$/u.test(value) && value.length <= 80; }
