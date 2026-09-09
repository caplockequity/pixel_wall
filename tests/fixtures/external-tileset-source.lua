-- Original fixture: two tilesets ensure external IDs are not confused with counts/names.
local mode=app.params.mode=='indexed' and ColorMode.INDEXED or ColorMode.RGB
local s=Sprite(8,4,mode)
s.gridBounds=Rectangle(0,0,2,2)
local unused=s:newTileset(Rectangle(0,0,2,2),2);unused.name='unrelated'
app.command.NewLayer{tilemap=true,name='Tiles'}
local layer=app.layer;local ts=layer.tileset;ts.name='terrain';ts.baseIndex=7
local red=mode==ColorMode.INDEXED and 1 or app.pixelColor.rgba(255,0,0,255)
local green=mode==ColorMode.INDEXED and 2 or app.pixelColor.rgba(0,255,0,255)
if mode==ColorMode.INDEXED then local p=s.palettes[1];p:setColor(0,Color{r=0,g=0,b=0});p:setColor(1,Color{r=255,g=0,b=0});p:setColor(2,Color{r=0,g=255,b=0}) end
app.useTool{tool='pencil',layer=layer,color=red,tilesetMode=TilesetMode.AUTO,points={Point(0,0),Point(1,0)}}
app.useTool{tool='pencil',layer=layer,color=green,tilesetMode=TilesetMode.AUTO,points={Point(2,0),Point(3,1)}}
local image=Image(4,2,ColorMode.TILEMAP)
image:drawPixel(0,0,1);image:drawPixel(1,0,2|0x80000000);image:drawPixel(2,0,1|0x40000000);image:drawPixel(3,0,2|0x20000000)
s:newCel(layer,1,image,Point(0,0))
s:newFrame();s.frames[2].duration=.2
s:newCel(layer,2,image,Point(0,2))
s:saveAs(app.params.output)
print(#s.tilesets,#ts,ts.baseIndex)
