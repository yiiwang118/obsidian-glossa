import { buildTool, type ToolImpl } from './_shared';
import { fetchWithSafeRedirects, parseHttpUrl } from '../../utils/safe_web';

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
      parseHttpUrl(url);
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 10_000);
      // If the agent loop's signal aborts (user pressed Stop), propagate
      // to our internal controller so the in-flight fetch / redirect chain
      // cancels promptly instead of running the full 10s timeout.
      const onParentAbort = () => { try { ctl.abort(); } catch { /* ignore */ } };
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
              try { await reader.cancel(); } catch { /* ignore */ }
              try { ctl.abort(); } catch { /* ignore */ }
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
        window.clearTimeout(timer);
        const text = raw
          .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return text.length > 30_000 ? text.slice(0, 30_000) + '\n[truncated]' : text;
      } finally {
        window.clearTimeout(timer);
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
