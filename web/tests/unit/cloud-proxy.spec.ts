import { test, expect } from '@playwright/test';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../src/app/api/[...path]/route';

test('cloud proxy keeps service identity separate from staff authorization', async () => {
  const savedFetch = globalThis.fetch;
  const savedBase = process.env.API_BASE_URL;
  const savedAuth = process.env.PLANTSENSE_CLOUD_AUTH;
  process.env.API_BASE_URL = 'https://private-api-auth-test.run.app';
  process.env.PLANTSENSE_CLOUD_AUTH = 'true';
  const token = ['fixture-header', 'fixture-payload', 'fixture-signature']
    .map((part) => Buffer.from(part).toString('base64url'))
    .join('.');
  let delivered: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'metadata.google.internal') {
      expect(url.searchParams.get('audience')).toBe(process.env.API_BASE_URL);
      expect(new Headers(init?.headers).get('Metadata-Flavor')).toBe('Google');
      return new Response(token);
    }
    delivered = new Headers(init?.headers);
    return Response.json({ ready: true });
  };
  try {
    const request = new NextRequest('https://plantsense.example/api/v1/access/state', {
      headers: { host: 'plantsense.example', authorization: 'Bearer staff-fixture' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'access', 'state'] }),
    });
    expect(response.status).toBe(200);
    expect(delivered?.get('authorization')).toBe('Bearer staff-fixture');
    expect(delivered?.get('X-Serverless-Authorization')).toBe(`Bearer ${token}`);
    expect(await response.text()).not.toContain(token);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedBase === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = savedBase;
    if (savedAuth === undefined) delete process.env.PLANTSENSE_CLOUD_AUTH;
    else process.env.PLANTSENSE_CLOUD_AUTH = savedAuth;
  }
});

test('cloud proxy rejects cross-origin writes before requesting credentials', async () => {
  const savedFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({});
  };
  try {
    const request = new NextRequest('https://plantsense.example/api/v1/access/sign-in', {
      method: 'POST',
      headers: {
        host: 'plantsense.example',
        origin: 'https://outside.example',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ['v1', 'access', 'sign-in'] }),
    });
    expect(response.status).toBe(403);
    expect(requests).toBe(0);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
