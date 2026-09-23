import type { Endpoint } from '../types';

/** Accept SDK-style roots, existing versioned roots, and explicit Messages URLs. */
export function customApiUrl(endpoint: Pick<Endpoint, 'baseUrl' | 'apiStyle'>, resource: 'chat' | 'models' = 'chat'): string {
  const url = new URL(endpoint.baseUrl?.trim() ?? '');
  if (!/^https?:$/.test(url.protocol)) throw new Error('Base URL must use HTTP(S).');
  let path = url.pathname.replace(/\/+$/, '');
  if (endpoint.apiStyle === 'anthropic') {
    const explicitResource = /\/(messages|models)$/.test(path);
    if (explicitResource) path = path.replace(/\/(messages|models)$/, '');
    else if (!/\/v\d+[a-z\d.-]*$/i.test(path)) path += '/v1';
    path += resource === 'models' ? '/models' : '/messages';
  } else {
    path += resource === 'models' ? '/models' : '/chat/completions';
  }
  url.pathname = path;
  url.hash = '';
  return url.toString();
}

const OWNED_BODY_FIELDS = new Set([
  'model', 'messages', 'system', 'stream', 'stream_options',
  'tools', 'tool_choice', 'functions', 'function_call',
  '__proto__', 'prototype', 'constructor',
]);

export function validateExtraBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Extra body must be a JSON object.');
  }
  for (const key of Object.keys(value)) {
    if (OWNED_BODY_FIELDS.has(key)) throw new Error(`Extra body cannot override "${key}".`);
  }
  return value as Record<string, unknown>;
}

export function parseExtraBody(text: string): Record<string, unknown> {
  return text.trim() ? validateExtraBody(JSON.parse(text) as unknown) : {};
}

/** Explicit provider parameters replace generated values at the top level. */
export function customApiBody(endpoint: Pick<Endpoint, 'extraBody'>, body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, ...(endpoint.extraBody === undefined ? {} : validateExtraBody(endpoint.extraBody)) };
}
