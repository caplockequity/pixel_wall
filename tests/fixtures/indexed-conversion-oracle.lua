-- Original deterministic gradients for independent quantization/dithering comparison.
local s=Sprite(16,8,ColorMode.RGB)
local image=s.cels[1].image
for y=0,7 do for x=0,15 do
  local v=math.floor(x*255/15)
  local r,g,b,a=v,v,v,255
  if app.params.kind=='color' then r=(x*17+y*31)%256;g=(x*43+y*19)%256;b=(x*7+y*61)%256;a=(x+y)%5==0 and 96 or 255 end
  image:drawPixel(x,y,app.pixelColor.rgba(r,g,b,a))
end end
local p=Palette(3)
p:setColor(0,Color{r=0,g=0,b=0,a=0});p:setColor(1,Color{r=0,g=0,b=0});p:setColor(2,Color{r=255,g=255,b=255});s:setPalette(p)
s:saveAs(app.params.output..'-source.aseprite')
if app.params.quantization then app.command.ColorQuantization{ui=false,withAlpha=true,maxColors=8,algorithm=app.params.quantization} end
app.command.ChangePixelFormat{ui=false,format='indexed',dithering=app.params.dithering or 'none',['dithering-matrix']=app.params.matrix or 'bayer4x4',rgbmap='octree',fitCriteria='rgb'}
s:saveAs(app.params.output..'-indexed.aseprite')
print('palette',#s.palettes[1])
