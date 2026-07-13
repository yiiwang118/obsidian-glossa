const { EventEmitter } = require('events');
const path = require('path');

exports.run = async function run(t, loadModule) {
  const originalFetch = window.fetch;
  const originalRequire = window.require;
  const requests = [];
  let dnsRecords = [{ address: '93.184.216.34', family: 4 }];

  const request = (url, options, onResponse) => {
    const req = new EventEmitter();
    let body = '';
    req.write = chunk => { body += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk); };
    req.destroy = error => { if (error) req.emit('error', error); };
    req.end = () => {
      requests.push({ url: url.toString(), options, body });
      const response = new EventEmitter();
      response.statusCode = 201;
      response.statusMessage = 'Created';
      response.headers = { 'content-type': 'text/plain', 'x-test': ['one', 'two'] };
      response.destroy = () => {};
      queueMicrotask(() => {
        onResponse(response);
        response.emit('data', Buffer.from('native response'));
        response.emit('end');
      });
    };
    return req;
  };

  try {
    window.fetch = async () => { throw new TypeError('browser fetch failed'); };
    window.require = moduleId => {
      if (moduleId === 'http' || moduleId === 'https') return { request };
      if (moduleId === 'dns/promises') return { lookup: async () => dnsRecords };
      return null;
    };

    const nativeHttp = await loadModule(path.resolve(__dirname, '../src/utils/native_http.ts'));
    const response = await nativeHttp.nativeStreamingHttpRequest('https://example.com/upload', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'payload',
    });
    t.eq(response.status, 201, 'Node fallback preserves response status');
    t.eq(await response.text(), 'native response', 'Node fallback streams the response body');
    t.eq(response.headers.get('x-test'), 'one, two', 'Node fallback preserves repeated response headers');
    t.eq(requests[0].options.method, 'POST', 'Node fallback preserves request method');
    t.eq(requests[0].body, 'payload', 'Node fallback preserves string request body');

    const safeWeb = await loadModule(path.resolve(__dirname, '../src/utils/safe_web.ts'));
    await safeWeb.assertPublicHost('example.com');
    t.ok(true, 'public DNS result passes validation');

    let privateIpv4Rejected = false;
    try { await safeWeb.assertPublicHost('127.0.0.1'); }
    catch (error) { privateIpv4Rejected = error instanceof Error && error.message.includes('private IPv4'); }
    t.ok(privateIpv4Rejected, 'private IPv4 literal is rejected');

    let privateIpv6Rejected = false;
    try { await safeWeb.assertPublicHost('[::1]'); }
    catch (error) { privateIpv6Rejected = error instanceof Error && error.message.includes('private IPv6'); }
    t.ok(privateIpv6Rejected, 'private IPv6 literal is rejected');

    dnsRecords = [{ address: '10.0.0.8', family: 4 }];
    let privateDnsRejected = false;
    try { await safeWeb.assertPublicHost('private.example.com'); }
    catch (error) { privateDnsRejected = error instanceof Error && error.message.includes('resolves to private IPv4'); }
    t.ok(privateDnsRejected, 'DNS rebinding to a private address is rejected');
  } finally {
    if (originalFetch === undefined) delete window.fetch;
    else window.fetch = originalFetch;
    if (originalRequire === undefined) delete window.require;
    else window.require = originalRequire;
  }
};
