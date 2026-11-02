import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCliTrafficRequest } from '../app/cli-traffic-core.mjs';
import { handleDesktopTrafficRequest } from '../app/desktop-traffic-core.mjs';
import { handleDesktopHealthRequest } from '../app/desktop-health-core.mjs';

const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'test-token', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' };
const request = (body, headers = {}, url = 'https://www.pixelwall.dev/api/cli-traffic') => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const cli = { event: 'cli_usage_operation', operation: 'export', outcome: 'success', version: '0.6.2' };

test('CLI ingestion preserves approved fields without linking installations or forwarding headers', async () => {
  const sent = []; let id = 0;
  const options = { env, now: () => new Date('2026-11-02T18:15:32Z'), randomUUID: () => `random-${++id}`, fetchImpl: async (url, init) => { sent.push({ url, headers: init.headers, ...JSON.parse(init.body) }); return new Response(null, { status: 200 }); } };
  const payload = { ...cli, format: 'png', wrote_files: true, verified: true, platform: 'darwin', arch: 'arm64', duration_bucket: '100ms_1s', usage_day: 'returning' };
  for (let i = 0; i < 2; i++) assert.equal((await handleCliTrafficRequest(request(payload, { 'user-agent': 'secret-agent', cookie: 'private=1', authorization: 'private', 'x-forwarded-for': '127.0.0.1' }), options)).status, 204);
  assert.equal(sent[0].event, 'cli_usage_counted');
  assert.equal(sent[0].timestamp, '2026-11-02T00:00:00.000Z');
  assert.equal(sent[0].properties.surface, 'cli');
  assert.equal(sent[0].properties.environment, 'production');
  assert.equal(Object.hasOwn(sent[0].properties, 'test_run'), false);
  assert.equal(sent[0].properties.usage_day, 'returning');
  assert.equal(sent[0].properties.verified, true);
  assert.equal(sent[0].properties.$process_person_profile, false);
  assert.equal(sent[0].properties.$ip, null);
  assert.notEqual(sent[0].properties.distinct_id, sent[1].properties.distinct_id);
  assert.deepEqual(sent[0].headers, { 'content-type': 'application/json' });
  assert.ok(!JSON.stringify(sent).includes('secret-agent'));
});

test('explicit validation runs are isolated from production across every native surface', async () => {
  const testRun = 'f3638b50-c18f-4f45-813f-17f581452e56';
  for (const [handler, payload, outputEvent] of [
    [handleCliTrafficRequest, cli, 'cli_usage_counted'],
    [handleDesktopTrafficRequest, { event: 'desktop_automation_operation', operation: 'apply', outcome: 'success', changed: true, version: '0.6.4' }, 'desktop_automation_counted'],
    [handleDesktopHealthRequest, { event: 'desktop_app_health', operation: 'launch', outcome: 'success', launch_kind: 'first', version: '0.6.4' }, 'desktop_app_health_counted'],
  ]) {
    const sent = [];
    const options = { env, fetchImpl: async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(null, { status: 200 }); } };
    assert.equal((await handler(request({ ...payload, test_run: testRun }), options)).status, 204);
    assert.equal(sent[0].event, outputEvent);
    assert.equal(sent[0].properties.environment, 'test');
    assert.equal(sent[0].properties.test_run, testRun);
    assert.equal(sent[0].properties.$process_person_profile, false);
    assert.equal(sent[0].properties.$ip, null);
    for (const invalid of ['', true, null, 123, testRun.toUpperCase(), 'some-person@example.com', 'f3638b50-c18f-1f45-813f-17f581452e56']) {
      assert.equal((await handler(request({ ...payload, test_run: invalid }), options)).status, 400);
    }
    assert.equal((await handler(request({ ...payload, environment: 'test' }), options)).status, 400);
    assert.equal(sent.length, 1, 'invalid labels cannot fall back to production reporting');
  }
});

test('native ingestion rejects identifiers, content, invalid categories and invented success semantics', async () => {
  for (const extra of [{ email: 'private@example.com' }, { install_id: 'some-id' }, { path: '/private/art' }, { error: 'private error' }, { platform: 'my-hostname' }, { duration_bucket: 120 }, { usage_day: 'today' }, { format: '/private/art.png' }, { changed: true }, { operation: 'inspect', wrote_files: true }, { operation: 'apply', verified: true }, { outcome: 'failure', verified: true }]) {
    assert.equal((await handleCliTrafficRequest(request({ ...cli, ...extra }), { env })).status, 400, JSON.stringify(extra));
  }
  assert.equal((await handleCliTrafficRequest(request({ ...cli, event: 'desktop_automation_operation' }), { env })).status, 400);
});

