import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64 * 1024;
class BodyTimeout extends Error {}

async function readBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 10000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new BodyTimeout();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path[0] !== 'v1' || path.some((p) => !/^[a-zA-Z0-9_-]+$/.test(p))) {
    return Response.json({ detail: 'Not found' }, { status: 404 });
  }
  const origin = request.headers.get('origin');
  // NextURL normalizes 127.0.0.1 to localhost; preserve the browser's actual authority.
  const scheme =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    request.nextUrl.protocol.replace(':', '');
  const expectedOrigin = `${scheme}://${request.headers.get('host')}`;
  if (request.method === 'POST' && origin && origin !== expectedOrigin) {
    return Response.json({ detail: 'Cross-origin writes are not allowed' }, { status: 403 });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const name of ['authorization', 'idempotency-key', 'x-incident-id']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const staffRoute = path[1] === 'access' || path[1] === 'plants';
  if (staffRoute) {
    if (origin) headers.origin = origin;
    const staffCookie = request.cookies.get('plantsense_staff');
    if (staffCookie && /^[A-Za-z0-9_-]{32,100}$/.test(staffCookie.value))
      headers.cookie = `plantsense_staff=${staffCookie.value}`;
  }
  try {
    const base = new URL(process.env.API_BASE_URL || 'http://127.0.0.1:8000');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
      throw new Error('Invalid API configuration');
    const body = request.method === 'GET' ? undefined : await readBody(request);
    if (body === null)
      return Response.json({ detail: 'Request body exceeds 64 KiB' }, { status: 413 });
    if (
      body &&
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
    ) {
      return Response.json({ detail: 'Expected application/json' }, { status: 415 });
    }
    const endpoint = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, base);
    endpoint.search = request.nextUrl.search;
    const response = await fetch(endpoint, {
      method: request.method,
      headers,
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
    const responseHeaders: Record<string, string> = {};
    const setCookie = response.headers.get('set-cookie');
    if (staffRoute && setCookie?.startsWith('plantsense_staff='))
      responseHeaders['Set-Cookie'] = setCookie;
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        ...responseHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(response.headers.get('X-Request-ID')
          ? { 'X-Request-ID': response.headers.get('X-Request-ID')! }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof BodyTimeout)
      return Response.json({ detail: 'Request body timed out' }, { status: 408 });
    return Response.json(
      { detail: 'Plant API is unavailable. Start the backend or check deployment configuration.' },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
