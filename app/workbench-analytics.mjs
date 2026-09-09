/** Privacy-safe product milestones for the workbench. Never receives artwork or names in capture(). */
const FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp', 'avif', 'bmp', 'tga', 'gif', 'aseprite', 'project', 'sheet', 'zip', 'json', 'pixelwall', 'image']);
const IMPORT_KINDS = new Set(['document', 'sequence', 'reference', 'sheet', 'palette', 'extension']);
const STORAGE_REASONS = new Map([
  ['UNAVAILABLE', 'unavailable'], ['BUDGET_EXCEEDED', 'budget_exceeded'],
  ['CONFLICT', 'conflict'], ['CORRUPT_RECORD', 'corrupt_record'],
  ['NOT_FOUND', 'not_found'], ['INVALID_DOCUMENT', 'invalid_document'],
  ['MISSING_IMAGE', 'missing_image'], ['QUOTA_EXCEEDED', 'quota_exceeded'],
]);
const FAMILIES = new Map([
  ['draw.stroke', 'drawing'], ['draw.fill', 'fill'], ['draw.gradient', 'gradient'], ['draw.text', 'text'],
  ...['line', 'rect', 'ellipse', 'polygon', 'curve'].map(type => [`draw.${type}`, 'shapes']),
  ...['add', 'update', 'reorder', 'duplicate', 'mergeDown', 'remove'].map(type => [`layer.${type}`, 'layers']),
  ...['add', 'update', 'reorder', 'duplicate', 'reverse', 'remove'].map(type => [`frame.${type}`, 'animation']),
  ...['add', 'update', 'remove'].map(type => [`clip.${type}`, 'animation']),
  ...['set', 'link', 'unlink', 'move', 'clear'].map(type => [`cel.${type}`, 'cels']),
  ['image.stamp', 'paste'], ['selection.transform', 'selection'], ['selection.clear', 'selection'],
  ['document.resize', 'canvas'], ['document.colorMode', 'palette'],
  ['palette.update', 'palette'], ['palette.remap', 'palette'], ['effect.apply', 'effects'],
  ['animation.tween', 'animation'], ['animation.particles', 'animation'],
  ...['add', 'update', 'remove'].map(type => [`slice.${type}`, 'slices']),
  ...['add', 'update', 'remove'].map(type => [`tileset.${type}`, 'tilemap']),
  ['tilemap.paint', 'tilemap'], ['tilemap.edit', 'tilemap'],
]);
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000) : 0;
export function analyticsFormat(value) {
  if (value === 'ase') return 'aseprite';
  return FORMATS.has(value) ? value : 'other';
}
export function analyticsStorageReason(error) {
  return STORAGE_REASONS.get(error?.code) || (error?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_failed');
}
export function workbenchShape(doc) {
  if (!doc) return { editor_variant: 'workbench' };
  return {
    editor_variant: 'workbench',
    canvas_width: count(doc.width), canvas_height: count(doc.height),
    frame_count: count(doc.frames?.length), layer_count: count(doc.layers?.length),
    clip_count: count(doc.clips?.length), slice_count: count(doc.slices?.length),
    color_mode: ['rgba', 'indexed', 'grayscale'].includes(doc.colorMode) ? doc.colorMode : 'rgba',
    has_reference: Boolean(doc.layers?.some(layer => layer.type === 'reference')),
  };
}
function commandFamilies(commands) {
  const families = new Set();
  let remaining = 2000;
  const visit = (list, depth = 0) => {
    if (depth > 8) return;
    for (const command of Array.isArray(list) ? list : [list]) {
      if (--remaining < 0) return;
      if (!command || typeof command !== 'object') continue;
      if (command.type === 'batch') { visit(command.commands, depth + 1); continue; }
      // Renaming metadata is not evidence that someone has started making artwork.
      if (['layer.update', 'frame.update', 'clip.update', 'slice.update', 'tileset.update'].includes(command.type)
        && Object.keys(command.patch || {}).every(key => ['name', 'metadata'].includes(key))) continue;
      if (command.type === 'tilemap.paint' && !command.points?.length) continue;
      const family = command.type === 'draw.stroke' && command.erase === true ? 'erase' : FAMILIES.get(command.type);
      if (family) families.add(family);
    }
  };
  visit(commands);
  return families;
}
export function createWorkbenchAnalytics({ capture, consented, getDocument, now = () => performance.now() }) {
  let loaded = false, activated = false, saveFailed = false, readySource = null;
  const tools = new Set();
  const allowed = () => { try { return consented() === true; } catch { return false; } };
  const emit = (event, properties, shape) => {
    if (!allowed()) return false;
    try {
      capture(event, { ...(shape || workbenchShape(getDocument())), ...properties });
      return true;
    } catch { return false; }
  };
  const methods = {
    loaded(source) {
      const project_source = ['new', 'library', 'legacy_migration', 'storage_unavailable'].includes(source) ? source : 'new';
      readySource = project_source;
      if (loaded) return;
      if (emit('editor_loaded', { project_source })) loaded = true;
    },
    consentChanged() {
      if (!allowed()) { saveFailed = false; return; }
      // This describes the editor that is ready now; no earlier edits are replayed.
      if (readySource !== null) methods.loaded(readySource);
    },
    committed(commands, changed) {
      if (!changed || !allowed()) return;
      for (const family of commandFamilies(commands)) {
        if (!activated && emit('editor_activated', { activation_type: family })) activated = true;
        if (!tools.has(family) && emit('editor_tool_used', { tool_family: family })) tools.add(family);
      }
    },
    project(operation, outcome) {
      if (!['new', 'open'].includes(operation) || !['completed', 'failed'].includes(outcome)) return;
      emit('project_file_operation', { operation, outcome: outcome === 'completed' ? 'success' : 'failure', ...(outcome === 'failed' ? { reason: 'project_operation_failed' } : {}) });
    },
    saveResult(error) {
      if (!allowed()) { saveFailed = false; return; }
      if (error) {
        if (!saveFailed && emit('autosave_failed', { reason: analyticsStorageReason(error) })) saveFailed = true;
      } else if (saveFailed && emit('autosave_recovered', {})) saveFailed = false;
    },
    imported(kind, format, fileCount, warningCount = 0, failed = false) {
      emit(failed ? 'import_failed' : 'import_completed', {
        import_kind: IMPORT_KINDS.has(kind) ? kind : 'document', format: analyticsFormat(format),
        file_count: count(fileCount), warning_count: count(warningCount),
        ...(failed ? { reason: 'import_failed' } : {}),
      });
    },
    exportStarted(format, source = 'ui') {
      const attempt = { format: analyticsFormat(format), source: source === 'automation' ? 'automation' : 'ui', startedAt: now(), shape: workbenchShape(getDocument()), captured: false };
      attempt.captured = emit('export_started', { export_type: attempt.format, source: attempt.source }, attempt.shape);
      return attempt;
    },
    exportFinished(attempt, error) {
      if (!attempt?.captured) return;
      const blocked = error?.name === 'ProExportRequired';
      emit(blocked ? 'export_blocked' : error ? 'export_failed' : 'export_completed', {
        export_type: attempt.format, source: attempt.source, duration_ms: count(Math.round(now() - attempt.startedAt)),
        ...(error ? { reason: blocked ? 'pro_required' : 'render_or_encode_error' } : {}),
      }, attempt.shape);
    },
    recovery(action, outcome, error) {
      if (!['view', 'restore'].includes(action) || !['completed', 'failed'].includes(outcome)) return;
      emit('recovery_action', { action, outcome: outcome === 'completed' ? 'success' : 'failure', ...(error ? { reason: analyticsStorageReason(error) } : {}) });
    },
    automation(operation, commandCount = 0) {
      if (!['apply', 'new_document', 'save', 'export', 'undo', 'redo'].includes(operation)) return;
      emit('automation_used', { operation, command_count: count(commandCount) });
    },
  };
  // A reporting failure cannot become an editing, storage, or export failure.
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => {
    try { return method(...args); } catch { return undefined; }
  }]));
}
