-- Original CC0 linked cels, offsets, alpha, indexed color and grayscale.
local dir=app.params.directory
for _,name in ipairs({'rgba','indexed','grayscale'}) do
 local mode=name=='indexed' and ColorMode.INDEXED or name=='grayscale' and ColorMode.GRAY or ColorMode.RGB
 local s=Sprite(7,5,mode);local p=s.palettes[1]
 if mode==ColorMode.INDEXED then p:resize(4);p:setColor(0,Color{r=0,g=0,b=0,a=0});p:setColor(1,Color{r=250,g=40,b=10});p:setColor(2,Color{r=5,g=220,b=80});p:setColor(3,Color{r=20,g=50,b=245}) end
 local bottom=s.layers[1];bottom.name='Offset'
 local top=s:newLayer();top.name='Linked overlay'
 local a,b=Image(3,2,mode),Image(2,3,mode)
 for y=0,1 do for x=0,2 do a:drawPixel(x,y,mode==ColorMode.INDEXED and 1+(x+y)%3 or mode==ColorMode.GRAY and app.pixelColor.graya(40+x*60,y==0 and 255 or 128) or app.pixelColor.rgba(x*90,y*180,50,y==0 and 255 or 128)) end end
 for y=0,2 do for x=0,1 do b:drawPixel(x,y,mode==ColorMode.INDEXED and 1+(x+y)%3 or mode==ColorMode.GRAY and app.pixelColor.graya(220-y*60,128) or app.pixelColor.rgba(240,y*70,x*190,128)) end end
 s:newCel(bottom,1,a,Point(-1,1));s:newCel(top,1,b,Point(2,-1));s:newFrame();s.frames[2].duration=.23
 s.cels[#s.cels].position=Point(3,1)
 app.sprite=s;app.range.layers={bottom};app.range.frames={s.frames[1],s.frames[2]};app.command.LinkCels();app.range:clear()
 s:saveAs(dir..'/linked-'..name..'.aseprite');s:close()
end
