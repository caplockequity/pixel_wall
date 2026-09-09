-- Original CC0 asymmetric tiles isolate each orientation and rounded tile image.
for bits=0,7 do
 local s=Sprite(7,5);s.gridBounds=Rectangle(0,0,3,2);app.command.NewLayer{tilemap=true};local l=app.layer;local t=s:newTile(l.tileset)
 for y=0,1 do for x=0,2 do t.image:drawPixel(x,y,app.pixelColor.rgba(10+x*70,y*180,100,255)) end end
 local image=Image(1,1,ColorMode.TILEMAP);local flags=(bits&1~=0 and 0x80000000 or 0)|(bits&2~=0 and 0x40000000 or 0)|(bits&4~=0 and 0x20000000 or 0)
 image:drawPixel(0,0,1|flags);s:newCel(l,1,image,Point(1,1));s:saveAs(app.params.directory..'/flag-'..bits..'.aseprite');s:close()
end
