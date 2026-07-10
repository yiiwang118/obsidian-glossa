/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import type { App } from 'obsidian';
import type { GlossaSettings, WebSearchProvider } from '../../types';
import type { PermissionResult } from './_shared';

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const domain = item.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    if (domain) out.add(domain);
  }
  return [...out];
}

export function readWebSettings(app: App): Partial<GlossaSettings> {
  return (app as AnyValue)?.plugins?.plugins?.glossa?.settings ?? {};
}

export function normalizeSearchProvider(value: unknown): WebSearchProvider {
  if (value === 'auto' || value === 'duckduckgo' || value === 'brave' || value === 'tavily' || value === 'exa' || value === 'serpapi') {
    return value;
  }
  return 'auto';
}

export function webReadPermission(app: App, message: string): PermissionResult {
  const settings = readWebSettings(app);
  return settings.webAutoApproveNetworkReads
    ? { behavior: 'allow', decisionReason: 'Web reads are auto-approved in settings.' }
    : { behavior: 'ask', message };
}

export function httpFallbackUrl(url: string, error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted || errorName(error) === 'AbortError') return '';
  const message = errorMessage(error);
  if (/^refused:|not a valid url|only http\(s\)|too many redirects/i.test(message)) return '';
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return ''; }
  if (parsed.protocol !== 'https:') return '';
  parsed.protocol = 'http:';
  return parsed.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Re-enable review lint rules after dynamic boundary module. */
