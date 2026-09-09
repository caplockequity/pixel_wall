local s=Sprite(5,5)
local out={}
local function snap(label)
 local r=app.range
 local x={label=label,type=r.type,empty=r.isEmpty,layers={},frames={},cels=#r.cels,images=#r.images}
 for _,v in ipairs(r.layers) do table.insert(x.layers,v.name) end
 for _,v in ipairs(r.frames) do table.insert(x.frames,v.frameNumber) end
 table.insert(out,x)
end
s.layers[1].name='one';local l=s:newLayer();l.name='two';s:newEmptyFrame();s:newEmptyFrame();app.layer=s.layers[1];app.frame=1;snap('empty')
app.range.frames={3,1};snap('frames')
app.range.layers={l};snap('layers_after_frames')
app.range.frames={2,3};snap('frames_after_layers')
app.range:clear();snap('clear')
local tag=s:newTag(1,3)
local t={name=tag.name,dir=tag.aniDir,repeats=tag.repeats,frames=tag.frames,color=tag.color.rgbaPixel}
local ok,err=pcall(function()tag.fromFrame=2 end);t.setFrom=ok;t.from=tag.fromFrame.frameNumber; table.insert(out,t)
local slice=s:newSlice(Rectangle(1,1,2,2));slice.name='moving';app.frame=3;slice.bounds=Rectangle(2,0,3,1)
for i=1,3 do app.frame=i;table.insert(out,{frame=i,bounds={slice.bounds.x,slice.bounds.y,slice.bounds.width,slice.bounds.height}}) end
s.properties.a=1;s.properties.vec={1,'x',true};s.properties('pub/ext',{hello='yes'});s.layers[1].data='hi';s.layers[1].color=Color{r=2,g=3,b=4,a=123}
s:saveAs(app.params.output..'.aseprite')
local f=assert(io.open(app.params.output..'.json','w'));f:write(json.encode(out));f:close()
