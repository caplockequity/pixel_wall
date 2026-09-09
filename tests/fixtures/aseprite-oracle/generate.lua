-- Original synthetic artwork/fixtures authored for the PixelWall interoperability audit.
-- This file contains no Aseprite implementation code or third-party artwork.
local modes = {
  "NORMAL", "MULTIPLY", "SCREEN", "OVERLAY", "DARKEN", "LIGHTEN",
  "COLOR_DODGE", "COLOR_BURN", "HARD_LIGHT", "SOFT_LIGHT", "DIFFERENCE",
  "EXCLUSION", "HSL_HUE", "HSL_SATURATION", "HSL_COLOR", "HSL_LUMINOSITY",
  "ADDITION", "SUBTRACT", "DIVIDE"
}
local out = app.params.output
local function makeImage(top)
  local image=Image(5,5,ColorMode.RGB)
  local alphas={0,64,128,192,255}
  for y=0,4 do for x=0,4 do
    local a=alphas[top and (x+1) or (y+1)]
    local color=top and Color{r=(x*61+y*7+23)%256,g=(x*13+y*53+87)%256,b=(x*43+y*29+131)%256,a=a}
      or Color{r=(x*19+y*67+97)%256,g=(x*47+y*31+17)%256,b=(x*7+y*71+211)%256,a=a}
    image:drawPixel(x,y,color.rgbaPixel)
  end end
  return image
end
for _, mode in ipairs(modes) do
  local sprite=Sprite(5,5,ColorMode.RGB)
  local bottom=sprite.layers[1]; bottom.name="Bottom"
  sprite:newCel(bottom,1,makeImage(false),Point(0,0))
  local top=sprite:newLayer();top.name="Top";top.blendMode=assert(BlendMode[mode],mode)
  top.opacity=173
  local cel=sprite:newCel(top,1,makeImage(true),Point(0,0));cel.opacity=181
  sprite:saveAs(out .. "/audit-blend-" .. string.lower(mode) .. ".aseprite")
  sprite:close()
end
local sprite=Sprite(5,5,ColorMode.RGB)
local bottom=sprite.layers[1];bottom.name="Backdrop"
sprite:newCel(bottom,1,makeImage(false),Point(0,0))
local group=sprite:newGroup();group.name="Translucent group";group.opacity=139;group.blendMode=BlendMode.SCREEN
local one=sprite:newLayer();one.name="Within group";one.parent=group;one.opacity=191
sprite:newCel(one,1,makeImage(true),Point(0,0))
sprite:saveAs(out .. "/audit-group-opacity.aseprite")
sprite:close()
local wide=Sprite(4096,1,ColorMode.RGB)
local strip=Image(4096,1,ColorMode.RGB)
strip:drawPixel(4095,0,Color{r=255,g=0,b=255,a=255}.rgbaPixel)
wide:newCel(wide.layers[1],1,strip,Point(0,0))
wide:saveAs(out .. "/audit-wide-document.aseprite")
wide:close()
