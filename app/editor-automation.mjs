/** Public, versioned control surface. Every mutation uses the editor's command engine. */
import { createDesktopSession } from './desktop-session.mjs';
import { LIMITS } from './editor-core.mjs';
import { captureCommands } from './command-preflight.mjs';
export const AUTOMATION_VERSION = 1;

export function createAutomation(host) {
  const desktop = createDesktopSession(host);
  const operations = new Map();
  const requests = new Map();
  const reportedPreflightFailures = new Set();
  const sessionId = globalThis.crypto.randomUUID();
  let operationSequence = 0;
  let activeOperation = null;
  let navigating = false;
  const reportOperation = (operation, outcome, details = {}) => {
    try {
      host.automationOperation?.({ operation, outcome, ...details });
    } catch { /* telemetry must never affect the editor */ }
  };
  const reportApplyPreflightFailure = requestKey => {
    if (requestKey !== undefined && reportedPreflightFailures.has(requestKey)) return;
    if (requestKey !== undefined) reportedPreflightFailures.add(requestKey);
    reportOperation("apply", "failure", { changed: false });
  };
  const assertIdle = () => {
    if (activeOperation || navigating) throw new Error("Finish the current editor operation before changing the project.");
  };
  const navigate = async work => {
    desktop.assertEditable(); assertIdle(); navigating = true;
    try { await work(); return {revision:host.revision(),document:host.inspect()}; }
    finally { navigating = false; }
  };
  const operationId = () => `op-${Date.now().toString(36)}-${(++operationSequence).toString(36)}`;
  const snapshot = operation => ({
    id: operation.id,
    documentId: operation.documentId,
    status: operation.status,
    commandsProcessed: operation.commandsProcessed,
    commandsTotal: operation.commandsTotal,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    expectedRevision: operation.expectedRevision,
    revision: operation.revision,
    changed: operation.changed === true,
    error: operation.error,
    requestKey: operation.requestKey,
    cancellationRequested: operation.controller.signal.aborted,
  });
  const runApply = async (operation, commands, label) => {
    operation.status = "running";
    operation.startedAt = new Date().toISOString();
    operation.commandsProcessed = 0;
    operation.revision = host.revision();
    try {
      // Hosts may report finer-grained progress; the fallback still makes the
      // transaction observable at its two atomic boundaries.
      const onProgress = progress => {
        if (!progress || typeof progress !== "object") return;
        if (Number.isSafeInteger(progress.commandsProcessed))
          operation.commandsProcessed = Math.max(0, Math.min(operation.commandsTotal, progress.commandsProcessed));
        if (Number.isSafeInteger(progress.revision)) operation.revision = progress.revision;
      };
      const applied = await host.apply(commands, label, { onProgress, signal: operation.controller.signal });
      operation.commandsProcessed = operation.commandsTotal;
      operation.revision = host.revision();
      operation.changed = applied?.changed === true;
      operation.status = "completed";
      operation.completedAt = new Date().toISOString();
      operation.result = { revision: operation.revision, changed: operation.changed, document: host.inspect(), operation: snapshot(operation), operationId: operation.id };
      reportOperation("apply", "success", { changed: operation.changed });
      return operation.result;
    } catch (error) {
      operation.revision = host.revision();
      operation.status = error?.name === "AbortError" ? "cancelled" : "failed";
      operation.completedAt = new Date().toISOString();
      operation.error = error instanceof Error ? error.message : String(error);
      reportOperation("apply", operation.status === "cancelled" ? "cancelled" : "failure", { changed: false });
      throw error;
    } finally {
      if (activeOperation === operation) activeOperation = null;
    }
  };
  const apply = async ({ commands, expectedRevision, label = "Script", wait = true, requestKey } = {}) => {
    desktop.assertEditable();
    if (requestKey !== undefined && (typeof requestKey !== "string" || !requestKey.length || requestKey.length > 200))
      throw Error("A requestKey must contain 1–200 characters.");
    let captured;
    try { captured = captureCommands(commands); }
    catch (error) { reportApplyPreflightFailure(requestKey); throw error; }
    const safeLabel = String(label).slice(0, 100);
    let fingerprint;
    if (requestKey !== undefined) {
      const payload = new TextEncoder().encode(JSON.stringify({commands: captured.commands, expectedRevision, label: safeLabel}));
      fingerprint = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", payload)), value => value.toString(16).padStart(2, "0")).join("");
      const previous = requests.get(requestKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw Error("This requestKey was already used for a different edit. Use a new key.");
        const operation = operations.get(previous.id);
        if (!operation) throw Error("This requestKey was already processed, but its result has expired. Inspect the project; do not replay it.");
        return wait ? operation.work : {...snapshot(operation), operationId: operation.id};
      }
      if (requests.size >= 1024) throw Error("This editor session has retained 1024 retry keys. Save and reopen the editor before starting more keyed edits.");
    }
    if (activeOperation || navigating) { reportApplyPreflightFailure(requestKey); throw new Error("Finish the current editor operation before applying another batch."); }
    if (expectedRevision !== undefined && expectedRevision !== host.revision()) {
      reportApplyPreflightFailure(requestKey);
      throw new Error("The document changed. Inspect it again before applying this batch.");
    }
    const operation = { id: operationId(), documentId: host.inspect().id, status: "queued", commandsProcessed: 0,
      commandsTotal: captured.commands.length, expectedRevision, revision: host.revision(), requestKey, controller: new AbortController() };
    operations.set(operation.id, operation);
    if (requestKey !== undefined) requests.set(requestKey, {id: operation.id, fingerprint});
    activeOperation = operation;
    if (operations.size > 64) {
      for (const [id, entry] of operations) {
        if (["completed", "failed", "cancelled"].includes(entry.status)) operations.delete(id);
        if (operations.size <= 64) break;
      }
    }
    operation.work = runApply(operation, captured.commands, safeLabel);
    // Polling callers can disconnect; their failures remain in the operation log.
    void operation.work.catch(() => {});
    if (!wait) return {...snapshot(operation), operationId: operation.id};
    return operation.work;
  };
  return Object.freeze({
    version: AUTOMATION_VERSION,
    sessionId,
    desktop,
    inspect: () => {
      const latest = [...operations.values()].at(-1);
      return { sessionId, revision: host.revision(), document: host.inspect(), latestOperation: latest ? snapshot(latest) : null };
    },
    commands: () => host.commands(),
    tools: () => automationTools({}).map(tool => { const schema = {...tool}; delete schema.execute; return schema; }),
    apply,
    validate: async (options = {}) => {
      try {
        assertIdle();
        if (options.expectedRevision !== undefined && options.expectedRevision !== host.revision()) throw Error("The document changed. Inspect it again before validating this batch.");
        const revision = host.revision();
        const result = await host.validate(options);
        reportOperation("validate", result?.valid === false ? "failure" : "success");
        return {...result, revision, stale: host.revision() !== revision};
      } catch (error) {
        reportOperation("validate", "failure");
        throw error;
      }
    },
    cancel: id => {
      const operation = operations.get(id);
      if (!operation) throw Error("Unknown editor operation.");
      if (["queued", "running"].includes(operation.status)) operation.controller.abort();
      return snapshot(operation);
    },
    projects: () => host.projects(),
    openProject: async (options = {}) => {
      try { const result = await navigate(() => host.openProject(options)); reportOperation("open_project", "success"); return result; }
      catch (error) { reportOperation("open_project", "failure"); throw error; }
    },
    importProject: async (options = {}) => {
      try { const result = await navigate(() => host.importProject(options)); reportOperation("import_project", "success"); return result; }
      catch (error) { reportOperation("import_project", "failure"); throw error; }
    },
    artifacts: () => host.artifacts(),
    artifact: id => host.artifact(id),
    readArtifact: async options => {
      try { const result = await host.readArtifact(options); reportOperation("read_artifact", result ? "success" : "missing"); return result; }
      catch (error) { reportOperation("read_artifact", "failure"); throw error; }
    },
    removeArtifact: async id => {
      try { const result = await host.removeArtifact(id); reportOperation("remove_artifact", result ? "success" : "missing"); return result; }
      catch (error) { reportOperation("remove_artifact", "failure"); throw error; }
    },
    downloadArtifact: async id => {
      try { const result = await host.downloadArtifact(id); reportOperation("download_artifact", result?.status === "missing" ? "missing" : result?.status === "requested" ? "success" : "failure"); return result; }
      catch (error) { reportOperation("download_artifact", "failure"); throw error; }
    },
    capturePreview: () => {
      try { assertIdle(); const result = host.capturePreview(); reportOperation("capture_preview", "success"); return result; }
      catch (error) { reportOperation("capture_preview", "failure"); throw error; }
    },
    operation: id => {
      if (typeof id !== "string" || !operations.has(id)) throw new Error("Unknown editor operation.");
      return snapshot(operations.get(id));
    },
    operations: () => [...operations.values()].map(snapshot),
    newDocument: async (options = {}) => {
      try { const result = await navigate(() => host.newDocument(options)); reportOperation("new_document", "success"); return result; }
      catch (error) { reportOperation("new_document", "failure"); throw error; }
    },
    preview: async (options = {}) => {
      const previewKind = options.kind === "comparison" || options.compare ? "comparison" : options.kind || (options.contactSheet ? "contact-sheet" : "frame");
      try { const result = await host.preview(options); reportOperation("preview", "success", { preview_kind: result?.kind || previewKind }); return result; }
      catch (error) { reportOperation("preview", "failure", { preview_kind: previewKind }); throw error; }
    },
    save: async () => {
      try {
        const saved = await host.save();
        reportOperation("save", saved ? "success" : "failure");
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
      } catch (error) { reportOperation("save", "failure"); throw error; }
    },
    export: async (options = {}) => {
      try {
        const result = await host.export(options);
        const persistence = result?.exportResult?.persistence?.status;
        const artifact_persistence = persistence === "persisted" ? "persisted" : persistence === "failed" ? "failed" : "not_requested";
        reportOperation("export", "success", artifact_persistence ? { artifact_persistence } : {});
        return result;
      } catch (error) { reportOperation("export", error?.name === "ProExportRequired" ? "blocked" : "failure"); throw error; }
    },
    exportResult: () => host.exportResult?.() ?? null,
    colorProfile: async (options = {}) => {
      try {
        if ((options.operation || "inspect") !== "inspect") { desktop.assertEditable(); assertIdle(); }
        if (options.expectedRevision !== undefined && options.expectedRevision !== host.revision())
          throw Error("The document changed. Inspect it again before changing its profile.");
        const result = await host.colorProfile(options);
        if ((options.operation || "inspect") !== "inspect") reportOperation("color_profile", "success", { changed: result?.changed === true });
        return result;
      } catch (error) {
        if ((options.operation || "inspect") !== "inspect") reportOperation("color_profile", "failure", { changed: false });
        throw error;
      }
    },
    runLua: async (options = {}) => {
      try {
        desktop.assertEditable();
        assertIdle();
        if (options.expectedRevision !== undefined && options.expectedRevision !== host.revision())
          throw Error("The document changed. Inspect it again before running Lua.");
        const result = await host.runLua(options);
        reportOperation("lua", "success", { changed: result?.changed === true });
        return result;
      } catch (error) {
        reportOperation("lua", error?.name === "AbortError" ? "cancelled" : "failure", { changed: false });
        throw error;
      }
    },
    undo: async () => {
      try { desktop.assertEditable(); assertIdle(); const result = await host.undo(); reportOperation("undo", "success", { changed: result?.changed === true }); return { revision: host.revision(), changed: result?.changed === true, document: host.inspect() }; }
      catch (error) { reportOperation("undo", "failure", { changed: false }); throw error; }
    },
    redo: async () => {
      try { desktop.assertEditable(); assertIdle(); const result = await host.redo(); reportOperation("redo", "success", { changed: result?.changed === true }); return { revision: host.revision(), changed: result?.changed === true, document: host.inspect() }; }
      catch (error) { reportOperation("redo", "failure", { changed: false }); throw error; }
    },
  });
}

