/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { nativeStreamingHttpRequest } from './native_http';

/** True for any IPv4 address in a non-routable / private / loopback / CGNAT
 *  / link-local block. */
function isPrivateIPv4(ip: string): boolean {
  if (!/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/** True for any IPv6 address in a non-routable / private / loopback / link-local block. */
function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fe80:')) return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true;
  if (low.startsWith('ff')) return true;
  const v4embed = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4embed) return isPrivateIPv4(v4embed[1]);
  return false;
}

export function parseHttpUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); }
  catch { throw new Error(`Not a valid URL: ${raw.slice(0, 80)}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing ${u.protocol} URL. Only http(s) is allowed.`);
  }
  return u;
}

/** Resolve hostname and assert NO address in the answer set is private.
 *  Throws on private-IP hit so the caller bails out. */
export async function assertPublicHost(host: string): Promise<void> {
  const ipver = isIP(host);
  if (ipver === 4 && isPrivateIPv4(host)) throw new Error(`refused: ${host} is a private IPv4`);
  if (ipver === 6 && isPrivateIPv6(host)) throw new Error(`refused: ${host} is a private IPv6`);
  if (ipver !== 0) return;

  const low = host.toLowerCase();
  if (low === 'localhost' || low.endsWith('.localhost') || low.endsWith('.local') || low.endsWith('.internal')) {
    throw new Error(`refused: ${host} is a reserved hostname`);
  }

  const records = await lookup(host, { all: true });
  for (const r of records) {
    if (r.family === 4 && isPrivateIPv4(r.address)) throw new Error(`refused: ${host} resolves to private IPv4 ${r.address}`);
    if (r.family === 6 && isPrivateIPv6(r.address)) throw new Error(`refused: ${host} resolves to private IPv6 ${r.address}`);
  }
}

/** Manually follow redirects so each hop can be re-validated against the
 *  private-IP block. Without this an attacker could 302-bounce a public host
 *  into 127.0.0.1. */
export async function fetchWithSafeRedirects(url: string, signal: AbortSignal): Promise<Response> {
  const MAX_HOPS = 5;
  let current = url;
  for (let i = 0; i < MAX_HOPS; i++) {
    const u = parseHttpUrl(current);
    await assertPublicHost(u.hostname);
    const r = await nativeStreamingHttpRequest(current, {
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars */
