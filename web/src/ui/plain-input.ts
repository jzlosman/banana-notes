/** Query and name fields: keep macOS autocorrect, completion and capitalization out of what the user types. */
export function plainInput<T extends HTMLInputElement>(input: T): T {
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  return input;
}
