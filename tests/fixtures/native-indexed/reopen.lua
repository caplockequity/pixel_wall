-- Original independent check of the application-exported files in the native host.
local dir=app.params.output
local manifest=assert(io.open(dir..'/manifest.json','r'));local jobs=json.decode(manifest:read('*a'));manifest:close()
for _,job in ipairs(jobs) do
 local s=assert(app.open(dir..'/'..job.name..'-pixelwall.aseprite'))
 for i=1,#s.frames do
  local im=Image(s.width,s.height,ColorMode.RGB);im:drawSprite(s,i)
  local file=assert(io.open(dir..'/'..job.name..'-pixelwall-'..i..'.rgba','wb'));file:write(im.bytes);file:close()
 end
 s:close()
end
print('reopened',#jobs)
