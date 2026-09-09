-- Original API contract, run unchanged in PixelWall and Aseprite 1.3.18.5.
local s=app.sprite
assert(#s.tilesets==1)
local ts=s.tilesets[1]
assert(#ts==3 and ts.name=='Native tiles' and ts.baseIndex==1)
assert(s.layers[1].tileset==nil and s.layers[2].tileset==ts and s.layers[3].tileset==ts)
assert(ts:tile(-1)==nil and ts:tile(3)==nil and ts:getTile(10)==nil)
assert(ts:tile(1).index==1 and ts:tile(0).index==0)
local grid=ts.grid;assert(grid.tileSize==Size(2,2) and grid.origin==Point(0,0))
assert(Grid(grid).tileSize==Size(2,2) and Grid().tileSize==Size(16,16))
assert(not pcall(function()grid.tileSize=Size(3,3)end))
local size=grid.tileSize;size.width=7;assert(grid.tileSize.width==2)
local first=ts:tile(1);local old=first.image
assert(ts:getTile(1).id==old.id and first.data=='original tile')
local indexed=s.colorMode==ColorMode.INDEXED
local gray=s.colorMode==ColorMode.GRAY
local function pixel(index,r,g,b) return indexed and index or gray and app.pixelColor.graya(index*60,255) or app.pixelColor.rgba(r,g,b,255) end
local color=pixel(3,0,0,255)
app.transaction('Tile artwork',function()
  old:clear(color);old:drawPixel(0,0,pixel(2,0,255,0))
  assert(first.image:getPixel(1,1)==color)
end)
local replacement=Image(first.image);replacement:flip(FlipType.HORIZONTAL)
first.image=replacement
assert(not pcall(function()old:getPixel(0,0)end))
assert(first.image:getPixel(1,0)==(pixel(2,0,255,0)))
local tile=ts:tile(2);tile.image:clear(pixel(1,255,0,0))
ts:tile(0).image:clear(pixel(2,0,255,0))
app.transaction('Tileset metadata',function()
 ts.name='Scripted tiles';ts.baseIndex=-3;ts.data='tileset metadata';ts.color=Color{r=11,g=22,b=33,a=44}
 ts.properties={answer=42,enabled=true};ts.properties('example/tiles').role='terrain'
 first.data='tile metadata';first.color=Color{r=55,g=66,b=77,a=88};first.properties={label='grass',count=7}
 ts:tile(0).data='reserved zero';ts:tile(2).properties('example/tiles').rank=2
end)
assert(ts.name=='Scripted tiles' and ts.baseIndex==-3 and ts.data=='tileset metadata')
assert(ts.color.rgbaPixel==app.pixelColor.rgba(11,22,33,44) and ts.properties.answer==42)
assert(first.color.rgbaPixel==app.pixelColor.rgba(55,66,77,88) and first.properties.label=='grass')
assert(ts.properties('example/tiles').role=='terrain' and ts:tile(2).properties('example/tiles').rank==2)
print('native-tileset-contract-ok')
