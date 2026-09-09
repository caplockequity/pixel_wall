-- Original CC0 frame colors identify native exported traversal order.
local d=app.params.directory
for _,direction in ipairs({'forward','reverse','pingpong','pingpong_reverse'}) do for repeatCount=0,3 do
 local s=Sprite(1,1);for i=1,5 do if i>1 then s:newEmptyFrame() end;local image=Image(1,1);image:drawPixel(0,0,app.pixelColor.rgba(i*40,0,0,255));s:newCel(s.layers[1],i,image);s.frames[i].duration=.01*(i+5) end
 local t=s:newTag(2,4);t.name='clip';t.aniDir=direction=='reverse' and AniDir.REVERSE or direction=='pingpong' and AniDir.PING_PONG or direction=='pingpong_reverse' and AniDir.PING_PONG_REVERSE or AniDir.FORWARD;t.repeats=repeatCount
 s:saveAs(d..'/'..direction..'-'..repeatCount..'.aseprite');s:close()
end end
