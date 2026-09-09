-- Original fixture, CC0-1.0.
local dir=app.params.out
local s=Sprite(5,4);s.gridBounds=Rectangle(0,0,2,2);s.layers[1].name='Base'
for f=1,2 do
 if f>1 then s:newEmptyFrame() end
 local im=Image(5,4);im:drawPixel(1,1,app.pixelColor.rgba(20,40,f*60,255));im:drawPixel(3,3,app.pixelColor.rgba(80,100,f*60,128))
 s:newCel(s.layers[1],f,im,Point(0,0));s.frames[f].duration=f==1 and .07 or .13
end
s:saveAs(dir..'/sparse.ase');s:close()
s=Sprite(5,4);s.gridBounds=Rectangle(0,0,2,2);s.layers[1].name='Base';local top=s:newLayer();top.name='Top';local hidden=s:newLayer();hidden.name='Hidden';hidden.isVisible=false
for f=1,2 do
 if f>1 then s:newEmptyFrame() end
 for li,l in ipairs(s.layers) do local im=Image(5,4);im:drawPixel(li-1,1,app.pixelColor.rgba(40*li,80,f*70,255));s:newCel(l,f,im,Point(0,0)) end
 s.frames[f].duration=f==1 and .08 or .16
end
local slice=s:newSlice(Rectangle(1,1,3,2));slice.name='middle';s:saveAs(dir..'/layers.ase');s:close()
s=Sprite(5,4,ColorMode.INDEXED);s.gridBounds=Rectangle(1,1,2,2)
local palette=Palette(4);palette:setColor(0,Color{r=0,g=0,b=0,a=0});palette:setColor(1,Color{r=200,g=20,b=30});palette:setColor(2,Color{r=10,g=180,b=90});palette:setColor(3,Color{r=30,g=60,b=220});s:setPalette(palette)
for f=1,2 do
 if f>1 then s:newEmptyFrame() end
 local im=Image(5,4,ColorMode.INDEXED);for y=0,3 do for x=0,4 do im:drawPixel(x,y,(x+y+f)%4) end end
 s:newCel(s.layers[1],f,im,Point(0,0));s.frames[f].duration=f==1 and .09 or .18
end
s:saveAs(dir..'/indexed.ase');s:close()
-- Reuse prior original CC0 fixtures to cover linked frame palettes and diagonal rectangular tiles.
for _,spec in ipairs({{'linked-indexed','linked-indexed'},{'tilemap','flag-4'}}) do
 s=app.open('tests/fixtures/export-scale/'..spec[2]..'.aseprite')
 if spec[1]=='linked-indexed' then s.gridBounds=Rectangle(1,1,2,2) else s.gridBounds=Rectangle(1,1,3,2);s.cels[1].position=Point(-1,-1) end
 s:saveAs(dir..'/'..spec[1]..'.ase');s:close()
end
