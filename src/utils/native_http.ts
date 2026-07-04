/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
const nativeRequest: typeof globalThis.fetch | undefined = globalThis.fetch?.bind(globalThis);

/** Native browser HTTP is required only where Obsidian requestUrl cannot provide
 *  the streaming Response body or manual redirect handling we need. */
export function nativeStreamingHttpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!nativeRequest) throw new Error('Native streaming HTTP is not available in this environment.');
  return nativeRequest(input, init);
}
