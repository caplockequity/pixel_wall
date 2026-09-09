// Export-only prerendered tiles must distinguish ordinary transparent pixels
// from native diagonal cells that replace the existing backdrop with zero.
// A private symbol keeps this temporary mask out of serialized project data.
export const TILE_BACKDROP_CLEAR = Symbol('temporary tile backdrop clearing');
