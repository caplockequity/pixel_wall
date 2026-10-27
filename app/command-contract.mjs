/** Versioned machine-readable command contract shared by CLI and clients. */
import { COMMANDS, LIMITS } from './editor-core.mjs';

const common = new Set(['frameId','layerId','clipId','sliceId','tilesetId','sourceFrameId','expectedRevision']);
const requiredByType = new Map([
  ['batch',['commands']], ['layer.update',['layerId','patch']], ['layer.remove',['layerId']],
  ['frame.update',['patch']], ['frame.remove',[]], ['cel.set',['width','height','pixels']],
  ['image.stamp',['width','height','pixels']], ['draw.stroke',['points']], ['draw.line',['from','to']],
  ['draw.rect',['x','y','width','height']], ['draw.ellipse',['x','y','width','height']],
  ['draw.polygon',['points']], ['draw.fill',['x','y']], ['draw.gradient',['from','to','endColor']],
  ['draw.text',['x','y','text']], ['selection.transform',['selection','operation']], ['selection.clear',['selection']],
  ['palette.update',['palette']], ['palette.remap',['palette']], ['effect.apply',['effect']],
  ['animation.tween',['from','to']], ['animation.particles',['seed','count']], ['clip.update',['clipId','patch']],
  ['selection.replaceColors',['selection','mapping']],
  ['clip.remove',['clipId']], ['slice.update',['sliceId','patch']], ['slice.remove',['sliceId']],
]);
const enumValues = {
  operation:['move','scale','rotate','flipX','flipY'], direction:['forward','reverse','pingpong','pingpong_reverse'],
  mode:['canvas','scale'], colorMode:['rgba','indexed','grayscale'], effect:['replace','outline','brightness','contrast','hue','saturation','convolution','despeckle']
};
function schemaFor(command) {
  const props = {};
  for (const key of Object.keys(command.parameters || {})) {
    const item = { type: 'object' };
    if (key === 'commands') Object.assign(item,{type:'array',items:{type:'object'},maxItems:1024});
    else if (key === 'points' || key === 'pixels' || key === 'palette' || key === 'frameIds' || key === 'selection') item.type='array';
    else if (key === 'width' || key === 'height' || key === 'x' || key === 'y' || key === 'seed' || key === 'count' || key === 'index' || key === 'durationMs') item.type='integer';
    else if (key === 'filled' || key === 'loop' || key === 'linked' || key === 'replace' || key === 'bake') item.type='boolean';
    else if (key === 'opacity' || key === 'amount' || key === 'scale' || key === 'scaleX' || key === 'scaleY') item.type='number';
    else item.type='string';
    for (const [field, values] of Object.entries(enumValues)) if (key === field) item.enum = values;
    props[key] = item;
  }
  const schema={ type:'object', additionalProperties:false, properties:{type:{const:command.type},...props}, required:['type',...(requiredByType.get(command.type) || [])] };
  const nested={
    'clip.add':{clip:{type:'object',additionalProperties:false,properties:{id:{type:'string'},name:{type:'string'},frameIds:{type:'array',minItems:1},direction:{type:'string',enum:enumValues.direction},loop:{type:'boolean'}},required:[]}},
    'layer.add':{layer:{type:'object',additionalProperties:false,properties:{id:{type:'string'},name:{type:'string'},type:{type:'string',enum:['image','group','reference','tilemap']},parentId:{type:'string'},visible:{type:'boolean'},locked:{type:'boolean'},opacity:{type:'number'},blendMode:{type:'string'}}}},
    'batch':{commands:{type:'array',items:{type:'object'},minItems:1,maxItems:1024}},
  }[command.type];
  if(nested) Object.assign(schema.properties,nested);
  return schema;
}
export const COMMAND_SCHEMAS = Object.freeze(Object.fromEntries(COMMANDS.map(command => [command.type, schemaFor(command)])));
export const COMMAND_CONTRACT_VERSION = '1.0';
function fail(message, code, path) { const error = new Error(message); error.code=code; error.path=path; error.retryable=false; error.changed=false; throw error; }
function checkValue(value, rule, path) {
  if (rule.const !== undefined && value !== rule.const) fail(`${path} must equal ${rule.const}.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'array' && !Array.isArray(value)) fail(`${path} must be an array.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) fail(`${path} must be an object.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'string' && typeof value !== 'string') fail(`${path} must be a string.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'boolean' && typeof value !== 'boolean') fail(`${path} must be boolean.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'integer' && !Number.isSafeInteger(value)) fail(`${path} must be an integer.`, 'INVALID_ARGUMENT', path);
  if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail(`${path} must be a number.`, 'INVALID_ARGUMENT', path);
  if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`${path} has too many items.`, 'LIMIT_EXCEEDED', path);
  if (rule.enum && !rule.enum.includes(value)) fail(`${path} must be one of: ${rule.enum.join(', ')}.`, 'INVALID_ARGUMENT', path);
  if (rule.minItems !== undefined && value.length < rule.minItems) fail(`${path} must contain at least ${rule.minItems} items.`, 'INVALID_ARGUMENT', path);
  if (rule.properties && rule.type === 'object') for (const key of Object.keys(value)) { if (rule.additionalProperties === false && !rule.properties[key]) fail(`${path}.${key} is not supported.`, 'UNKNOWN_ARGUMENT', `${path}.${key}`); checkValue(value[key],rule.properties[key],`${path}.${key}`); }
}
export function validateCommand(command, { index = null, maxCommands = 2000 } = {}) {
  const prefix = index == null ? 'command' : `commands[${index}]`;
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail(`${prefix} must be an object.`, 'INVALID_COMMAND', prefix);
  const schema = COMMAND_SCHEMAS[command.type];
  if (!schema) fail(`${prefix}.type is unknown: ${String(command.type)}.`, 'UNKNOWN_COMMAND', `${prefix}.type`);
  for (const key of schema.required) if (!(key in command)) fail(`${prefix}.${key} is required.`, 'MISSING_ARGUMENT', `${prefix}.${key}`);
  for (const [key, rule] of Object.entries(schema.properties)) if (key in command) checkValue(command[key], rule, `${prefix}.${key}`);
  return { valid:true, type:command.type, index, commandCount:1 };
}
export function validateCommandManifest(value, { maxCommands = 2000 } = {}) {
  const commands = Array.isArray(value) ? value : value?.commands;
  if (!Array.isArray(commands)) fail('Manifest must be an array or an object with commands.', 'INVALID_MANIFEST', 'commands');
  if (commands.length > maxCommands) fail(`Manifest contains ${commands.length} commands; maximum is ${maxCommands}.`, 'LIMIT_EXCEEDED', 'commands');
  commands.forEach((command,index) => validateCommand(command,{index,maxCommands}));
  return { valid:true, commandCount:commands.length, contractVersion:COMMAND_CONTRACT_VERSION };
}
export function capabilityReport({ cliVersion='0.1.0', desktopVersion=null, interfaceName='cli' } = {}) {
  return { format:'pixelwall-capabilities', version:1, contractVersion:COMMAND_CONTRACT_VERSION, interface:interfaceName, cliVersion, desktopVersion, documentFormat:4, limits:{...LIMITS, applyCommands:2000, batchCommands:1024, projectImportBytes:16*1024*1024, projectContainerBytes:64*1024*1024}, commands:COMMAND_SCHEMAS };
}
