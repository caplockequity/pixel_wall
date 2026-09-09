-- Original CC0 regression fixture. Run with Aseprite --batch --script-param
-- directory=/absolute/path/to/this/folder --script /path/to/generate.lua.
-- Composite first in the source profile, then convert that flattened result.
local directory = assert(app.params.directory)
local backgroundAlpha = {255,255,255,255,128,128,0,0}
local foregroundAlpha = {0,64,128,192,64,128,128,255}
local sprite = Sprite(#backgroundAlpha,1,ColorMode.RGB)
sprite.layers[1].name = 'Black'
local top = sprite:newLayer()
top.name = 'White'
local black,white = Image(sprite.width,1),Image(sprite.width,1)
for i,alpha in ipairs(backgroundAlpha) do
  black:drawPixel(i-1,0,app.pixelColor.rgba(0,0,0,alpha))
  white:drawPixel(i-1,0,app.pixelColor.rgba(255,255,255,foregroundAlpha[i]))
end
sprite:newCel(sprite.layers[1],1,black)
sprite:newCel(top,1,white)
sprite:assignColorSpace(ColorSpace{fromFile=directory..'/linear.icc'})
sprite:saveAs(directory..'/source.aseprite')
local flat = Image(sprite.spec)
flat:drawSprite(sprite,1)
local working = flat.bytes
local output = Sprite(sprite.width,1,ColorMode.RGB)
output:newCel(output.layers[1],1,flat)
output:assignColorSpace(sprite.colorSpace)
output:convertColorSpace(ColorSpace{sRGB=true})
output:saveAs(directory..'/expected.png')
local converted = output.cels[1].image.bytes
local result={aseprite=tostring(app.version),apiVersion=app.apiVersion,
  profile='linear.icc',source='source.aseprite',expected='expected.png',
  width=sprite.width,height=1,backgroundAlpha=backgroundAlpha,foregroundAlpha=foregroundAlpha,
  working={},srgb={}}
for i=1,#working do table.insert(result.working,string.byte(working,i)) end
for i=1,#converted do table.insert(result.srgb,string.byte(converted,i)) end
local file=assert(io.open(directory..'/expected.json','w'))
file:write(json.encode(result));file:close()
output:close();sprite:close()
