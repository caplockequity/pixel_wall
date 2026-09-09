-- Original behavioral probe. Run native Aseprite with --script-param icc=PATH
-- and optionally grayIcc=PATH / tilemap=PATH before --script THIS_FILE.
-- The PixelWall runtime itself deliberately cannot load profiles from a path.
local icc=ColorSpace{fromFile=assert(app.params.icc,'Provide the CC0 synthetic RGB ICC')}
for _,mode in ipairs{ColorMode.RGB,ColorMode.GRAY,ColorMode.INDEXED}do
  local s=Sprite(1,1,mode)
  s.palettes[1]:setColor(1,Color{r=128,g=128,b=128,a=220})
  local value=mode==ColorMode.RGB and app.pixelColor.rgba(128,80,40,99)
    or mode==ColorMode.GRAY and app.pixelColor.graya(128,99) or 1
  s.cels[1].image:drawPixel(0,0,value)
  s:assignColorSpace(icc)
  s:convertColorSpace(ColorSpace{sRGB=true})
  print('converted',mode,s.cels[1].image:getPixel(0,0),s.palettes[1]:getColor(1).rgbaPixel)
  local n=Sprite(1,1,mode)
  n.cels[1].image:drawPixel(0,0,value)
  n:assignColorSpace(icc);n:convertColorSpace(ColorSpace())
  assert(n.cels[1].image:getPixel(0,0)==value)
end
if app.params.grayIcc then
  local s=Sprite(1,1,ColorMode.GRAY)
  s.cels[1].image:drawPixel(0,0,app.pixelColor.graya(128,99))
  s:assignColorSpace(ColorSpace{fromFile=app.params.grayIcc})
  s:convertColorSpace(ColorSpace{sRGB=true})
  print('gray-icc',s.cels[1].image:getPixel(0,0))
end
if app.params.tilemap then
  local s=app.open(app.params.tilemap)
  local image=s.tilesets[1]:tile(1).image;local before=image.bytes
  s:assignColorSpace(icc);s:convertColorSpace(ColorSpace{sRGB=true})
  assert(image.bytes==before and s.tilesets[1]:tile(1).image==image)
  print('tile-image-retained')
end
