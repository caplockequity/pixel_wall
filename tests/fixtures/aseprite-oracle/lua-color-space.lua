local n=ColorSpace();local s=ColorSpace{sRGB=true};local c=ColorSpace(s)
print('construct-names',string.format('%q',n.name),string.format('%q',s.name),string.format('%q',c.name))
print('equality',n==ColorSpace(),s==c,n==s,s=={})
s.name='renamed';print('rename-equality',s==c,c.name)
local sprite=Sprite(1,1);sprite.cels[1].image:drawPixel(0,0,Color{r=128,g=70,b=20,a=35})
print('sprite-default',sprite.colorSpace==ColorSpace{sRGB=true},string.format('%q',sprite.colorSpace.name))
local read=sprite.colorSpace;read.name='detached';print('getter-detached',sprite.colorSpace.name,read.name)
local before=sprite.cels[1].image:getPixel(0,0)
local returned=sprite:assignColorSpace(s);print('assign-result',returned==s,sprite.colorSpace.name,before==sprite.cels[1].image:getPixel(0,0))
s.name='after';print('assign-detached',sprite.colorSpace.name)
sprite.colorSpace=n;print('setter-none',sprite.colorSpace==ColorSpace(),string.format('%q',sprite.colorSpace.name))
returned=sprite:convertColorSpace(ColorSpace{sRGB=true});print('convert-none',returned==ColorSpace{sRGB=true},sprite.colorSpace.name,before==sprite.cels[1].image:getPixel(0,0))
for _,v in ipairs{false,true,1,'abc',{}, {sRGB=false}, {sRGB=1}} do local ok,value=pcall(ColorSpace,v);print('argument',type(v),ok,ok and (value==n) or 'error',ok and (value==c) or 'error')end
for _,v in ipairs{false,true,123,{},''} do local vcopy=ColorSpace(s);local ok=pcall(function()vcopy.name=v end);print('name-set',type(v),ok,string.format('%q',vcopy.name))end
