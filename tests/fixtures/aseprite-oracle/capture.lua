-- Original audit harness; uses the documented Aseprite API, no copied implementation.
local sprite = app.open(app.params.input)
assert(sprite, "Cannot open fixture")
local prefix = app.params.output
local metadata = {
  version=tostring(app.version), apiVersion=app.apiVersion,
  width=sprite.width, height=sprite.height, colorMode=sprite.colorMode,
  frames={}, layers={}, tags={}, slices={}
}
local function layerList(layers, prefix)
  for _, layer in ipairs(layers) do
    local path = prefix .. layer.name
    table.insert(metadata.layers, {
      name=layer.name, path=path, group=layer.isGroup,
      tilemap=layer.isTilemap, reference=layer.isReference,
      visible=layer.isVisible, opacity=layer.opacity, blendMode=layer.blendMode
    })
    if layer.isGroup then layerList(layer.layers, path .. "/") end
  end
end
layerList(sprite.layers, "")
for i, frame in ipairs(sprite.frames) do
  local image = Image(sprite.width, sprite.height, ColorMode.RGB)
  image:drawSprite(sprite, i)
  local filename = prefix .. "-" .. string.format("%03d", i)
  local raw = assert(io.open(filename .. ".rgba", "wb"))
  raw:write(image.bytes)
  raw:close()
  image:saveAs(filename .. ".png")
  table.insert(metadata.frames, {index=i, durationMs=math.floor(frame.duration*1000+0.5)})
end
for _, tag in ipairs(sprite.tags) do
  table.insert(metadata.tags, {name=tag.name, from=tag.fromFrame.frameNumber,
    to=tag.toFrame.frameNumber, direction=tag.aniDir, repeats=tag.repeats})
end
for _, slice in ipairs(sprite.slices) do
  table.insert(metadata.slices, {name=slice.name})
end
local file = assert(io.open(prefix .. ".json", "w"))
file:write(json.encode(metadata))
file:close()
sprite:close()
