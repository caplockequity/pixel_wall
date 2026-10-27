import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDesktopTrafficRequest } from '../app/desktop-traffic-core.mjs';

const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'project-token', NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' };
const make = (body, headers = {}) => new Request('https://www.pixelwall.dev/api/desktop-traffic', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('desktop transport forwards only bounded aggregate automation fields', async () => {
  let sent;
  const response = await handleDesktopTrafficRequest(make({ event: 'desktop_automation_operation', operation: 'export', outcome: 'success', version: '0.5.0', artifact_persistence: 'persisted' }), {
    env, now: () => new Date('2026-10-27T18:20:00Z'), randomUUID: (() => { let n = 0; return () => `id-${++n}`; })(),
    fetchImpl: async (url, options) => { sent = { url, ...JSON.parse(options.body) }; return new Response(null, { status: 200 }); },
  });
  assert.equal(response.status, 204);
  assert.equal(sent.event, 'desktop_automation_counted');
  assert.equal(sent.timestamp, '2026-10-27T00:00:00.000Z');
  assert.deepEqual(sent.properties, { distinct_id: 'id-2', token: 'project-token', analytics_schema_version: 2, environment: 'production', app_version: '0.5.0', surface: 'desktop_mcp', measurement_mode: 'aggregate', operation: 'export', outcome: 'success', artifact_persistence: 'persisted', $process_person_profile: false, $geoip_disable: true, $ip: null });
});

test('desktop transport accepts native requests without Origin and rejects browser origins', async () => {
  const valid = await handleDesktopTrafficRequest(make({ event: 'desktop_automation_operation', operation: 'connect', outcome: 'success', version: '0.5.0' }), { env, fetchImpl: async () => new Response(null, { status: 200 }) });
  assert.equal(valid.status, 204);
  const foreign = await handleDesktopTrafficRequest(make({ event: 'desktop_automation_operation', operation: 'connect', outcome: 'success', version: '0.5.0' }, { origin: 'https://evil.example' }), { env });
  assert.equal(foreign.status, 403);
  const sameOrigin = await handleDesktopTrafficRequest(make({ event: 'desktop_automation_operation', operation: 'connect', outcome: 'success', version: '0.5.0' }, { origin: 'https://www.pixelwall.dev' }), { env });
  assert.equal(sameOrigin.status, 403);
});

test('desktop transport rejects extra fields and invalid changed semantics', async () => {
  for (const body of [
    { event: 'desktop_automation_operation', operation: 'export', outcome: 'success', version: '0.5.0', raw: 'artwork' },
    { event: 'desktop_automation_operation', operation: 'export', outcome: 'success', version: '0.5.0', changed: true },
    { event: 'desktop_automation_operation', operation: 'apply', outcome: 'failure', version: '0.5.0', changed: true },
    { event: 'desktop_automation_operation', operation: 'preview', outcome: 'success', version: '0.5', preview_kind: 'frame' },
  ]) assert.equal((await handleDesktopTrafficRequest(make(body), { env })).status, 400);
});
