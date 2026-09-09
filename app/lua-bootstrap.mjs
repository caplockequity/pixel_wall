import { LUA_PLUGIN_BOOTSTRAP } from './lua-plugin-bootstrap.mjs';
import { LUA_DIALOG_BOOTSTRAP } from './lua-dialog-bootstrap.mjs';
import { LUA_VALUE_TYPES } from './lua-value-types.mjs';
/** Lua 5.4 compatibility objects; evaluated by the real VM, never parsed as JavaScript. */
export const LUA_BOOTSTRAP = String.raw`
local bridge, source, instructionLimit = __pixelwallRpc, __pixelwallSource, __pixelwallInstructions
__pixelwallRpc, __pixelwallSource, __pixelwallInstructions = nil, nil, nil
local dialogBridge,dialogEnabled=__pixelwallDialog,__pixelwallDialogEnabled
__pixelwallDialog,__pixelwallDialogEnabled=nil,nil
local pluginConfig,pluginBridge,pluginDone=__pixelwallPluginConfig,__pixelwallPluginChoice,__pixelwallPluginDone
__pixelwallPluginConfig,__pixelwallPluginChoice,__pixelwallPluginDone=nil,nil,nil
local handles, values, cache = {}, {}, {}
local refreshColor
local function jsonEncode(value, seen, depth)
  depth = (depth or 0) + 1
  if depth > 48 then error('Lua argument nesting limit exceeded') end
  local kind = type(value)
  if kind == 'nil' then return 'null' end
  if kind == 'boolean' then return value and 'true' or 'false' end
  if kind == 'number' then if value ~= value or value == math.huge or value == -math.huge then error('JSON numbers must be finite') end return tostring(value) end
  if kind == 'string' then
    return '"' .. value:gsub('[%z\1-\31\\"]', function(c)
      local escapes = { ['"']='\\"', ['\\']='\\\\', ['\n']='\\n', ['\r']='\\r', ['\t']='\\t' }
      return escapes[c] or string.format('\\u%04x', string.byte(c))
    end) .. '"'
  end
  if kind ~= 'table' then error('Lua API arguments must be plain values') end
  if refreshColor and values[value] then refreshColor(value) end
  value = handles[value] or values[value] or value
  seen = seen or {}; if seen[value] then error('Circular Lua API argument') end; seen[value] = true
  local count, maximum, array = 0, 0, true
  for k in pairs(value) do count=count+1; if type(k) ~= 'number' or k%1~=0 or k<1 then array=false else maximum=math.max(maximum,k) end end
  array = array and count == maximum and count > 0
  local parts = {}
  if array then for n=1,count do parts[n]=jsonEncode(value[n],seen,depth) end
  else for k,v in pairs(value) do if type(k)~='string' then error('Mixed Lua tables are not supported as API arguments') end; parts[#parts+1]=jsonEncode(k,seen,depth)..':'..jsonEncode(v,seen,depth) end end
  seen[value] = nil
  return (array and '[' or '{') .. table.concat(parts,',') .. (array and ']' or '}')
end
local function jsonDecode(text)
  local pos, length = 1, #text
  local function space() local _, e=text:find('^%s*',pos); pos=(e or pos-1)+1 end
  local parse
  local function str()
    pos=pos+1; local out={}
    while pos<=length do
      local c=text:sub(pos,pos); pos=pos+1
      if c=='"' then return table.concat(out) end
      if c=='\\' then
        c=text:sub(pos,pos); pos=pos+1
        if c=='u' then
          local cp=tonumber(text:sub(pos,pos+3),16); if not cp then error('Invalid bridge JSON') end; pos=pos+4
          if cp>=0xd800 and cp<=0xdbff and text:sub(pos,pos+1)=='\\u' then local low=tonumber(text:sub(pos+2,pos+5),16); if low and low>=0xdc00 and low<=0xdfff then cp=0x10000+(cp-0xd800)*1024+low-0xdc00; pos=pos+6 end end
          out[#out+1]=utf8.char(cp)
        else local escapes={ ['"']='"', ['\\']='\\', ['/']='/', b='\b', f='\f', n='\n', r='\r', t='\t' }; if not escapes[c] then error('Invalid bridge escape') end; out[#out+1]=escapes[c] end
      else out[#out+1]=c end
    end
    error('Unterminated bridge JSON string')
  end
  parse=function(depth)
    if depth>48 then error('Bridge JSON nesting exceeded') end
    space(); local c=text:sub(pos,pos)
    if c=='"' then return str() end
    if c=='{' or c=='[' then
      local array=c=='['; local closing=array and ']' or '}'; pos=pos+1; space(); local out={}
      if text:sub(pos,pos)==closing then pos=pos+1; return out end
      while true do
        local key
        if array then key=#out+1 else space(); if text:sub(pos,pos)~='"' then error('Invalid bridge JSON key') end; key=str(); space(); if text:sub(pos,pos)~=':' then error('Invalid bridge JSON colon') end; pos=pos+1 end
        out[key]=parse(depth+1); space(); local next=text:sub(pos,pos); pos=pos+1
        if next==closing then return out end
        if next~=',' then error('Invalid bridge JSON separator') end
      end
    end
    if text:sub(pos,pos+3)=='true' then pos=pos+4; return true end
    if text:sub(pos,pos+4)=='false' then pos=pos+5; return false end
    if text:sub(pos,pos+3)=='null' then pos=pos+4; return nil end
    local number=text:match('^-?%d+%.?%d*[eE]?[+-]?%d*',pos)
    if not number then error('Invalid bridge JSON value') end; pos=pos+#number; return assert(tonumber(number))
  end
  local result=parse(0); space(); if pos<=length then error('Trailing bridge JSON') end; return result
end
local wrap
local function rpc(op,data)
  local reply=jsonDecode(bridge(op,jsonEncode(data or {})))
  if not reply.ok then error(reply.error,3) end
  return wrap(reply.value)
end
local function byte(v) v=v or 0; if type(v)~='number' or v%1~=0 or v<0 or v>255 then error('Color channel must be an integer from 0 to 255') end; return v end
local function uint(v,max) if type(v)~='number' or v%1~=0 or v<0 or v>max then error('Invalid packed pixel') end return v end
local pixelColor={
  rgba=function(r,g,b,a) return byte(r) | (byte(g)<<8) | (byte(b)<<16) | (byte(a==nil and 255 or a)<<24) end,
  rgbaR=function(p) return uint(p,0xffffffff)&255 end, rgbaG=function(p) return (uint(p,0xffffffff)>>8)&255 end,
  rgbaB=function(p) return (uint(p,0xffffffff)>>16)&255 end, rgbaA=function(p) return (uint(p,0xffffffff)>>24)&255 end,
  graya=function(g,a) return byte(g)|(byte(a==nil and 255 or a)<<8) end,
  grayaV=function(p) return uint(p,65535)&255 end, grayaA=function(p) return (uint(p,65535)>>8)&255 end,
}
local Color, Point, Size, Rectangle, Image, Sprite, Palette, Selection, Grid, ColorSpace, ImageSpec
${LUA_VALUE_TYPES}
local function gridValue(width,height,x,y)
  x=x or 0;y=y or 0;local object={};values[object]={__value='Grid',width=width,height=height,x=x,y=y}
  return setmetatable(object,{__metatable='Grid',__index=function(_,key) if key=='origin' then return Point(x,y) end;if key=='tileSize' then return Size(width,height) end;error('Unsupported Grid.'..tostring(key)) end,__newindex=function() error('Grid properties are read-only') end})
end
Grid=function(other) if other==nil then return gridValue(16,16) end;local value=values[other];if not value or value.__value~='Grid' then error('Grid expects another Grid or no arguments') end;return gridValue(value.width,value.height,value.x,value.y) end
local methods={
 Sprite={newLayer=true,newGroup=true,deleteLayer=true,newFrame=true,newEmptyFrame=true,deleteFrame=true,newCel=true,deleteCel=true,setPalette=true,resize=true,newTag=true,deleteTag=true,newSlice=true,deleteSlice=true,newTileset=true,deleteTileset=true,newTile=true,deleteTile=true,assignColorSpace=true,convertColorSpace=true},
 Tileset={tile=true,getTile=true},Tile={},
 Layer={cel=true}, Frame={}, Cel={}, Tag={}, Slice={}, Properties={},
 Selection={deselect=true,select=true,selectAll=true,add=true,subtract=true,intersect=true,contains=true},
 Range={contains=true,containsColor=true,clear=true},
 Image={clone=true,drawPixel=true,putPixel=true,getPixel=true,clear=true,drawImage=true,putImage=true,isEmpty=true,isPlain=true,isEqual=true,resize=true,flip=true,drawSprite=true,putSprite=true,shrinkBounds=true},
 Palette={getColor=true,setColor=true,resize=true},
}
wrap=function(value)
  if type(value)~='table' then return value end
  if value.__value=='Grid' then return gridValue(value.width,value.height,value.x,value.y) end
  if value.__value=='PlainData' then return value.value end
  if value.__value=='Color' then value.__value=nil; return Color(value) end
  if value.__value=='Point' then return Point(value) end
  if value.__value=='Size' then return Size(value) end
  if value.__value=='Rectangle' then return Rectangle(value) end
  if not value.__kind then for k,v in pairs(value) do value[k]=wrap(v) end; return value end
  local key=value.__kind..':'..value.id
  if cache[key] then return cache[key] end
  local object={}; handles[object]=value; cache[key]=object
  return setmetatable(object,{__metatable=value.__kind,
    __index=function(self,property)
      if methods[value.__kind] and methods[value.__kind][property] then return function(_,...) return rpc('method',{target=self,name=property,args={...}}) end end
      if value.__kind=='Image' and property=='bytes' then
        local length=self.rowStride*self.height;local chunks={}
        for offset=0,length-1,4096 do local bytes=rpc('imageBytesGet',{target=self,start=offset,count=math.min(4096,length-offset)});chunks[#chunks+1]=string.char(table.unpack(bytes)) end
        return table.concat(chunks)
      end
      if value.__kind=='Image' and property=='pixels' then
        return function(_,rect)
          rect=rect or Rectangle(0,0,self.width,self.height); local x0,y0=math.max(0,rect.x),math.max(0,rect.y); local right,bottom=math.min(self.width,rect.x+rect.width),math.min(self.height,rect.y+rect.height); local x,y=x0-1,y0
          return function()
            x=x+1; if x>=right then x=x0; y=y+1 end; if y>=bottom or right<=x0 then return nil end
            local px,py=x,y
            return setmetatable({x=px,y=py},{__metatable='Pixel',__call=function(_,color) if color==nil then return self:getPixel(px,py) end; self:drawPixel(px,py,color) end})
          end
        end
      end
      return rpc('get',{target=self,key=property})
    end,
    __newindex=function(self,property,v)
      if value.__kind=='ColorSpace' and property=='name' then
        if type(v)~='number' and type(v)~='string' then return end
        v=tostring(v):match('^[^%z]*')
      end
      if value.__kind=='Image' and property=='bytes' then
        if type(v)~='string' then error('Image.bytes requires a byte string') end
        local token=rpc('imageBytesBegin',{target=self,size=#v})
        local ok,err=pcall(function()
          for offset=1,#v,4096 do rpc('imageBytesAppend',{token=token,bytes={string.byte(v,offset,math.min(offset+4095,#v))}}) end
          rpc('imageBytesCommit',{token=token})
        end)
        if not ok then pcall(rpc,'imageBytesCancel',{token=token});error(err,2) end
        return
      end
      rpc('set',{target=self,key=property,value=v})
    end,
    __eq=function(self,other) if value.__kind=='ImageSpec' and handles[other] and handles[other].__kind=='ImageSpec' then return rpc('imageSpecEqual',{left=self,right=other}) end;if value.__kind~='ColorSpace' or not handles[other] or handles[other].__kind~='ColorSpace' then return rawequal(self,other) end;return rpc('colorSpaceEqual',{left=self,right=other}) end,
    __pairs=function(self) if value.__kind~='Properties' then error('pairs is only supported for Properties') end; return next,rpc('method',{target=self,name='entries',args={}}),nil end,
    __call=function(self,namespace,properties) if value.__kind~='Properties' then error('Only Properties can be called') end; return rpc('method',{target=self,name='namespace',args={namespace,properties}}) end,
    __len=function(self) if value.__kind=='Properties' then local count=0; for _ in pairs(self) do count=count+1 end; return count end; if value.__kind~='Palette' and value.__kind~='Tileset' then error('Length is only supported for Palette, Tileset or Properties') end return rpc('get',{target=self,key='size'}) end,
  })
end
Image=function(width,height,mode)
  if handles[width] then if mode~=nil then error('Unsupported Image copy arguments') end;return rpc('imageNew',{source=width,rectangle=height}) end
  if type(width)=='table' then if width.fromFile then error('Image file access is unavailable') end; return rpc('imageNew',width) end
  return rpc('imageNew',{width=width,height=height,colorMode=mode or 0})
end
Sprite=function(width,height,mode)
  if handles[width] and handles[width].__kind=='ImageSpec' then if height~=nil or mode~=nil then error('Sprite(spec) accepts one specification') end;return rpc('spriteNew',{spec=width}) end
  if type(width)=='table' then error('Sprite constructor requires dimensions or an ImageSpec') end
  return rpc('spriteNew',{width=width,height=height,colorMode=mode or 0})
end
Palette=function(size) if handles[size] then return rpc('paletteNew',{source=size}) end; if type(size)=='table' then if size.fromFile then error('Palette file access is unavailable') end; size=size.size end; return rpc('paletteNew',{size=size or 256}) end
Selection=function(rectangle) if handles[rectangle] then error('Selection constructor requires a Rectangle; use add to copy a selection') end; return rpc('selectionNew',{rectangle=rectangle}) end
ColorSpace=function(value)
  if handles[value] then return rpc('colorSpaceNew',{source=value}) end
  if type(value)=='table' and value.fromFile~=nil then error('ColorSpace.fromFile requires file access, which is unavailable to scripts') end
  return rpc('colorSpaceNew',{srgb=type(value)=='table' and not not value.sRGB})
end
ImageSpec=function(value)
  if handles[value] then return rpc('imageSpecNew',{source=value}) end
  if type(value)=='table' then local fields={};for _,key in ipairs{'width','height','colorMode','transparentColor'} do fields[key]=value[key] end;return rpc('imageSpecNew',{fields=fields}) end
  return rpc('imageSpecNew',{})
end
local initialColors=rpc('colorsGet')
local function colorFromRGBA(rgba) return Color{red=rgba[1],green=rgba[2],blue=rgba[3],alpha=rgba[4]} end
local function colorRGBA(color) return {color.red,color.green,color.blue,color.alpha} end
local fg,bg=colorFromRGBA(initialColors.fgColor),colorFromRGBA(initialColors.bgColor)
-- Aseprite getters return detached Color values. Preserve a selected index
-- without resolving it again against a different active sprite's palette.
local function copyColor(color) return Color(color) end

${LUA_DIALOG_BOOTSTRAP}
local appMethods={
  refresh=function() end,
  useTool=function(options) local copy={}; for k,v in pairs(options) do copy[k]=v end; if copy.color==nil then copy.color=fg end; return rpc('useTool',copy) end,
  transaction=function(label,callback)
    if type(label)=='function' then callback,label=label,'Lua transaction' end
    if type(callback)~='function' then error('app.transaction requires a function') end
    local previousFg,previousBg=fg,bg
    local function restoreColors() fg,bg=previousFg,previousBg end
    rpc('begin',{label=label}); local result=table.pack(pcall(callback))
    if result[1] then
      local ok,err=pcall(rpc,'commit',{})
      if not ok then pcall(rpc,'rollback',{}); restoreColors(); error(err,2) end
      return table.unpack(result,2,result.n)
    end
    local ok,err=pcall(rpc,'rollback',{}); restoreColors()
    if not ok then error(err,2) end
    error(result[2],2)
  end,
}
local command=setmetatable({},{__metatable='app.command',__index=function(_,name) return function(options) return rpc('command',{name=name,options=options or {}}) end end})
local app=setmetatable({},{__metatable='app',__index=function(_,key)
  if key=='isUIAvailable' then return dialogEnabled elseif key=='command' then return command elseif key=='pixelColor' then return pixelColor elseif key=='fgColor' then return copyColor(fg) elseif key=='bgColor' then return copyColor(bg) elseif appMethods[key] then return appMethods[key] end
  return rpc('appGet',{key=key})
end,__newindex=function(_,key,value)
  if key=='fgColor' then fg=Color(value) elseif key=='bgColor' then bg=Color(value) else rpc('appSet',{key=key,value=value}) end
end})
local function safeLibrary(library,deny) local result={}; for k,v in pairs(library) do if not deny or not deny[k] then result[k]=v end end return result end
local env={assert=assert,error=error,ipairs=ipairs,pairs=pairs,next=next,pcall=pcall,xpcall=xpcall,select=select,tonumber=tonumber,tostring=tostring,type=type,setmetatable=setmetatable,
  math=safeLibrary(math),table=safeLibrary(table),string=safeLibrary(string,{dump=true}),utf8=safeLibrary(utf8),
  app=app,Dialog=Dialog,Sprite=Sprite,Image=Image,Color=Color,Point=Point,Size=Size,Rectangle=Rectangle,Grid=Grid,Palette=Palette,Selection=Selection,ColorSpace=ColorSpace,ImageSpec=ImageSpec,
  AniDir={FORWARD=0,REVERSE=1,PING_PONG=2,PING_PONG_REVERSE=3},RangeType={EMPTY=0,CELS=1,FRAMES=2,LAYERS=4},
  FlipType={HORIZONTAL=0,VERTICAL=1},ColorMode={RGB=0,GRAY=1,INDEXED=2,TILEMAP=4},BlendMode={NORMAL='normal',SRC='src',MULTIPLY='multiply',SCREEN='screen',OVERLAY='overlay',DARKEN='darken',LIGHTEN='lighten',COLOR_DODGE='color-dodge',COLOR_BURN='color-burn',HARD_LIGHT='hard-light',SOFT_LIGHT='soft-light',DIFFERENCE='difference',EXCLUSION='exclusion',HSL_HUE='hue',HSL_SATURATION='saturation',HSL_COLOR='color',HSL_LUMINOSITY='luminosity',ADDITION='addition',SUBTRACT='subtract',DIVIDE='divide'},
  _VERSION=_VERSION,
  print=function(...) local parts={}; for i=1,select('#',...) do parts[i]=tostring(select(i,...)) end; rpc('print',{text=table.concat(parts,'\t')}) end,
}
env._G=env
${LUA_PLUGIN_BOOTSTRAP}
local instructions,exceeded=0,false
-- The script cannot access debug/coroutines or replace this hook. Parent worker termination is the second limit.
debug.sethook(function() instructions=instructions+1000; if instructions>instructionLimit then exceeded=true; error('Lua instruction budget exceeded',0) end end,'',1000)
local chunk,err=load(source,'@pixelwall-script','t',env)
if not chunk then error(err,0) end
chunk()
if pluginConfig~='' then runPlugin(env) end
debug.sethook()
if exceeded then error('Lua instruction budget exceeded',0) end
rpc('colorsSet',{fgColor=colorRGBA(fg),bgColor=colorRGBA(bg)})
return true
`;
