-- Original fixture harness; no copied renderer implementation.
app.preferences.experimental.compose_groups=true
local listFile=assert(io.open(app.params.manifest,'r'));local cases=json.decode(listFile:read('*a'));listFile:close()
for _,case in ipairs(cases)do
 local s=assert(app.open(case.path));local image=Image(s.width,s.height,ColorMode.RGB);image:drawSprite(s,1)
 local out=assert(io.open(case.path..'.rgba','wb'));out:write(image.bytes);out:close();s:close()
end
print('captured',#cases)
