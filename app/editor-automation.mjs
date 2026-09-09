/** Public, versioned control surface. Every mutation uses the editor's command engine. */
import { createDesktopSession } from './desktop-session.mjs';
import { LIMITS } from './editor-core.mjs';
export const AUTOMATION_VERSION = 1;

export function createAutomation(host) {
  const desktop = createDesktopSession(host);
  const apply = async ({ commands, expectedRevision, label = "Script" }) => {
    desktop.assertEditable();
    if (
      !Array.isArray(commands) ||
      commands.length < 1 ||
      commands.length > 2000
    )
      throw new Error("Provide between 1 and 2000 commands.");
    if (JSON.stringify(commands).length > 16 * 1024 * 1024)
      throw new Error("Command batch exceeds 16 MB.");
    if (expectedRevision !== undefined && expectedRevision !== host.revision())
      throw new Error(
        "The document changed. Inspect it again before applying this batch.",
      );
    await host.apply(commands, String(label).slice(0, 100));
    return { revision: host.revision(), document: host.inspect() };
  };
  return Object.freeze({
    version: AUTOMATION_VERSION,
    desktop,
    inspect: () => ({ revision: host.revision(), document: host.inspect() }),
    commands: () => host.commands(),
    apply,
    newDocument: async (options = {}) => {
      desktop.assertEditable();
      await host.newDocument(options);
      return { revision: host.revision(), document: host.inspect() };
    },
    preview: async (options = {}) => host.preview(options),
    save: async () => {
      const saved = await host.save();
      return saved
        ? {
            id: saved.document?.id,
            revision: saved.revision,
            savedAt: saved.savedAt,
            imagesWritten: saved.imagesWritten,
            prunedRevisions: saved.prunedRevisions,
          }
        : {
            saved: false,
            reason: "Device storage is unavailable. Export a project file.",
          };
    },
    export: async (options = {}) => host.export(options),
    colorProfile: async (options = {}) => {
      if ((options.operation || "inspect") !== "inspect") desktop.assertEditable();
      if (options.expectedRevision !== undefined && options.expectedRevision !== host.revision())
        throw Error("The document changed. Inspect it again before changing its profile.");
      return host.colorProfile(options);
    },
    runLua: async (options = {}) => {
      desktop.assertEditable();
      if (options.expectedRevision !== undefined && options.expectedRevision !== host.revision())
        throw Error("The document changed. Inspect it again before running Lua.");
      return host.runLua(options);
    },
    undo: async () => {
      desktop.assertEditable();
      await host.undo();
      return { revision: host.revision(), document: host.inspect() };
    },
    redo: async () => {
      desktop.assertEditable();
      await host.redo();
      return { revision: host.revision(), document: host.inspect() };
    },
  });
}

export function registerAutomation(context, api) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const definitions = [
    {
      name:"pixelwall_lua",
      description:"Run Lua 5.4 against the active project using supported Sprite/Image/Color/layer/frame/palette APIs. Applies one undoable result; errors and cancellation preserve artwork. Files and export commands are unavailable inside Lua; use the existing export tool.",
      inputSchema:{type:"object",properties:{source:{type:"string",maxLength:262144},params:{type:"object"},timeoutMs:{type:"integer",minimum:50,maximum:10000},expectedRevision:{type:"integer",minimum:0}},required:["source"],additionalProperties:false},
      execute:options=>api.runLua(options),
    },
    {
      name: "pixelwall_color_profile",
      description: "Inspect, assign or convert the working color profile. Assign keeps pixel values; convert uses LittleCMS to preserve appearance. Omit ICC bytes to use sRGB. Mutations are undoable.",
      inputSchema: {type:"object", properties:{operation:{type:"string",enum:["inspect","assign","convert"]},icc:{type:"array",items:{type:"integer",minimum:0,maximum:255},maxItems:4194304},intent:{type:"integer",minimum:0,maximum:3},expectedRevision:{type:"integer",minimum:0}},additionalProperties:false},
      execute: (options) => api.colorProfile(options),
    },
    {
      name: "pixelwall_inspect",
      description:
        "Read the active PixelWall document, layer/frame identifiers and document revision.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => api.inspect(),
    },
    {
      name: "pixelwall_commands",
      description:
        "Read the supported editing commands and their parameters. PixelWall contains no AI; external clients choose the commands.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => api.commands(),
    },
    {
      name: "pixelwall_apply",
      description:
        "Apply a validated batch of editing commands to the visible PixelWall project, as one undoable operation. Drawing coordinates are document pixels.",
      inputSchema: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            minItems: 1,
            maxItems: 2000,
            items: {
              type: "object",
              properties: { type: { type: "string" } },
              required: ["type"],
            },
          },
          expectedRevision: { type: "integer" },
          label: { type: "string", maxLength: 100 },
        },
        required: ["commands"],
        additionalProperties: false,
      },
      execute: (input) => api.apply(input),
    },
    {
      name: "pixelwall_new_document",
      description:
        "Create and activate a new editable PixelWall document. The previous document is saved first.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          width: { type: "integer", minimum: 1, maximum: LIMITS.edge },
          height: { type: "integer", minimum: 1, maximum: LIMITS.edge },
          colorMode: { type: "string", enum: ["rgba", "indexed", "grayscale"] },
        },
        additionalProperties: false,
      },
      execute: (input) => api.newDocument(input),
    },
    {
      name: "pixelwall_preview",
      description:
        "Render a PNG preview of a frame from the current editor document.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          frameId: { type: "string" },
          scale: { type: "integer", minimum: 1, maximum: 8 },
        },
        additionalProperties: false,
      },
      execute: (input) => api.preview(input),
    },
    {
      name: "pixelwall_save",
      description:
        "Save the current document to this device with a recoverable revision.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => api.save(),
    },
    {
      name: "pixelwall_export",
      description:
        "Export the current artwork. Frame PNG and editable project files are free. GIF, atlas and game packages require an active Pro entitlement.",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: [
              "png",
              "bmp",
              "tga",
              "project",
              "aseprite",
              "gif",
              "sheet",
              "zip",
            ],
          },
          scale: { type: "number", exclusiveMinimum: 0, maximum: 64 },
          frameId: { type: "string" },
          clipId: { type: "string" },
          includeReferenceLayers: { type: "boolean" },
          layerIds: { type: "array", items: { type: "string" } },
          layout: {
            type: "string",
            enum: ["packed", "horizontal", "vertical", "grid"],
          },
          padding: { type: "integer", minimum: 0, maximum: 32 },
          extrude: { type: "integer", minimum: 0, maximum: 32 },
          trim: { type: "boolean" },
          powerOfTwo: { type: "boolean" },
        },
        required: ["format"],
        additionalProperties: false,
      },
      execute: (input) => api.export(input),
    },
    {
      name: "pixelwall_undo",
      description: "Undo the most recent editor transaction.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => api.undo(),
    },
    {
      name: "pixelwall_redo",
      description: "Redo the most recently undone editor transaction.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => api.redo(),
    },
  ];
  for (const definition of definitions) {
    try {
      void Promise.resolve(
        context.registerTool(definition, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Public JS API remains usable in browsers without WebMCP support. */
    }
  }
  return () => lifecycle.abort();
}
