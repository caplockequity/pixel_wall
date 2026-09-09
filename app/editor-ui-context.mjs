/** Keep session UI state separate from the saved artwork, and reconcile IDs after scripts. */
export function editorUiContext(document, { selection = null, range = {}, active = {}, fgColor = '#000000ff', bgColor = '#ffffffff' } = {}) {
  const frameId = document.frames.find(frame => frame.id === active.frameId)?.id || document.frames[0].id;
  const layerId = document.layers.find(layer => layer.id === active.layerId)?.id || document.layers.find(layer => layer.type !== 'group')?.id || document.layers[0]?.id || '';
  const validIds = (ids, items) => [...new Set((ids || []).filter(id => items.some(item => item.id === id)))];
  return {
    fgColor,
    bgColor,
    active: { frameId, layerId },
    selection: selection != null && selection.length === document.width * document.height ? Uint8Array.from(selection, value => value ? 1 : 0) : null,
    range: {
      type: [0, 1, 2, 4].includes(range?.type) ? range.type : 0,
      frameIds: validIds(range?.frameIds, document.frames),
      layerIds: validIds(range?.layerIds, document.layers),
      colors: [...new Set((range?.colors || []).filter(index => Number.isInteger(index) && index >= 0 && index < document.palette.length))],
      sliceIds: validIds(range?.sliceIds, document.slices),
    },
  };
}
