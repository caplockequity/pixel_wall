-- Original deterministic numerical probes; expected pixels come from Aseprite.
local modes={"NORMAL","MULTIPLY","SCREEN","OVERLAY","DARKEN","LIGHTEN","COLOR_DODGE","COLOR_BURN","HARD_LIGHT","SOFT_LIGHT","DIFFERENCE","EXCLUSION","HSL_HUE","HSL_SATURATION","HSL_COLOR","HSL_LUMINOSITY","ADDITION","SUBTRACT","DIVIDE"}
local seed=732919
local function byte() seed=(1664525*seed+1013904223)%4294967296;return (seed>>16)&255 end
local inputs={}
for i=1,256 do
  table.insert(inputs,{backdrop={byte(),byte(),byte(),byte()},source={byte(),byte(),byte(),byte()},opacity=byte()})
end
local result={aseprite=tostring(app.version),api=app.apiVersion,inputs=inputs,modes={}}
for _,mode in ipairs(modes) do
  local samples={}
  for _,input in ipairs(inputs) do
    local b,s=input.backdrop,input.source
    local target=Image(1,1,ColorMode.RGB);target:drawPixel(0,0,app.pixelColor.rgba(b[1],b[2],b[3],b[4]))
    local source=Image(1,1,ColorMode.RGB);source:drawPixel(0,0,app.pixelColor.rgba(s[1],s[2],s[3],s[4]))
    target:drawImage(source,Point(0,0),input.opacity,BlendMode[mode])
    local out={string.byte(target.bytes,1,4)}
    target:drawPixel(0,0,app.pixelColor.rgba(b[1],b[2],b[3],255))
    source:drawPixel(0,0,app.pixelColor.rgba(s[1],s[2],s[3],255))
    target:drawImage(source,Point(0,0),255,BlendMode[mode])
    table.insert(samples,{rgba=out,opaque={string.byte(target.bytes,1,4)}})
  end
  result.modes[string.lower(mode)]=samples
end
local f=assert(io.open(app.params.output,"w"));f:write(json.encode(result));f:close()
