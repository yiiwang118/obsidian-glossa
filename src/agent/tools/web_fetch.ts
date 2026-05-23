import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { buildTool, type ToolImpl } from './_shared';

/** True for any IPv4 address in a non-routable / private / loopback / CGNAT
 *  / link-local block. */
function isPrivateIPv4(ip: string): boolean {
  if (!/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;                              // 10.0.0.0/8
  if (a === 127) return true;                             // loopback
  if (a === 0) return true;                               // 0.0.0.0/8
  if (a === 169 && b === 254) return true;                // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16/12
  if (a === 192 && b === 168) return true;                // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64/10 (CGNAT)
  if (a >= 224) return true;                              // multicast + reserved
  return false;
}

/** True for any IPv6 address in a non-routable / private / loopback / link-local block. */
function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;        // loopback / unspecified
  if (low.startsWith('fe80:')) return true;              // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true;  // unique-local fc00::/7
  if (low.startsWith('ff')) return true;                 // multicast
  // ::ffff:127.0.0.1 — embedded IPv4 loopback
  const v4embed = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4embed) return isPrivateIPv4(v4embed[1]);
  return false;
}

/** Resolve hostname and assert NO address in the answer set is private.
 *  Throws on private-IP hit so the caller bails out. */
async function assertPublicHost(host: string): Promise<void> {
  // Direct-IP shortcut — no DNS lookup needed.
  const ipver = isIP(host);
  if (ipver === 4 && isPrivateIPv4(host)) throw new Error(`refused: ${host} is a private IPv4`);
  if (ipver === 6 && isPrivateIPv6(host)) throw new Error(`refused: ${host} is a private IPv6`);
  if (ipver !== 0) return;

  // Suffix-based block (catches *.local, *.internal, *.localhost, etc.) — these
  // never resolve via public DNS but we don't want to wait for SERVFAIL.
  const low = host.toLowerCase();
  if (low === 'localhost' || low.endsWith('.localhost') || low.endsWith('.local') || low.endsWith('.internal')) {
    throw new Error(`refused: ${host} is a reserved hostname`);
  }

  // DNS lookup. Use { all: true } to inspect every A/AAAA returned; if ANY is
  // private we refuse — defends against DNS rebinding where a malicious record
  // resolves to 127.0.0.1.
  const records = await lookup(host, { all: true });
  for (const r of records) {
    if (r.family === 4 && isPrivateIPv4(r.address)) throw new Error(`refused: ${host} resolves to private IPv4 ${r.address}`);
    if (r.family === 6 && isPrivateIPv6(r.address)) throw new Error(`refused: ${host} resolves to private IPv6 ${r.address}`);
  }
}

/** Manually follow redirects so each hop can be re-validated against the
 *  private-IP block. Without this an attacker could 302-bounce a public host
 *  into 127.0.0.1. */
async function fetchWithSafeRedirects(url: string, signal: AbortSignal): Promise<Response> {
  const MAX_HOPS = 5;
  let current = url;
  for (let i = 0; i < MAX_HOPS; i++) {
    const u = new URL(current);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refused: non-http(s) protocol ${u.protocol}`);
    await assertPublicHost(u.hostname);
    const r = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal,
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return r;
      current = new URL(loc, current).toString();
      continue;
    }
    return r;
  }
  throw new Error(`refused: too many redirects (>${MAX_HOPS})`);
}

export const webFetch: ToolImpl = buildTool({
  // Network egress — destructive in the sense of having side effects (logs, billing)
  // even though it doesn't mutate the vault. Always require approval.
  isReadOnly: () => false,
  isDestructive: () => true,
  isConcurrencySafe: () => true,    // pure fetch — multiple in parallel is fine
  searchHint: 'fetch public web URL strip html',
  describe: a => `fetch ${a.url}`,
  spec: {
    name: 'web_fetch',
    description: 'Fetch a public web page (HTTPS) and return its text content (HTML stripped). 10s timeout. Localhost / private / link-local / CGNAT IPs are blocked at every redirect hop (defence against DNS rebinding). REQUIRES USER APPROVAL.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  run: async (_app, { url }, ctx) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return `Error: only http(s) URLs.`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      // If the agent loop's signal aborts (user pressed Stop), propagate
      // to our internal controller so the in-flight fetch / redirect chain
      // cancels promptly instead of running the full 10s timeout.
      const onParentAbort = () => { try { ctl.abort(); } catch {} };
      if (ctx?.signal) {
        if (ctx.signal.aborted) ctl.abort();
        else ctx.signal.addEventListener('abort', onParentAbort, { once: true });
      }
      try {
        const r = await fetchWithSafeRedirects(url, ctl.signal);
        // Stream-read with a hard byte cap so a 1GB blob can't fill RAM before
        // we get a chance to slice it. We stop reading the moment the buffer
        // grows past the cap and abort the underlying connection.
        const MAX_BYTES = 4_000_000;     // 4 MB raw HTML cap (yields ~30k chars after strip)
        let raw = '';
        const reader = r.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          let total = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            raw += decoder.decode(value, { stream: true });
            if (total > MAX_BYTES) {
              try { await reader.cancel(); } catch {}
              try { ctl.abort(); } catch {}
              raw += '\n[response truncated at 4 MB cap]';
              break;
            }
          }
          raw += decoder.decode();
        } else {
          // Older runtimes without ReadableStream — fall back to .text() but
          // still cap the final string slice.
          raw = await r.text();
        }
        clearTimeout(timer);
        const text = raw
          .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return text.length > 30_000 ? text.slice(0, 30_000) + '\n[truncated]' : text;
      } finally {
        clearTimeout(timer);
        if (ctx?.signal) ctx.signal.removeEventListener('abort', onParentAbort);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Distinguish "user pressed Stop" from "10s timeout" so the
        // surfaced message is honest.
        if (ctx?.signal?.aborted) return `Error: cancelled by user.`;
        return `Error: timeout after 10s`;
      }
      return `Error fetching ${url}: ${e.message}`;
    }
  },
});
