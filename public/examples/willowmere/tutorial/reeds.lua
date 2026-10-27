-- Bounded PixelWall Lua detail: one detached 16x16 reed clump.
-- Run only after the command manifest has created the Riverbank project.
app.transaction("Add a small reed sprite", function()
  local image = Image(16, 16)
  local green = Color{r=120, g=165, b=99, a=255}
  local light = Color{r=174, g=192, b=132, a=255}
  for y = 2, 14 do
    image:drawPixel(7, y, green)
    if y > 6 then image:drawPixel(11, y, green) end
    if y > 9 then image:drawPixel(3, y, light) end
  end
  local layer = app.sprite:newLayer()
  layer.name = "Lua reed detail"
  for i = 1, 12 do
    app.sprite:newCel(layer, app.sprite.frames[i], image, Point(93, 47))
  end
end)
print("Reed detail added as one undoable edit")