export function automationTools(api) {
  return [
    {name:"pixelwall_projects",description:"List projects saved in this editor's local library.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{},additionalProperties:false},execute:()=>api.projects()},
    {name:"pixelwall_open_project",description:"Save the active project and open a project from the local library by ID.",inputSchema:{type:"object",properties:{documentId:{type:"string",minLength:1,maxLength:200}},required:["documentId"],additionalProperties:false},execute:options=>api.openProject(options)},
    {name:"pixelwall_import_project",description:"Import compressed or legacy JSON PixelWall project bytes as a new editable library project.",inputSchema:{type:"object",properties:{bytes:{type:"array",minItems:1,maxItems:16777216,items:{type:"integer",minimum:0,maximum:255}},name:{type:"string",minLength:1,maxLength:240}},required:["bytes"],additionalProperties:false},execute:options=>api.importProject(options)},
    {name:"pixelwall_validate",description:"Run commands against a scratch document without changing artwork. Reports validity, affected layers and image pixels; this is not a runtime estimate. A time limit is checked between commands.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{commands:{type:"array",minItems:1,maxItems:2000,items:{type:"object"}},expectedRevision:{type:"integer",minimum:0},timeoutMs:{type:"integer",minimum:50,maximum:10000}},required:["commands"],additionalProperties:false},execute:options=>api.validate(options)},
    {name:"pixelwall_cancel",description:"Request cancellation of a running command batch. It rolls back scratch edits at the next command boundary. Poll until status is cancelled or completed.",inputSchema:{type:"object",properties:{operationId:{type:"string",minLength:1,maxLength:200}},required:["operationId"],additionalProperties:false},execute:({operationId})=>api.cancel(operationId)},
    {name:"pixelwall_capture_preview",description:"Capture the current immutable document as the baseline for before/after previews. One baseline is retained for this editor session.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{},additionalProperties:false},execute:()=>api.capturePreview()},
    {name:"pixelwall_artifacts",description:"List generated files retained on this device. Metadata includes IDs, checksums, sizes and expiry. No file bytes are included.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{},additionalProperties:false},execute:()=>api.artifacts()},
    {name:"pixelwall_read_artifact",description:"Retrieve a bounded chunk of a retained generated file, including its SHA-256 metadata. Returns null for an expired or missing artifact.",annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{artifactId:{type:"string",minLength:1,maxLength:200},offset:{type:"integer",minimum:0},length:{type:"integer",minimum:1,maximum:1048576}},required:["artifactId"],additionalProperties:false},execute:options=>api.readArtifact(options)},
    {name:"pixelwall_remove_artifact",description:"Remove one temporary generated file from this device's artifact library. The editable source project is unaffected.",inputSchema:{type:"object",properties:{artifactId:{type:"string",minLength:1,maxLength:200}},required:["artifactId"],additionalProperties:false},execute:({artifactId})=>api.removeArtifact(artifactId)},
    {name:"pixelwall_download_artifact",description:"Request a browser download of a retained generated file. Browser download completion cannot be observed.",inputSchema:{type:"object",properties:{artifactId:{type:"string",minLength:1,maxLength:200}},required:["artifactId"],additionalProperties:false},execute:({artifactId})=>api.downloadArtifact(artifactId)},
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
          wait: { type: "boolean", description: "Return an operation handle immediately for bounded polling." },
          requestKey: {type:"string",minLength:1,maxLength:200,description:"Unique edit ID. Identical retries reuse the original operation within this editor session."},
        },
        required: ["commands"],
        additionalProperties: false,
      },
      execute: (input) => api.apply(input),
    },
    {
      name: "pixelwall_operation",
      description: "Poll a long-running PixelWall edit. Reports commands processed, total commands, current revision and completion or failure status.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { operationId: { type: "string", minLength: 1, maxLength: 200 } },
        required: ["operationId"],
        additionalProperties: false,
      },
      execute: ({ operationId }) => api.operation(operationId),
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
        "Render a PNG frame, animation contact sheet, or before/after comparison. Supports layer filtering, crop and nearest-neighbor scale. Capture a baseline before using comparison.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: {
          frameId: { type: "string" },
          scale: { type: "integer", minimum: 1, maximum: 8 },
          kind:{type:"string",enum:["frame","contact-sheet","comparison"]},
          layerIds:{type:"array",minItems:1,maxItems:256,items:{type:"string"}},
          frameIds:{type:"array",minItems:1,maxItems:64,items:{type:"string"}},
          crop:{type:"object",properties:{x:{type:"integer"},y:{type:"integer"},width:{type:"integer",minimum:1},height:{type:"integer",minimum:1}},required:["x","y","width","height"],additionalProperties:false},
          columns:{type:"integer",minimum:1,maximum:64},
          gap:{type:"integer",minimum:0,maximum:64},
          beforeFrameId:{type:"string"},
          beforeLayerIds:{type:"array",maxItems:256,items:{type:"string"}},
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
          download: { type: "boolean", description: "Request a browser download. Defaults to true; false leaves a retrievable artifact URL without starting a download." },
        },
        required: ["format"],
        additionalProperties: false,
      },
      execute: (input) => api.export(input),
    },
    {
      name: "pixelwall_export_result",
      description: "Read the latest browser export handoff. Its temporary URLs expire on the next export, dismiss, or editor unmount. Persisted artifact IDs remain retrievable within the artifact retention limits. Browser download completion is not observable.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => api.exportResult(),
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
}

export function registerAutomation(context, api) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  for (const definition of automationTools(api)) {
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
