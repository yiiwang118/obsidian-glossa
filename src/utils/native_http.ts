/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Dynamic plugin and host-app boundaries validate these values at runtime. */
import { request as requestHttp } from 'http';
import { request as requestHttps } from 'https';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';

const nativeRequest: typeof window.fetch | undefined = window.fetch?.bind(window);

/** Native browser HTTP is required only where Obsidian requestUrl cannot provide
 *  the streaming Response body or manual redirect handling we need. */
export async function nativeStreamingHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (nativeRequest) {
    try {
      return await nativeRequest(input, init);
    } catch (error) {
      if (init?.signal?.aborted || errorName(error) === 'AbortError') throw error;
    }
  }
  return nodeStreamingHttpRequest(input, init);
}

function nodeStreamingHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const request = url.protocol === 'https:' ? requestHttps : requestHttp;
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const req = request(url, {
      method: init?.method ?? 'GET',
      headers: requestHeaders(init?.headers),
    }, response => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      resolve(responseFromNode(response));
    });
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('error', error => rejectOnce(error));
    const onAbort = () => {
      const error = new Error('Request aborted.');
      error.name = 'AbortError';
      req.destroy(error);
      rejectOnce(error);
    };
    if (init?.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener('abort', onAbort, { once: true });
      req.once('close', () => init.signal?.removeEventListener('abort', onAbort));
    }
    if (typeof init?.body === 'string') req.write(init.body);
    else if (init?.body instanceof ArrayBuffer) req.write(new Uint8Array(init.body));
    req.end();
  });
}

function responseFromNode(response: IncomingMessage): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      response.on('data', (chunk: Buffer) => controller.enqueue(Uint8Array.from(chunk)));
      response.once('end', () => controller.close());
      response.once('error', error => controller.error(error));
    },
    cancel() {
      response.destroy();
    },
  });
  return new Response(body, {
    status: response.statusCode ?? 500,
    statusText: response.statusMessage ?? '',
    headers: responseHeaders(response.headers),
  });
}

function requestHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const item of value) out.append(key, item);
    else if (value !== undefined) out.set(key, String(value));
  }
  return out;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment -- Re-enable review lint rules after dynamic boundary module. */