test('native ingestion enforces browser, production-origin, encoding and body limits', async () => {
  for (const origin of ['https://www.pixelwall.dev', 'https://example.com']) assert.equal((await handleCliTrafficRequest(request(cli, { origin }), { env })).status, 403);
  assert.equal((await handleCliTrafficRequest(request(cli, {}, 'https://preview.vercel.app/api/cli-traffic'), { env })).status, 403);
  assert.equal((await handleCliTrafficRequest(request(cli, { 'content-type': 'text/plain' }), { env })).status, 415);
  assert.equal((await handleCliTrafficRequest(request(' '.repeat(2049)), { env })).status, 400);
  assert.equal((await handleCliTrafficRequest(request('{'), { env })).status, 400);
});

test('desktop retains its event identity while accepting daily activity and export metadata', async () => {
  let event;
  const body = { event: 'desktop_automation_operation', operation: 'export', outcome: 'success', version: '0.6.2', format: 'project', usage_day: 'first', platform: 'win32', arch: 'x64', duration_bucket: '1s_10s' };
  assert.equal((await handleDesktopTrafficRequest(request(body), { env, fetchImpl: async (_url, init) => { event = JSON.parse(init.body); return new Response(null, { status: 200 }); } })).status, 204);
  assert.equal(event.event, 'desktop_automation_counted');
  assert.equal(event.properties.surface, 'desktop_mcp');
  assert.equal(event.properties.format, 'project');
  assert.equal((await handleDesktopTrafficRequest(request({ ...body, wrote_files: true }), { env })).status, 400);
});

test('missing configuration is inert and failed upstream delivery is observable', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(null, { status: 429 }); };
  assert.equal((await handleCliTrafficRequest(request(cli), { fetchImpl })).status, 204);
  assert.equal(calls, 0);
  assert.equal((await handleCliTrafficRequest(request(cli), { env, fetchImpl })).status, 502);
  assert.equal((await handleCliTrafficRequest(request(cli), { env, fetchImpl: async () => { throw Error('private upstream error'); } })).status, 502);
});

test('desktop health accepts bounded lifecycle outcomes without identifiers', async () => {
  let event;
  const body = { event: 'desktop_app_health', operation: 'update_failure', outcome: 'failure', failure_category: 'download', version: '0.6.4', platform: 'darwin', arch: 'arm64', usage_day: 'returning' };
  assert.equal((await handleDesktopHealthRequest(request(body, {}, 'https://www.pixelwall.dev/api/desktop-health'), { env, fetchImpl: async (_url, init) => { event = JSON.parse(init.body); return new Response(null, { status: 200 }); } })).status, 204);
  assert.equal(event.event, 'desktop_app_health_counted');
  assert.equal(event.properties.surface, 'health');
  assert.equal(event.properties.failure_category, 'download');
  assert.equal((await handleDesktopHealthRequest(request({ ...body, email: 'private@example.com' }), { env })).status, 400);
});

test('desktop health ingestion forwards every approved lifecycle field', async () => {
  let sent;
  const body = { event: 'desktop_app_health', operation: 'update_failure', outcome: 'failure', version: '0.6.4', platform: 'darwin', arch: 'arm64', usage_day: 'returning', target_version: '0.6.5', failure_category: 'download' };
  const result = await handleDesktopHealthRequest(request(body, {}, 'https://www.pixelwall.dev/api/desktop-health'), { env, now: () => new Date('2026-11-04T00:00:00Z'), randomUUID: (() => { let n = 0; return () => `id-${++n};`; })(), fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return new Response(null, { status: 200 }); } });
  assert.equal(result.status, 204);
  assert.equal(sent.event, 'desktop_app_health_counted');
  assert.equal(sent.properties.target_version, '0.6.5');
  assert.equal(sent.properties.failure_category, 'download');
  assert.equal(sent.properties.usage_day, 'returning');
  assert.equal(sent.properties.$process_person_profile, false);
  assert.equal(sent.properties.$ip, null);
});
