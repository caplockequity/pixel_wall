-- Original fixtures for the public native Lua command interface, not upstream tests.
local out=app.params.output
local jobs={}
local function pixels(kind,w,h)
 local im=Image(w,h,kind=='gray' and ColorMode.GRAY or ColorMode.RGB)
 for y=0,h-1 do for x=0,w-1 do
  local r=(x*37+y*53)%256;local g=(x*19+y*97)%256;local b=(x*83+y*11)%256
  local a=({0,1,7,8,31,32,63,96,127,128,191,224,254,255})[(x+y*3)%14+1]
  if kind=='gray' then r=(x*13+y*29)%256;im:drawPixel(x,y,app.pixelColor.graya(a==0 and 0 or r,a))
  else if a==0 then r=0;g=0;b=0 end;im:drawPixel(x,y,app.pixelColor.rgba(r,g,b,a)) end
 end end
 return im
end
local function palette()
 local p=Palette(18)
 for i=0,17 do p:setColor(i,Color{r=(i*23)%256,g=(i*51)%256,b=(i*79)%256,a=({255,64,128,191})[i%4+1]}) end
 p:setColor(0,Color{r=0,g=0,b=0,a=0});p:setColor(1,Color{r=0,g=0,b=0});p:setColor(2,Color{r=255,g=255,b=255});p:setColor(16,p:getColor(7));p:setColor(17,p:getColor(7))
 return p
end
local serial=0
local function run(kind,algorithm,dither,fit,matrix,quant,max,alpha)
 serial=serial+1;local name=string.format('job-%03d',serial)
 local s=Sprite(32,17,kind=='gray' and ColorMode.GRAY or ColorMode.RGB)
 s.cels[1].image=pixels(kind,32,17);s:setPalette(palette())
 if kind=='composite' or kind=='background' then
  if kind=='background' then app.command.BackgroundFromLayer() end
  if kind=='composite' then
   local layer=s:newLayer();layer.opacity=149;layer.blendMode=BlendMode.MULTIPLY;s:newCel(layer,1,pixels('rgb',18,9),Point(3,2))
   local hidden=s:newLayer();hidden.isVisible=false;local im=Image(32,17);im:clear(Color{r=255,g=0,b=255});s:newCel(hidden,1,im)
   s:newFrame(1);s:newFrame(1);s.frames[2].duration=.041;s.frames[3].duration=.213
   app.range.layers={s.layers[1]};app.range.frames={s.frames[1],s.frames[2]};app.command.LinkCels()
   local alternative=Image(32,17);alternative:clear(Color{r=151,g=70,b=249,a=192});s.layers[1]:cel(3).image=alternative
   local ts=s:newTileset(Rectangle(0,0,2,2),2);ts:tile(1).image:clear(Color{r=0,g=255,b=0})
  end
 end
 if kind=='tiles' then
  local ts=s:newTileset(Rectangle(0,0,2,3),3);ts:tile(1).image=pixels('rgb',2,3);ts:tile(2).image=pixels('rgb',2,3);ts.name='Transformed tiles';ts:tile(1).data='preserved'
  app.command.NewLayer{name='Map',tilemap=true};local l=app.layer;l.tileset=ts
  local map=Image{width=4,height=2,colorMode=ColorMode.TILEMAP};for y=0,1 do for x=0,3 do map:drawPixel(x,y,app.pixelColor.tile((x+y)%2+1,(y*4+x)<<29)) end end
  s:newCel(l,1,map,Point(5,2));s:newFrame(1);app.range.layers={l};app.range.frames={s.frames[1],s.frames[2]};app.command.LinkCels()
  for n=#s.tilesets,1,-1 do if s.tilesets[n]~=ts then s:deleteTileset(s.tilesets[n]) end end
 end
 if kind=='exact' then
  local p=palette();p:setColor(0,Color{r=230,g=21,b=58,a=255});p:setColor(5,Color{r=0,g=0,b=0,a=0});s:setPalette(p)
  local im=s.cels[1].image;for y=0,s.height-1 do for x=0,s.width-1 do local c=p:getColor((x+y)%#p);im:drawPixel(x,y,app.pixelColor.rgba(c.red,c.green,c.blue,c.alpha)) end end
 end
 s:saveAs(out..'/'..name..'-source.aseprite')
 if quant then app.command.ColorQuantization{ui=false,withAlpha=alpha,maxColors=max,algorithm=quant} end
 local quantized={};for i=0,#s.palettes[1]-1 do local c=s.palettes[1]:getColor(i);quantized[#quantized+1]=string.format('#%02x%02x%02x%02x',c.red,c.green,c.blue,c.alpha) end
 -- Global PixelWall conversion chooses a common palette. Native scripts make that
 -- explicit for all frames so the reference tests the same operation.
 if quant then local p=s.palettes[1];for _,f in ipairs(s.frames) do app.frame=f;s:setPalette(p) end end
 app.command.ChangePixelFormat{ui=false,format='indexed',dithering=dither,['dithering-matrix']=matrix,rgbmap=algorithm,fitCriteria=fit}
 s:saveAs(out..'/'..name..'-indexed.aseprite')
 s:close();s=assert(app.open(out..'/'..name..'-indexed.aseprite'))
 local rgba={};for i,f in ipairs(s.frames) do local im=Image(s.width,s.height,ColorMode.RGB);im:drawSprite(s,f.frameNumber);local file=assert(io.open(out..'/'..name..'-'..i..'.rgba','wb'));file:write(im.bytes);file:close() end
 jobs[#jobs+1]={name=name,kind=kind,rgbmap=algorithm,dithering=dither,fitCriteria=fit,ditherMatrix=matrix,quantization=quant,maxColors=max,withAlpha=alpha,palette=quantized,frames=#s.frames}
 s:close()
end
for _,algorithm in ipairs({'octree','rgb5a3'}) do
 for _,fit in ipairs({'default','rgb','linearizedRGB','ciexyz','cielab'}) do
  for _,dither in ipairs({'none','ordered','old','error-diffusion'}) do run('rgb',algorithm,dither,fit,'bayer4x4') end
 end
 for _,matrix in ipairs({'bayer2x2','bayer8x8'}) do for _,dither in ipairs({'ordered','old'}) do run('rgb',algorithm,dither,'rgb',matrix) end end
 for _,dither in ipairs({'none','ordered','error-diffusion'}) do run('gray',algorithm,dither,'rgb','bayer4x4') end
 for _,kind in ipairs({'exact','tiles'}) do for _,dither in ipairs({'none','ordered','old','error-diffusion'}) do run(kind,algorithm,dither,'rgb','bayer4x4') end end
 for _,quant in ipairs({'octree','rgb5a3'}) do
  for _,max in ipairs({2,8,16,32,256}) do for _,alpha in ipairs({true,false}) do run('rgb',algorithm,'none','rgb','bayer4x4',quant,max,alpha) end end
  run('composite',algorithm,'none','rgb','bayer4x4',quant,16,true)
  run('background',algorithm,'none','rgb','bayer4x4',quant,16,false)
 end
end
local file=assert(io.open(out..'/manifest.json','w'));file:write(json.encode(jobs));file:close();print('jobs',#jobs)
