local s=Sprite(2,2)
local bottom=s.layers[1]
bottom.name='Bottom'
local middle=s:newLayer();middle.name='Middle'
local top=s:newLayer();top.name='Top'
local layers={bottom,middle,top}
local colors={Color{r=230,g=30,b=40},Color{r=20,g=210,b=60,a=128},Color{r=40,g=60,b=240,a=192}}
for at,layer in ipairs(layers) do
 local image=Image(2,2)
 image:clear(colors[at])
 s:newCel(layer,1,image)
end
local cases={{0,0,0},{3,0,0},{1,0,0},{2,0,0},{0,0,-1},{0,0,-2},{0,0,-3},{3,-1,-2},{-32768,32767,0},{32767,-32768,1}}
for _,values in ipairs(cases) do
 for at,layer in ipairs(layers) do layer:cel(1).zIndex=values[at] end
 local image=Image(2,2);image:drawSprite(s,1)
 print(table.concat(values,','),image:getPixel(0,0))
end
