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

/**
 * Any port on this computer: where the Admin page's `?api=` override may point (`resolveApiUrl` in results-view.ts),
 * e.g. `npm run results-api:dev` on localhost:8788.
 */
export const LOCAL_API_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*'];

/**
 * The same headers, with the Content-Security-Policy also letting the page reach a results API on this computer and
 * show its images (`connect-src`, `img-src`). The dev server's only: the deployed site's policy never allows it.
 */
export function withLocalApi(headers: Record<string, string>): Record<string, string> {
  const csp = headers['Content-Security-Policy'];
  if (!csp) return headers;
  const directives = csp
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => (/^(connect-src|img-src)\s/.test(directive) ? `${directive} ${LOCAL_API_SOURCES.join(' ')}` : directive));
  return { ...headers, 'Content-Security-Policy': directives.join('; ') };
}

/** The headers `_headers` gives a path (later rules win, as on Cloudflare). */
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rule of rules) if (rule.pattern.test(pathname)) Object.assign(headers, rule.headers);
  return headers;
}
