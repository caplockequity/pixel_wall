-- Original fixture, CC0-1.0.
local dir=app.params.out
for i,name in ipairs({'alpha','beta'}) do
 local s=Sprite(i==1 and 7 or 5,i==1 and 5 or 4);s.layers[1].name='Base';s.gridBounds=Rectangle(1,1,2,2)
 local overlay=s:newLayer();overlay.name='Detail'
 for frame=1,2 do
  if frame>1 then s:newEmptyFrame() end
  s.frames[frame].duration=(frame*60+i*10)/1000
  local im=Image(s.width,s.height)
  for y=0,s.height-1 do for x=0,s.width-1 do im:drawPixel(x,y,app.pixelColor.rgba(10+x*25,20+y*35,frame*40+i*10,255)) end end
  s:newCel(s.layers[1],frame,im,Point(0,0))
  local detail=Image(2,3)
  for y=0,2 do for x=0,1 do detail:drawPixel(x,y,app.pixelColor.rgba(200+x*15,y*40,20,255)) end end
  s:newCel(overlay,frame,detail,Point(frame==1 and -1 or 3,frame==1 and 1 or -1))
 end
 local tag=s:newTag(1,2);tag.name='run'
 local slice=s:newSlice(Rectangle(1,1,3,2));slice.name='middle'
 s:saveAs(dir..'/'..name..'.ase');s:close()
end
for _,spec in ipairs({{'tilemap','tests/fixtures/cli-grid/native/tilemap.ase'},{'linked-indexed','tests/fixtures/export-scale/linked-indexed.aseprite'},{'reference','tests/fixtures/export-scale/reference.aseprite'}}) do
 local s=app.open(spec[2]);s:saveAs(dir..'/'..spec[1]..'.ase');s:close()
end
