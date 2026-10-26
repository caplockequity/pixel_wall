/** Geometry shared by the editor preview, command API and CLI. Coordinates are pixels. */
export function isometricFaces(options = {}) {
  const integer = (value, label, min, max) => {
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    return value;
  };
  const shape = options.shape ?? 'tile';
  if (!['tile', 'block', 'ramp'].includes(shape)) throw new RangeError('Choose tile, block or ramp.');
  const x = integer(options.x ?? 0, 'Top X', -64000, 64000);
  const y = integer(options.y ?? 0, 'Top Y', -64000, 64000);
  const width = integer(options.width ?? 16, 'Isometric width', 4, 512);
  if (width % 4) throw new RangeError('Isometric width must be a multiple of 4.');
  const elevation = integer(options.elevation ?? (shape === 'tile' ? 0 : width / 2), 'Elevation', 0, 512);
  if (options.filled !== undefined && typeof options.filled !== 'boolean') throw new TypeError('Filled must be a boolean.');
  const direction = options.direction ?? 'right';
  if (!['left', 'right'].includes(direction)) throw new RangeError('Ramp direction must be left or right.');
  const back = { x, y }, right = { x: x + width / 2, y: y + width / 4 };
  const front = { x, y: y + width / 2 }, left = { x: x - width / 2, y: y + width / 4 };
  const lift = point => ({ x: point.x, y: point.y - elevation });
  const face = (role, points) => ({ role, points });
  if (shape === 'tile' || elevation === 0) return [face('top', [back, right, front, left])];
  if (shape === 'block') return [
    face('left', [lift(left), lift(front), front, left]),
    face('right', [lift(front), lift(right), right, front]),
    face('top', [lift(back), lift(right), lift(front), lift(left)]),
  ];
  // A planar ramp rises along one ground axis. The low edge stays on the ground.
  return direction === 'right' ? [
    face('right', [lift(right), front, right]),
    face('top', [lift(back), lift(right), front, left]),
  ] : [
    face('left', [lift(left), left, front]),
    face('top', [lift(back), right, front, lift(left)]),
  ];
}
