import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automationTools } from '../app/editor-automation.mjs';
import generatedSchemas from '../desktop/mcp-schemas.mjs';
import { MCP_SCHEMAS, MCP_TOOLS } from '../desktop/mcp-catalog.mjs';

const clone = value => structuredClone(value);

test('generated desktop schemas exactly match the automation tool contracts', () => {
  const automation = Object.fromEntries(automationTools({}).map(tool => [tool.name, tool.inputSchema]));
  assert.deepEqual(Object.keys(generatedSchemas).sort(), Object.keys(automation).sort());
  for (const name of Object.keys(automation)) assert.deepEqual(generatedSchemas[name], automation[name], name);
});

test('desktop catalog has a schema for every tool and only applies transport byte caps', () => {
  for (const [name] of MCP_TOOLS) assert.ok(MCP_SCHEMAS[name], `missing schema for ${name}`);
  for (const name of Object.keys(generatedSchemas)) {
    const expected = clone(generatedSchemas[name]);
    if (name === 'pixelwall_import_project' || name === 'pixelwall_open_temporary') {
      expected.properties.bytes.maxItems = 1024 * 1024;
    }
    assert.deepEqual(MCP_SCHEMAS[name], expected, name);
  }
  assert.deepEqual(MCP_SCHEMAS.pixelwall_save_artifact, {
    type: 'object',
    properties: {
      artifactId: { type: 'string', minLength: 1, maxLength: 200 },
      filename: { type: 'string', minLength: 1, maxLength: 240 },
    },
    required: ['artifactId'],
    additionalProperties: false,
  });
});

test('packaged desktop file list includes the generated schema module', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(packageJson.build.files.includes('mcp-schemas.mjs'));
});
