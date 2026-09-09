-- Original CC0 numerical sprites for ordered CLI option tests.
local directory=assert(app.params.directory)
for specimen=1,2 do
  local sprite=Sprite(3,2,ColorMode.RGB)
  sprite.layers[1].name='base'
  local hat=sprite:newLayer();hat.name='hat'
  local hidden=sprite:newLayer();hidden.name='hidden';hidden.isVisible=false
  for frame=1,3 do
    if frame>1 then sprite:newEmptyFrame() end
    local baseImage,hatImage,hiddenImage=Image(3,2),Image(3,2),Image(3,2)
    baseImage:drawPixel(0,0,app.pixelColor.rgba(30*specimen,50*frame,10,255))
    baseImage:drawPixel(1,1,app.pixelColor.rgba(10,30*specimen,50*frame,255))
    hatImage:drawPixel(2,0,app.pixelColor.rgba(200,40*specimen,20*frame,255))
    hiddenImage:drawPixel(2,1,app.pixelColor.rgba(20*frame,200,40*specimen,255))
    sprite:newCel(sprite.layers[1],frame,baseImage)
    sprite:newCel(hat,frame,hatImage)
    sprite:newCel(hidden,frame,hiddenImage)
    sprite.frames[frame].duration=frame/10
  end
  local early=sprite:newTag(1,2);early.name='early'
  local late=sprite:newTag(3,3);late.name='late'
  local left=sprite:newSlice(Rectangle(0,0,1,2));left.name='left'
  local right=sprite:newSlice(Rectangle(2,0,1,2));right.name='right'
  sprite:saveAs(directory..'/'..(specimen==1 and 'alpha' or 'beta')..'.aseprite')
  sprite:close()
end
