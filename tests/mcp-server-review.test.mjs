import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpBridge } from "../desktop/mcp-bridge.mjs";

test("stdio launcher uses the live bridge catalog and reconnects after a desktop restart", async () => {
  const root = await mkdtemp("/Volumes/DevStorage/Builds/pixelwall/studio-050/mcp-server-");
  const configPath = join(root, "mcp.json");
  const dynamicTools = [{ name: "pixelwall_dynamic_test", description: "live", inputSchema: { type: "object" } }];
  const webContents = { executeJavaScript: async source => source.includes('api["tools"]') ? dynamicTools : null };
  let first = createMcpBridge({ configPath, webContents }); await first.start();
  const transport = new StdioClientTransport({ command: process.execPath, args: ["app/mcp-server.mjs"], cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, PIXELWALL_MCP_CONFIG: configPath } });
  const client = new Client({ name: "mcp-review", version: "1" });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === "pixelwall_dynamic_test"));
    await first.stop();
    const second = createMcpBridge({ configPath, webContents }); await second.start();
    first = second;
    assert.ok((await client.listTools()).tools.some(tool => tool.name === "pixelwall_dynamic_test"));
  } finally {
    await client.close().catch(() => {});
    await first.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("stdio launcher keeps transport and byte handling bounded", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/mcp-server.mjs", import.meta.url), "utf8");
  assert.match(source, /MAX_FRAME_BYTES = 8 \* 1024 \* 1024/);
  assert.match(source, /MAX_RESPONSE_BUFFER_BYTES = 16 \* 1024 \* 1024/);
  assert.match(source, /Buffer\.byteLength\(frame\) > MAX_FRAME_BYTES/);
  assert.match(source, /signal\?\.addEventListener\('abort'/);
  assert.match(source, /extra\?\.signal/);
  assert.match(source, /value\?\.kind === 'comparison'/);
  assert.match(source, /process\.stdin\.once\('end'/);
  assert.match(source, /const activeSocket = socket/);
});

test("stdio launcher returns comparison image content from the real preview shape", async () => {
  const root = await mkdtemp("/Volumes/DevStorage/Builds/pixelwall/studio-050/mcp-server-comparison-");
  const configPath = join(root, "mcp.json");
  const pixel = Buffer.from([137, 80, 78, 71]).toString("base64");
  const comparison = {
    kind: "comparison", changedPixels: 1, totalPixels: 4,
    before: { width: 2, height: 2, dataUrl: `data:image/png;base64,${pixel}` },
    after: { width: 2, height: 2, dataUrl: `data:image/png;base64,${pixel}` },
    diff: undefined,
    width: 2, height: 2,
    dataUrl: `data:image/png;base64,${pixel}`,
  };
  const webContents = { executeJavaScript: async source => {
    if (source.includes('api["pixelwall_tools"]')) return [{ name: "pixelwall_preview", description: "preview", inputSchema: { type: "object", properties: { compare: { type: "boolean" } }, additionalProperties: false } }];
    if (source.includes('api["preview"]')) return comparison;
    throw new Error("unexpected bridge method");
  } };
  let bridge = createMcpBridge({ configPath, webContents }); await bridge.start();
  const transport = new StdioClientTransport({ command: process.execPath, args: ["app/mcp-server.mjs"], cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, PIXELWALL_MCP_CONFIG: configPath } });
  const client = new Client({ name: "mcp-comparison-review", version: "1" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "pixelwall_preview", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.kind, "comparison");
    assert.equal(result.structuredContent.changedPixels, 1);
    assert.deepEqual(result.content.filter(item => item.type === "image").map(item => item.mimeType), ["image/png", "image/png", "image/png"]);
  } finally {
    await client.close().catch(() => {});
    await bridge.stop().catch(() => {});
    bridge = null;
    await new Promise(resolve => setTimeout(resolve, 20));
    await rm(root, { recursive: true, force: true });
  }
});

test("stdio EOF closes a connected bridge child", async () => {
  const root = await mkdtemp("/Volumes/DevStorage/Builds/pixelwall/studio-050/mcp-server-eof-");
  const configPath = join(root, "mcp.json");
  const webContents = { executeJavaScript: async source => source.includes('api["pixelwall_tools"]') ? [] : [] };
  let bridge = createMcpBridge({ configPath, webContents }); await bridge.start();
  const child = spawn(process.execPath, ["app/mcp-server.mjs"], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, PIXELWALL_MCP_CONFIG: configPath }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    child.stdin.end();
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("MCP child did not exit after stdio EOF")); }, 3000);
      child.once("error", reject);
      child.once("exit", code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exitCode, 0);
  } finally {
    await bridge.stop().catch(() => {});
    bridge = null;
    await rm(root, { recursive: true, force: true });
  }
});

