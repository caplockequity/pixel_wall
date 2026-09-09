-- Original CC0 fractional export geometry fixture.
local directory=app.params.directory
local s=Sprite(7,5)
s.gridBounds=Rectangle(0,0,3,2)
app.command.NewLayer{tilemap=true,name='Tiles'}
local l=app.layer;local ts=l.tileset
local t=s:newTile(ts)
for y=0,1 do for x=0,2 do t.image:drawPixel(x,y,app.pixelColor.rgba(x*90,y*180,100,255)) end end
local image=Image(3,2,ColorMode.TILEMAP)
image:drawPixel(0,0,1);image:drawPixel(1,0,1|0x80000000);image:drawPixel(2,0,1|0x20000000);image:drawPixel(0,1,1|0x40000000)
for i,x in ipairs({-5,-2,-1,0,1,2,3,6,8}) do
 local layer=i==1 and l or s:newLayer();if i>1 then app.layer=layer;app.command.ConvertLayer{to='tilemap'};layer=app.layer;layer.tileset=ts end
 layer.name=tostring(x);s:newCel(layer,1,image,Point(x,x))
end
s:saveAs(directory..'/tilemap.aseprite');s:close()
local s=Sprite(7,5);local image=Image(3,2);image:clear(Color{r=255,g=255,b=255})
s:newCel(s.layers[1],1,image,Point(1,1));local slice=s:newSlice(Rectangle(-1,-2,5,6));slice.name='detail';slice.pivot=Point(3,4);slice.center=Rectangle(1,2,3,2)
s:saveAs(directory..'/slice.aseprite');s:close()
