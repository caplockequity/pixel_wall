-- Original CC0: composite resized sprite in its profile, then convert to sRGB.
local sprite=app.sprite
for i,frame in ipairs(sprite.frames) do
 local flat=Image(sprite.spec);flat:drawSprite(sprite,frame)
 local out=Sprite(sprite.width,sprite.height,ColorMode.RGB)
 if sprite.colorMode~=ColorMode.RGB then
  -- Native save-as applies the frame palette/gray mode exactly.
  app.sprite=sprite;app.frame=frame
  app.command.SaveFileCopyAs{filename=app.params.prefix..'-'..i..'.png',ui=false,fromFrame=i,toFrame=i}
 else
  out:newCel(out.layers[1],1,flat);out:assignColorSpace(sprite.colorSpace);out:convertColorSpace(ColorSpace{sRGB=true});out:saveAs(app.params.prefix..'-'..i..'.png')
 end
 out:close()
end
