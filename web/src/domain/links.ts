const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'banananotes:', 'foldnote:']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export type LinkDestinationResult = { ok: true; href: string } | { ok: false; error: string };

function addDefaultProtocol(value: string): string {
  if (/^localhost(?::\d{1,5})?(?:[/?#]|$)/iu.test(value)) return `https://${value}`;
  if (/^(?:(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:[/?#]|$)/iu.test(value)) return `https://${value}`;
  return value;
}

export function normalizeLinkDestination(input: string): LinkDestinationResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Enter a link destination.' };
  if (CONTROL_CHARACTERS.test(trimmed)) return { ok: false, error: 'Control characters are not allowed in links.' };
  const href = addDefaultProtocol(trimmed);
  let parsed: URL;
  try { parsed = new URL(href); } catch { return { ok: false, error: 'Enter a valid link destination.' }; }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) return { ok: false, error: 'This link type is not allowed.' };
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (!parsed.hostname || parsed.username || parsed.password)) {
    return { ok: false, error: parsed.username || parsed.password ? 'Links cannot contain credentials.' : 'Enter a valid web address.' };
  }
  if (parsed.protocol === 'mailto:' && !parsed.pathname.trim()) return { ok: false, error: 'Enter an email recipient.' };
  if ((parsed.protocol === 'banananotes:' || parsed.protocol === 'foldnote:') && !parsed.hostname && !parsed.pathname.trim()) return { ok: false, error: 'Enter a Banana Notes destination.' };
  return { ok: true, href };
}

function canonicalURL(input: string): string | null {
  const normalized = normalizeLinkDestination(input);
  if (!normalized.ok) return null;
  try {
    const parsed = new URL(normalized.href);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    const path = parsed.pathname === '/' && (protocol === 'http:' || protocol === 'https:') ? '' : parsed.pathname;
    return `${protocol}//${hostname}${port}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return normalized.href;
  }
}

export function isRawURLLabel(text: string, href: string): boolean {
  const label = text.trim();
  if (!label || CONTROL_CHARACTERS.test(label)) return false;
  const labelCanonical = canonicalURL(label);
  const hrefCanonical = canonicalURL(href);
  return labelCanonical !== null && hrefCanonical !== null && labelCanonical === hrefCanonical;
}

export function compactRawLinkLabel(text: string, href: string): string | null {
  if (!isRawURLLabel(text, href)) return null;
  const points = Array.from(text);
  if (points.length <= 48) return null;
  return `${points.slice(0, 23).join('')}…${points.slice(-12).join('')}`;
}
