local s=Sprite(2,2,ColorMode.RGB)
app.fgColor=Color{r=10,g=20,b=30,a=40}
app.bgColor=Color{r=50,g=60,b=70,a=80}
local function report(name)
  local f,b=app.fgColor,app.bgColor
  print(name,f.red,f.green,f.blue,f.alpha,b.red,b.green,b.blue,b.alpha)
end
report('assigned')
local detached=app.fgColor; detached.red=90
report('local-copy-edit')
app.fgColor.green=100
report('member-edit')
local ok=pcall(function() app.transaction(function()
  app.fgColor=Color{r=110,g=120,b=130,a=140}
  app.bgColor=Color{r=150,g=160,b=170,a=180}
  error('rollback')
end) end)
assert(not ok)
report('failed-transaction')
local i=Sprite(2,2,ColorMode.INDEXED)
i.palettes[1]:setColor(2,Color{r=11,g=22,b=33,a=44})
app.fgColor=Color{index=2}
report('indexed')
local g=Sprite(2,2,ColorMode.GRAY)
app.bgColor=Color(app.pixelColor.graya(91,73))
report('grayscale')
