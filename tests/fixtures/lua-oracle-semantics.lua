local pc=app.pixelColor
local function colors(s)
 local p={}
 for i,f in ipairs(s.frames) do local c=s.layers[1]:cel(i); p[#p+1]=c and tostring(pc.rgbaR(c.image:getPixel(0,0))) or 'empty' end
 print(table.concat(p,','))
end
local s=Sprite(1,1)
print('initial',#s.cels,s.cels[1].image.width,s.cels[1].image.height)
s.cels[1].image:drawPixel(0,0,pc.rgba(10,0,0))
local f=s:newFrame(); print('noarg',f.frameNumber); colors(s)
s.layers[1]:cel(2).image:drawPixel(0,0,pc.rgba(20,0,0))
local f2=s:newFrame(2); print('explicit2',f2.frameNumber); colors(s)
local f1=s:newFrame(1); print('explicit1',f1.frameNumber); colors(s)
local e=s:newEmptyFrame(2); print('empty2',e.frameNumber); colors(s)
local image=Image(1,1)
print('image',image.colorMode,pc.rgbaA(image:getPixel(0,0)))
local d=s:newLayer(); local im=Image(1,1); local c=s:newCel(d,1,im); im:drawPixel(0,0,pc.rgba(99,0,0)); print('newCelcopies',pc.rgbaR(c.image:getPixel(0,0)))
print('gray',Color{r=255,g=0,b=0}.gray)
