import { isSRGB } from './color-management.mjs';

/** Transfer a pixel selection or brush between working profiles without losing empty pixels. */
export function transferPixelColors(pixels, source = 'sRGB', destination = 'sRGB', manager) {
  if (isSRGB(source) && isSRGB(destination)) return [...pixels];
  if (!manager) throw Error('Color management is still loading. Try again in a moment.');
  const colors = [...new Set(pixels.filter(pixel => pixel !== null))];
  const converted = manager.transformColors(colors, source, destination);
  const lookup = new Map(colors.map((color, index) => [color, converted[index]]));
  return pixels.map(pixel => pixel === null ? null : lookup.get(pixel));
}
