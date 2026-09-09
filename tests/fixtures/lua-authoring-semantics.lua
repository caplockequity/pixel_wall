local s=Sprite(5,5)
assert(#s.tags==0 and #s.slices==0)
s.layers[1].name='one'
local two=s:newLayer();two.name='two'
s:newEmptyFrame();s:newEmptyFrame()
app.layer=s.layers[1];app.frame=1
assert(app.range.isEmpty and app.range.type==RangeType.EMPTY)
assert(#app.range.frames==1 and app.range.frames[1].frameNumber==1)
app.range.frames={3,1}
assert(app.range.type==RangeType.FRAMES and app.range.frames[1].frameNumber==1)
app.range.layers={two}
assert(app.range.type==RangeType.LAYERS and #app.range.frames==2)
app.range:clear()
local tag=s:newTag(1,3);tag.name='idle';tag.fromFrame=2;tag.aniDir=AniDir.PING_PONG;tag.repeats=2
assert(tag.frames==2 and tag.fromFrame.frameNumber==2)
tag.data='animation';tag.color=Color{r=3,g=7,b=11,a=123}
local slice=s:newSlice(Rectangle(1,1,2,2));slice.name='face'
app.frame=3;slice.bounds=Rectangle(2,0,3,1);slice.pivot=Point(1,0);slice.center=Rectangle(1,0,1,1)
app.frame=1;assert(slice.bounds.x==2 and slice.bounds.width==3)
local a=Selection(Rectangle(-1,-1,3,3));s.selection=a;a:deselect()
assert(not s.selection.isEmpty and s.selection:contains(0,0))
s.selection:subtract(Rectangle(0,0,1,1));assert(not s.selection:contains(0,0))
s.selection.origin=Point(2,2);assert(s.selection.bounds.x==2)
local clone=Selection();clone:add(s.selection);s.selection:deselect();assert(not clone.isEmpty)
s.properties.count=7;s.properties.vector={1,'two',true};s.properties.nested={value=1.25}
s.properties('test/plugin',{enabled=true,label='extension'})
s.properties={count=9}
assert(s.properties.vector==nil and s.properties('test/plugin').enabled)
s.properties.count=nil;assert(s.properties.count==nil)
s.properties.count=11
s.layers[1].data='layer text';s.layers[1].color=Color{r=9,g=8,b=7,a=100};s.layers[1].properties.role='body'
s.cels[1].data='cel text';s.cels[1].properties.cost=2.5
slice.data='slice text';slice.properties.note='face';tag.properties.speed=3
print(tag.name,tag.fromFrame.frameNumber,tag.toFrame.frameNumber,tag.repeats,tag.color.rgbaPixel)
print(slice.name,slice.bounds.x,slice.bounds.width,slice.pivot.x,slice.center.width)
print(s.properties.count,s.properties('test/plugin').label,s.layers[1].properties.role,s.cels[1].properties.cost)
