import editorSchemas from './mcp-schemas.mjs';
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_TOOLS = Object.freeze([
  ['pixelwall_inspect', 'Read the active PixelWall document and revision.', true],
  ['pixelwall_commands', 'Read the supported PixelWall editing commands.', true],
  ['pixelwall_apply', 'Apply a bounded command batch as one undoable transaction.', false],
  ['pixelwall_operation', 'Poll a long-running PixelWall command operation.', true],
  ['pixelwall_new_document', 'Create and activate a new PixelWall document.', false],
  ['pixelwall_preview', 'Render a PNG preview of the active document.', true],
  ['pixelwall_capture_preview', 'Capture a stable before/after preview for visual comparison.', true],
  ['pixelwall_lua', 'Run a bounded Lua script as one undoable transaction.', false],
  ['pixelwall_color_profile', 'Inspect or change the working color profile.', false],
  ['pixelwall_save', 'Save the active project.', false],
  ['pixelwall_export', 'Export the active artwork.', false],
  ['pixelwall_export_result', 'Read the latest export handoff.', true],
  ['pixelwall_undo', 'Undo the most recent editor transaction.', false],
  ['pixelwall_redo', 'Redo the most recently undone editor transaction.', false],
  ['pixelwall_projects', 'List editable projects in the local PixelWall library.', true],
  ['pixelwall_storage', 'Read local library budget, artwork usage, recovery usage, and save estimates.', true],
  ['pixelwall_persistence', 'Read active document, library, checkpoint, and file-delivery persistence state.', true],
  ['pixelwall_checkpoint', 'Create a guarded project checkpoint without requiring a local library save.', false],
  ['pixelwall_capabilities', 'Read versioned automation capabilities and limits.', true],
  ['pixelwall_command_schema', 'Read the JSON schema for editing commands.', true],
  ['pixelwall_open_temporary', 'Open project bytes without adding them to the local library.', false],
  ['pixelwall_temporary_projects', 'List retained temporary documents available for recovery.', true],
  ['pixelwall_open_temporary_project', 'Restore a retained temporary or file-backed document.', false],
  ['pixelwall_selection', 'Create, list or remove a bounded revision-scoped selection.', false],
  ['pixelwall_export_plan', 'Plan an export without starting delivery.', true],
  ['pixelwall_receipt', 'Read a durable request receipt.', true],
  ['pixelwall_wait_operation', 'Wait for a long-running operation update.', true],
  ['pixelwall_animation_review', 'Read animation diagnostics and loop review data.', true],
  ['pixelwall_open_project', 'Open a selected local PixelWall project.', false],
  ['pixelwall_import_project', 'Import a supplied PixelWall project into the local library.', false],
  ['pixelwall_validate', 'Validate a command batch without committing it.', true],
  ['pixelwall_cancel', 'Cancel a running PixelWall operation.', false],
  ['pixelwall_artifacts', 'List durable generated export artifacts.', true],
  ['pixelwall_read_artifact', 'Read a bounded byte chunk from a durable artifact.', true],
  ['pixelwall_remove_artifact', 'Remove a durable generated artifact.', false],
  ['pixelwall_download_artifact', 'Save a durable artifact through the approved desktop export handoff.', false],
  ['pixelwall_save_artifact', 'Save a durable artifact into the approved desktop export folder.', false],
]);
// Share the editor contract; desktop transport caps project byte arrays at 1 MiB.
const schemas = structuredClone(editorSchemas);
for (const name of ['pixelwall_import_project','pixelwall_open_temporary']) {
  schemas[name] = {...schemas[name], properties:{...schemas[name].properties, bytes:{...schemas[name].properties.bytes,maxItems:1048576}}};
}
schemas.pixelwall_save_artifact = {type:'object',properties:{artifactId:{type:'string',minLength:1,maxLength:200},filename:{type:'string',minLength:1,maxLength:240}},required:['artifactId'],additionalProperties:false};
export const MCP_SCHEMAS = Object.freeze(schemas);

export function toolDefinitions() { return MCP_TOOLS.map(([name, description, readOnly]) => ({ name, description, inputSchema: MCP_SCHEMAS[name], ...(readOnly ? { annotations: { readOnlyHint: true } } : {}) })); }
