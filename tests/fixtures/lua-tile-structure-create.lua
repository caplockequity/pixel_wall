local mode=app.params.mode=='indexed' and ColorMode.INDEXED or app.params.mode=='gray' and ColorMode.GRAY or ColorMode.RGB
local s=Sprite(4,2,mode)
if mode==ColorMode.INDEXED then local p=Palette(4);p:setColor(0,Color{r=0,g=0,b=0,a=0});p:setColor(1,Color{r=255,g=0,b=0});p:setColor(2,Color{r=0,g=255,b=0});p:setColor(3,Color{r=0,g=0,b=255});s:setPalette(p) end
local ts=s:newTileset(Rectangle(0,0,2,2),3)
ts.name='Native tiles';ts.baseIndex=1;ts.data='original set';ts:tile(1).data='original tile'
local a,b=ts:tile(1).image,ts:tile(2).image
local colors=mode==ColorMode.INDEXED and {1,2,3} or mode==ColorMode.GRAY and {app.pixelColor.graya(60,255),app.pixelColor.graya(120,255),app.pixelColor.graya(240,255)} or {app.pixelColor.rgba(255,0,0,255),app.pixelColor.rgba(0,255,0,255),app.pixelColor.rgba(0,0,255,255)}
a:clear(colors[1]);a:drawPixel(0,0,colors[2]);b:clear(colors[3])
app.command.NewLayer{name='Tiles',tilemap=true};local layer=app.layer;layer.tileset=ts
local map=Image{width=2,height=1,colorMode=ColorMode.TILEMAP};map:drawPixel(0,0,app.pixelColor.tile(1,0x80000000));map:drawPixel(1,0,app.pixelColor.tile(2,0x60000000));s:newCel(layer,1,map,Point(0,0))
s:newFrame(1)
app.range.layers={layer};app.range.frames={s.frames[1],s.frames[2]};app.command.LinkCels();print('linked',layer:cel(1).image.id==layer:cel(2).image.id)
app.command.NewLayer{name='Hidden shared tiles',tilemap=true};local hidden=app.layer;hidden.tileset=ts;hidden.isVisible=false;s:newCel(hidden,1,map,Point(0,0))
for n=#s.tilesets,1,-1 do if s.tilesets[n]~=ts then s:deleteTileset(s.tilesets[n]) end end
s:saveAs(app.params.output)
print('created',#s.tilesets,#ts,#s.frames)
