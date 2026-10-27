-- Run after agent-river-commands.json on the 600 x 350 tutorial project.
-- Keep per-pixel work small: this detached 16 x 16 image has only 256 cells.
app.transaction("Add a small reed sprite", function()
  local image = Image(16, 16)
  local green = Color{r=137, g=181, b=89, a=255}
  for y = 2, 14 do
    image:drawPixel(7, y, green)
    if y > 6 then image:drawPixel(11, y, green) end
    if y > 9 then image:drawPixel(3, y, green) end
  end
  local layer = app.sprite:newLayer()
  layer.name = "Lua reed detail"
  app.sprite:newCel(layer, app.sprite.frames[1], image, Point(180, 180))
end)
print("Reed detail added as one undoable edit")
