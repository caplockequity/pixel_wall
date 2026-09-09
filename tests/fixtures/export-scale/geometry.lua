-- Original CC0 geometry grid: every layer is an independently placed cel.
local s=Sprite(7,5,ColorMode.RGB)
local case=0
for _,x in ipairs({-5,-2,-1,0,1,2,3,6,8}) do
 for _,w in ipairs({1,2,3,5,7,9}) do
  case=case+1
  local layer=case==1 and s.layers[1] or s:newLayer()
  local y=(case%7)-3;local h=(case%5)+1
  layer.name=string.format('%d,%d,%d,%d',x,y,w,h)
  local image=Image(w,h)
  for iy=0,h-1 do for ix=0,w-1 do image:drawPixel(ix,iy,app.pixelColor.rgba(1+ix*20,1+iy*30,100,255)) end end
  s:newCel(layer,1,image,Point(x,y))
 end
end
s:saveAs(app.params.directory..'/geometry.aseprite');s:close()
