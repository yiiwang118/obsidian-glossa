type NodeIncomingHeaders = Record<string, string | string[] | undefined>;

interface NodeIncomingMessage {
  statusCode?: number;
  statusMessage?: string;
  headers: NodeIncomingHeaders;
  on(event: 'data', listener: (chunk: unknown) => void): NodeIncomingMessage;
  once(event: 'end', listener: () => void): NodeIncomingMessage;
  once(event: 'error', listener: (reason: unknown) => void): NodeIncomingMessage;
  destroy(error?: Error): void;
}

interface NodeClientRequest {
  on(event: 'error', listener: (reason: unknown) => void): NodeClientRequest;
  once(event: 'close', listener: () => void): NodeClientRequest;
  write(chunk: string | Uint8Array): void;
  end(): void;
  destroy(error?: Error): void;
}

type NodeRequest = (
  url: URL,
  options: { method: string; headers?: Record<string, string> },
  onResponse: (response: NodeIncomingMessage) => void,
) => NodeClientRequest;

interface NodeHttpModule {
  request: NodeRequest;
}

/** Native browser HTTP is required only where Obsidian requestUrl cannot provide
 *  the streaming Response body or manual redirect handling we need. */
export async function nativeStreamingHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await window.fetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted || errorName(error) === 'AbortError') throw asError(error);
  }
  return nodeStreamingHttpRequest(input, init);
}

function nodeStreamingHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const request = loadNodeRequest(url.protocol === 'https:' ? 'https' : 'http');
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
    req.on('error', reason => rejectOnce(asError(reason)));
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

function responseFromNode(response: NodeIncomingMessage): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      response.on('data', chunk => {
        const bytes = nodeChunkBytes(chunk);
        if (bytes) controller.enqueue(bytes);
        else controller.error(new Error('Native HTTP returned an unsupported body chunk.'));
      });
      response.once('end', () => controller.close());
      response.once('error', reason => controller.error(asError(reason)));
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

function responseHeaders(headers: NodeIncomingHeaders): Headers {
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

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Native HTTP request failed.');
}

function nodeChunkBytes(chunk: unknown): Uint8Array | null {
  if (chunk instanceof Uint8Array) return Uint8Array.from(chunk);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  return null;
}

function loadNodeRequest(moduleId: 'http' | 'https'): NodeRequest {
  const nodeRequire = window.require;
  if (typeof nodeRequire !== 'function') throw new Error('Native HTTP is unavailable in this runtime.');
  const moduleValue = nodeRequire(moduleId);
  if (!isNodeHttpModule(moduleValue)) throw new Error(`Native ${moduleId.toUpperCase()} module is unavailable.`);
  return moduleValue.request;
}

function isNodeHttpModule(value: unknown): value is NodeHttpModule {
  return isRecord(value) && typeof value.request === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
