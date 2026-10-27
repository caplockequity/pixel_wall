-- Small bounded pass: one detached reed detail, kept separate from the base scene.
app.transaction("Add reed detail", function()
  local image = Image(8, 8)
  local green = Color{r=165, g=197, b=104, a=255}
  for y = 2, 7 do image:drawPixel(3, y, green); if y > 4 then image:drawPixel(5, y, green) end end
  local layer = app.sprite:newLayer(); layer.name = "Lua reed detail"
  app.sprite:newCel(layer, app.sprite.frames[1], image, Point(59, 46))
end)
print("Bounded reed detail complete")
