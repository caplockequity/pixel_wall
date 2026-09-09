/** Pure Lua value objects used by the real VM. Kept separate from host/dialog bootstrap. */
export const LUA_VALUE_TYPES = String.raw`
local function coord(v) v=v or 0; if type(v)~='number' or v~=v or math.abs(v)>2147483647 then error('Geometry component is outside the supported integer range') end; return math.floor(v) end
local function geometry(kind,data,construct)
 local value={}; values[value]=data
 return setmetatable(value,{__metatable=kind,
  __index=function(self,key)
   local d=values[self];key=({w='width',h='height'})[key] or key
   if d[key]~=nil then return d[key] end
   if key=='isEmpty' and kind~='Point' then return d.width<=0 or d.height<=0 end
   if kind=='Rectangle' then
    if key=='origin' then return Point(d.x,d.y) elseif key=='size' then return Size(d.width,d.height) end
    if key=='contains' then return function(_,other,py)
     local o=values[other] or other
     if type(o)=='table' and (o.width~=nil or o.w~=nil or o[3]~=nil) then o=Rectangle(o);return not self.isEmpty and not o.isEmpty and o.x>=d.x and o.y>=d.y and o.x+o.width<=d.x+d.width and o.y+o.height<=d.y+d.height end
     o=Point(other,py);return not self.isEmpty and o.x>=d.x and o.y>=d.y and o.x<d.x+d.width and o.y<d.y+d.height
    end end
    if key=='intersects' or key=='intersect' then return function(_,other)
     local o=Rectangle(other);local x,y=math.max(d.x,o.x),math.max(d.y,o.y);local w,h=math.min(d.x+d.width,o.x+o.width)-x,math.min(d.y+d.height,o.y+o.height)-y
     local yes=not self.isEmpty and not o.isEmpty and w>0 and h>0
     if key=='intersects' then return yes end;return yes and Rectangle(x,y,w,h) or Rectangle()
    end end
    if key=='union' then return function(_,other)
     local o=Rectangle(other);if self.isEmpty then return Rectangle(o) elseif o.isEmpty then return Rectangle(self) end
     local x,y=math.min(d.x,o.x),math.min(d.y,o.y);return Rectangle(x,y,math.max(d.x+d.width,o.x+o.width)-x,math.max(d.y+d.height,o.y+o.height)-y)
    end end
   elseif kind=='Size' and key=='union' then return function(_,other) local o=Size(other);return Size(math.max(d.width,o.width),math.max(d.height,o.height)) end end
   error('Unsupported '..kind..'.'..tostring(key))
  end,
  __newindex=function(self,key,v)
   local d=values[self];key=({w='width',h='height'})[key] or key
   if d[key]~=nil then d[key]=coord(v);return end
   if kind=='Rectangle' and key=='origin' then local p=Point(v);d.x,d.y=p.x,p.y;return end
   if kind=='Rectangle' and key=='size' then local s=Size(v);d.width,d.height=s.width,s.height;return end
   error('Unsupported '..kind..' assignment: '..tostring(key))
  end,
  __eq=function(a,b) local x,y=values[a],values[b];if not x or not y then return false end;for k,v in pairs(x) do if y[k]~=v then return false end end;for k in pairs(y) do if x[k]==nil then return false end end;return true end,
  __add=function(a,b) if kind~='Point' and kind~='Size' then error('Unsupported geometry addition') end;local x,y=values[a],values[b];if not x or not y then error('Geometry addition requires matching values') end;if kind=='Point' then return construct(x.x+y.x,x.y+y.y) else return construct(x.width+y.width,x.height+y.height) end end,
  __sub=function(a,b) if kind~='Point' and kind~='Size' then error('Unsupported geometry subtraction') end;local x,y=values[a],values[b];if not x or not y then error('Geometry subtraction requires matching values') end;if kind=='Point' then return construct(x.x-y.x,x.y-y.y) else return construct(x.width-y.width,x.height-y.height) end end,
  __tostring=function(self) local d=values[self];if kind=='Point' then return string.format('Point{ x=%d, y=%d }',d.x,d.y) elseif kind=='Size' then return string.format('Size{ width=%d, height=%d }',d.width,d.height) end;return string.format('Rectangle{ x=%d, y=%d, width=%d, height=%d }',d.x,d.y,d.width,d.height) end,
 })
end
Point=function(x,y) if type(x)=='table' then local d=values[x] or x;return Point(d.x or d[1],d.y or d[2]) end;return geometry('Point',{x=coord(x),y=coord(y)},Point) end
Size=function(w,h) if type(w)=='table' then local d=values[w] or w;return Size(d.width or d.w or d[1],d.height or d.h or d[2]) end;return geometry('Size',{width=coord(w),height=coord(h)},Size) end
Rectangle=function(x,y,w,h) if type(x)=='table' then local d=values[x] or x;return Rectangle(d.x or d[1],d.y or d[2],d.width or d.w or d[3],d.height or d.h or d[4]) end;return geometry('Rectangle',{x=coord(x),y=coord(y),width=coord(w),height=coord(h)},Rectangle) end
local function unit(v,label) if type(v)~='number' or v~=v or v<0 or v>1 then error(label..' must be from 0 to 1') end;return v end
local function hue(v) if type(v)~='number' or v~=v or v<0 or v>360 then error('Hue must be from 0 to 360; out-of-range native hues are not supported') end;return v end
local function rgbHSV(h,s,v)
 local turn=(h%360)/60;local c=v*s;local x=c*(1-math.abs(turn%2-1));local m=v-c;local r,g,b
 if turn<1 then r,g,b=c,x,0 elseif turn<2 then r,g,b=x,c,0 elseif turn<3 then r,g,b=0,c,x elseif turn<4 then r,g,b=0,x,c elseif turn<5 then r,g,b=x,0,c else r,g,b=c,0,x end
 return math.floor((r+m)*255+.5),math.floor((g+m)*255+.5),math.floor((b+m)*255+.5)
end
local function calculate(d)
 local min,max=math.min(d.red,d.green,d.blue)/255,math.max(d.red,d.green,d.blue)/255;local delta=max-min;local h=0
 if delta>0 then if max==d.red/255 then h=60*((d.green-d.blue)/255/delta%6) elseif max==d.green/255 then h=60*((d.blue-d.red)/255/delta+2) else h=60*((d.red-d.green)/255/delta+4) end end
 local l=(min+max)/2;local hsvs=max==0 and 0 or delta/max;local hsls=delta==0 and 0 or delta/(1-math.abs(2*l-1))
 return (d._kind=='hsv' or d._kind=='hsl') and d._h or h,hsvs,max,hsls,l
end
local function refresh(d)
 if d._kind=='index' then local c=rpc('colorLookup',{index=d.index});d.red,d.green,d.blue,d.alpha=c[1],c[2],c[3],d._alphaOverride or c[4] end
end
local function components(d)
 refresh(d);local h,s,v,hs,hl=calculate(d)
 return {hsvHue=h,hsvSaturation=d._kind=='hsv' and d._s or s,hsvValue=d._kind=='hsv' and d._v or v,hslHue=h,hslSaturation=d._kind=='hsl' and d._s or hs,hslLightness=d._kind=='hsl' and d._l or hl}
end
local function convert(d,kind,h,s,n)
 h=hue(h);s=unit(s,'Saturation');n=unit(n,kind=='hsl' and 'Lightness' or 'Value')
 d._kind,d._h,d._s,d.index,d._alphaOverride=kind,hue(h),unit(s,'Saturation'),nil,nil
 if kind=='hsl' then d._l=unit(n,'Lightness');d._v=nil;local v=n+s*math.min(n,1-n);d.red,d.green,d.blue=rgbHSV(h,v==0 and 0 or 2*(1-n/v),v)
 else d._v=unit(n,'Value');d._l=nil;d.red,d.green,d.blue=rgbHSV(h,s,n) end
end
local colorAliases={r='red',g='green',b='blue',a='alpha'}
local function alias(d,key)
 key=colorAliases[key] or key
 if key=='hue' then return d._kind=='hsl' and 'hslHue' or 'hsvHue' elseif key=='saturation' then return d._kind=='hsl' and 'hslSaturation' or 'hsvSaturation' elseif key=='value' then return 'hsvValue' elseif key=='lightness' then return 'hslLightness' end
 return key
end
Color=function(input)
 local d
 if values[input] and values[input].red~=nil then d={};for k,v in pairs(values[input]) do d[k]=v end
 elseif type(input)=='number' then local s=rpc('appGet',{key='sprite'});local mode=s and s.colorMode or 0;if mode==2 then return Color{index=input} elseif mode==1 then return Color{gray=pixelColor.grayaV(input),alpha=pixelColor.grayaA(input)} end;d={red=pixelColor.rgbaR(input),green=pixelColor.rgbaG(input),blue=pixelColor.rgbaB(input),alpha=pixelColor.rgbaA(input),_kind='rgb'}
 else
  input=input or {};if type(input)~='table' then error('Color requires a table, packed pixel, or Color') end
  d={red=input.red or input.r or input.gray or 0,green=input.green or input.g or input.gray or 0,blue=input.blue or input.b or input.gray or 0,alpha=input.alpha or input.a or 255,_kind=input.gray~=nil and 'gray' or 'rgb'}
  if input.tile~=nil then error('Tile Color is not supported') end
  if input.index~=nil then d.index=uint(input.index,255);d._kind='index';refresh(d)
  elseif input.h~=nil or input.hue~=nil then local h=input.h or input.hue;local s=input.s or input.saturation or 0;local l=input.l or input.lightness;convert(d,l~=nil and 'hsl' or 'hsv',h,s,l or input.v or input.value or 0) end
 end
 d.red,d.green,d.blue,d.alpha=byte(d.red),byte(d.green),byte(d.blue),byte(d.alpha)
 local value={};values[value]=d
 return setmetatable(value,{__metatable='Color',
  __index=function(_,key)
   key=alias(d,key);refresh(d)
   if key=='red' or key=='green' or key=='blue' or key=='alpha' then return d[key] end
   if key=='index' then return d.index or rpc('colorFindIndex',{red=d.red,green=d.green,blue=d.blue,alpha=d.alpha}) end
   if key=='rgbaPixel' then return pixelColor.rgba(d.red,d.green,d.blue,d.alpha) end
   if key=='gray' then return math.floor((math.max(d.red,d.green,d.blue)+math.min(d.red,d.green,d.blue))/2) end
   if key=='grayPixel' then return pixelColor.graya(math.floor((math.max(d.red,d.green,d.blue)+math.min(d.red,d.green,d.blue))/2),d.alpha) end
   local c=components(d);if c[key]~=nil then return c[key] end;error('Unsupported Color.'..tostring(key))
  end,
  __newindex=function(_,key,v)
   key=alias(d,key);refresh(d)
   if key=='index' then local index=uint(v,255);local c=rpc('colorLookup',{index=index});d._kind,d.index,d._alphaOverride='index',index,nil;d.red,d.green,d.blue,d.alpha=c[1],c[2],c[3],c[4];return end
   if key=='alpha' then d.alpha=byte(v);if d._kind=='index' then d._alphaOverride=d.alpha end;return end
   if key=='red' or key=='green' or key=='blue' then d[key]=byte(v);d._kind,d.index='rgb',nil;return end
   if key=='gray' then local gray=byte(v);d.red,d.green,d.blue,d._kind,d.index=gray,gray,gray,'gray',nil;return end
   local c=components(d)
   if key=='hsvHue' or key=='hsvSaturation' or key=='hsvValue' then convert(d,'hsv',key=='hsvHue' and v or c.hsvHue,key=='hsvSaturation' and v or c.hsvSaturation,key=='hsvValue' and v or c.hsvValue);return end
   if key=='hslHue' or key=='hslSaturation' or key=='hslLightness' then convert(d,'hsl',key=='hslHue' and v or c.hslHue,key=='hslSaturation' and v or c.hslSaturation,key=='hslLightness' and v or c.hslLightness);return end
   error('Unsupported Color assignment: '..tostring(key))
  end,
 })
end
refreshColor=function(value) local d=values[value];if d and d.red~=nil then refresh(d) end end
`;
