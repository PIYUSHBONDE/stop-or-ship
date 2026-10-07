import { cpSync } from 'node:fs';
// Standalone Next.js output requires static assets alongside server.js.
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
process.env.PORT ||= '3000';
process.env.HOSTNAME = '127.0.0.1';
await import('../.next/standalone/server.js');
