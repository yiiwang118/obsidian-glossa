import { nativeStreamingHttpRequest } from './native_http';

type NodeDnsLookup = (host: string, options: { all: true }) => Promise<unknown>;

interface NodeDnsPromisesModule {
  lookup: NodeDnsLookup;
}

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
  const normalizedHost = stripIpv6Brackets(host);
  const ipver = ipVersion(normalizedHost);
  if (ipver === 4 && isPrivateIPv4(normalizedHost)) throw new Error(`refused: ${host} is a private IPv4`);
  if (ipver === 6 && isPrivateIPv6(normalizedHost)) throw new Error(`refused: ${host} is a private IPv6`);
  if (ipver !== 0) return;

  const low = normalizedHost.toLowerCase();
  if (low === 'localhost' || low.endsWith('.localhost') || low.endsWith('.local') || low.endsWith('.internal')) {
    throw new Error(`refused: ${host} is a reserved hostname`);
  }

  const records = await lookupPublicHost(normalizedHost);
  for (const record of records) {
    if (record.family === 4 && isPrivateIPv4(record.address)) throw new Error(`refused: ${host} resolves to private IPv4 ${record.address}`);
    if (record.family === 6 && isPrivateIPv6(record.address)) throw new Error(`refused: ${host} resolves to private IPv6 ${record.address}`);
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

interface DnsAddressRecord {
  address: string;
  family: 4 | 6;
}

async function lookupPublicHost(host: string): Promise<DnsAddressRecord[]> {
  const nodeRequire = window.require;
  if (typeof nodeRequire !== 'function') throw new Error('DNS validation is unavailable in this runtime.');
  const moduleValue = nodeRequire('dns/promises');
  if (!isNodeDnsPromisesModule(moduleValue)) throw new Error('Node DNS promises API is unavailable.');
  const result = await moduleValue.lookup(host, { all: true });
  if (!Array.isArray(result)) throw new Error('DNS lookup returned an invalid result.');
  const records: DnsAddressRecord[] = [];
  for (const value of result) {
    if (!isRecord(value)) continue;
    const address = value.address;
    const family = value.family;
    if (typeof address === 'string' && (family === 4 || family === 6)) records.push({ address, family });
  }
  if (records.length === 0) throw new Error(`DNS lookup returned no usable addresses for ${host}.`);
  return records;
}

function isNodeDnsPromisesModule(value: unknown): value is NodeDnsPromisesModule {
  return isRecord(value) && typeof value.lookup === 'function';
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function ipVersion(host: string): 0 | 4 | 6 {
  const octets = host.split('.');
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return 4;
  if (host.includes(':') && /^[0-9a-f:.]+$/i.test(host)) return 6;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
