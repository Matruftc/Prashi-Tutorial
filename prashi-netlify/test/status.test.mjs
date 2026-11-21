import assert from 'node:assert/strict';
import test from 'node:test';
import { makePortalHandler } from '../netlify/functions/portal.mjs';

const origin = 'https://example.test';
const request = (path, options) => new Request(origin + path, options);
const never = () => { throw new Error('Unexpected database access'); };

test('unknown routes and unsupported methods fail before opening the database', async () => {
  const handler = makePortalHandler(never);
  const missing = await handler(request('/api/does-not-exist'));
  assert.equal(missing.status, 404);
  const detail = await missing.json();
  assert.equal(detail.code, 'NOT_FOUND');
  assert.equal(detail.requestId, missing.headers.get('X-Request-ID'));
  const wrongMethod = await handler(request('/api/login'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');
  assert.equal((await wrongMethod.json()).code, 'METHOD_NOT_ALLOWED');
  assert.equal((await handler(request('/healthz'))).status, 200);
});

test('database readiness returns 200 for a successful ping and 503 for an outage', async () => {
  const healthy = makePortalHandler(async () => ({ command: async cmd => assert.deepEqual(cmd, { ping: 1 }) }));
  const response = await healthy(request('/readyz'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready', database: 'available' });
  const unavailable = makePortalHandler(async () => { throw Object.assign(new Error('hidden diagnostic'), { name: 'MongoNetworkError' }); });
  const degraded = await unavailable(request('/api/website'));
  assert.equal(degraded.status, 503);
  assert.equal(degraded.headers.get('Retry-After'), '30');
  assert.doesNotMatch(await degraded.text(), /hidden diagnostic/);
  const head = await unavailable(request('/readyz', { method: 'HEAD' }));
  assert.equal(head.status, 503);
  assert.equal(await head.text(), '');
});

test('invalid request size, bad content type and unexpected internal faults have distinct statuses', async () => {
  const handler = makePortalHandler(never);
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } };
  const huge = await handler(request('/api/login', { ...options, body: ' '.repeat(5000) }));
  assert.equal(huge.status, 413);
  assert.equal((await huge.json()).code, 'PAYLOAD_TOO_LARGE');
  const badType = await handler(request('/api/login', { ...options, headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' }));
  assert.equal(badType.status, 415);
  assert.equal((await badType.json()).code, 'UNSUPPORTED_MEDIA_TYPE');
  const failed = await handler(request('/api/website'));
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).code, 'INTERNAL_ERROR');
});

test('private pages enforce authentication and missing course pages have a branded 404', async () => {
  const handler = makePortalHandler(async () => ({
    collection: () => ({ findOne: async () => null }),
  }));
  const privateResponse = await handler(request('/api/student'));
  assert.equal(privateResponse.status, 401);
  assert.equal((await privateResponse.json()).code, 'AUTHENTICATION_REQUIRED');
  const course = await handler(request('/courses/no-such-course'));
  assert.equal(course.status, 404);
  assert.match(await course.text(), /Page not found.*Prashi Tutorial/);
});
