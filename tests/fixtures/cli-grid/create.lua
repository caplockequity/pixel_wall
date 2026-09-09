-- Original fixture, CC0-1.0. All images contain deterministic coordinate colors.
local dir=app.params.out
local specs={{'basic',5,4,0,0,2,2},{'offset',5,4,1,1,2,2},{'negative',5,4,-1,-1,2,3},{'outside',5,4,7,6,2,2},{'default',5,4}}
for _,v in ipairs(specs) do
 local s=Sprite(v[2],v[3]);s.layers[1].name='Base'
 if v[4] then s.gridBounds=Rectangle(v[4],v[5],v[6],v[7]) end
 for frame=1,2 do
  if frame>1 then s:newEmptyFrame() end
  s.frames[frame].duration=frame==1 and .07 or .13
  local im=Image(s.width,s.height)
  for y=0,s.height-1 do for x=0,s.width-1 do im:drawPixel(x,y,app.pixelColor.rgba(10+x*30,20+y*40,frame*60,255)) end end
  s:newCel(s.layers[1],frame,im,Point(0,0))
 end
 local tag=s:newTag(1,2);tag.name='run'
 s:saveAs(dir..'/'..v[1]..'.ase')
 s:close()
end
