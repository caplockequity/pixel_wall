-- Original native scaling fixture. Group composition is explicit and batch-local.
app.preferences.experimental.compose_groups=true
local f=assert(io.open(app.params.manifest,'r'));local cases=json.decode(f:read('*a'));f:close()
local count=0
for _,case in ipairs(cases)do
 if case.scenario=='normal' or case.scenario=='cel-zero' or case.scenario=='group-half' or case.scenario=='clip-negative' then
  for _,scale in ipairs{0.5,0.75,1.5,2.25}do
   local s=assert(app.open(case.path));app.command.SpriteSize{scale=scale,ui=false}
   local image=Image(s.width,s.height,ColorMode.RGB);image:drawSprite(s,1)
   local out=assert(io.open(case.path..'.'..scale..'.rgba','wb'));out:write(image.bytes);out:close();s:close();count=count+1
  end
 end
end
print('scaled',count)
