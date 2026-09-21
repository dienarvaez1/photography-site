// Reads Cloudflare's `public/_headers` file: a path pattern line, then indented "Name: value" lines.
// Plain module so the middleware and the tests can share it.

export interface HeaderRule {
  pattern: RegExp;
  headers: Record<string, string>;
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), headers: {} };
      rules.push(current);
    } else if (current) {
      const [name, ...value] = line.trim().split(':');
      current.headers[name.trim()] = value.join(':').trim();
    }
  }
  return rules;
}

/** The headers `_headers` gives a path (later rules win, as on Cloudflare). */
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rule of rules) if (rule.pattern.test(pathname)) Object.assign(headers, rule.headers);
  return headers;
}
