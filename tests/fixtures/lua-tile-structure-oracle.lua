-- Original native API contract. The host supplies the original fixture sprite.
local s=app.sprite;local original=s.tilesets[1];local visible=s.layers[2];local hidden=s.layers[3]
local indexed=s.colorMode==ColorMode.INDEXED;local gray=s.colorMode==ColorMode.GRAY
local function pixel(n,r,g,b) return indexed and n or gray and app.pixelColor.graya(n*60,255) or app.pixelColor.rgba(r,g,b,255) end
s.gridBounds=Rectangle(5,6,2,4);assert(s.gridBounds==Rectangle(5,6,2,4))
local default=s:newTileset();assert(#default==1 and default.grid.tileSize==Size(2,4) and default.grid.origin==Point(0,0));s:deleteTileset(default)
local explicit=s:newTileset(Grid());assert(explicit.grid.tileSize==Size(16,16));s:deleteTileset(explicit)
original.baseIndex=-3;original.data='source';original.properties.kind='terrain';original:tile(1).properties.label='first'
local duplicate=s:newTileset(original);assert(duplicate.name==original.name and duplicate.baseIndex==1 and duplicate.data=='source' and duplicate.properties.kind=='terrain')
assert(duplicate:tile(1).properties.label=='first' and duplicate:tile(1).image.id~=original:tile(1).image.id)
duplicate.name='Working tiles';visible.tileset=duplicate;assert(hidden.tileset==original and visible.tileset==duplicate)
local first=duplicate:tile(1);local firstImage=first.image;local firstBytes=firstImage.bytes;local firstImageId=firstImage.id
local second=duplicate:tile(2);local secondImage=second.image
local inserted=s:newTile(duplicate,1)
assert(inserted.index==1 and first.index==1 and first.image:isEmpty() and firstImage.id==firstImageId and firstImage.bytes==firstBytes)
inserted.data='inserted';inserted.properties.note='new slot';inserted.image:clear(pixel(3,0,0,255))
assert(duplicate:tile(2).properties.label=='first')
local insertedImage=inserted.image
s:deleteTile(inserted)
assert(#duplicate==3 and firstImage.id==firstImageId and firstImage.bytes==firstBytes and first.properties.label=='first')
assert(not pcall(function()insertedImage:clear()end))
local ok=pcall(function()app.transaction('failed structural edit',function()
 s:newTile(duplicate,1);s:deleteTile(duplicate,3);first.data='bad';error('rollback')
end)end)
assert(not ok and #duplicate==3 and firstImage.bytes==firstBytes and secondImage.id==second.image.id)
s:deleteTile(duplicate,2)
assert(second.index==2 and second.image==nil and not pcall(function()secondImage:clear()end))
-- Existing map index two is deliberately out of range until a tile is appended.
local blank=Image(s);assert(blank:getPixel(2,0)==0)
local appended=s:newTile(duplicate);assert(appended.index==2 and second.index==2 and second.image.id==appended.image.id)
appended.image:clear(pixel(2,0,255,0));appended.data='appended';appended.properties.role='replacement'
assert(duplicate:tile(1).image.bytes==firstBytes)
local group=s:newGroup();group.name='Generated group';app.layer=group
assert(app.command.NewLayer{tilemap=true,name='Generated map',gridBounds=Rectangle(3,4,2,2)}==true)
local generated=app.layer;assert(generated.isTilemap and generated.parent==group and #generated.cels==0)
assert(generated.tileset.grid.origin==Point(3,4) and generated.tileset.grid.tileSize==Size(2,2))
local created=generated.tileset;local copiedOrigin=s:newTileset(created);assert(copiedOrigin.grid.origin==Point(3,4));s:deleteTileset(copiedOrigin)
local populated=s:newTileset(Rectangle(0,0,1,2),3);populated.name='Narrow tiles';populated:tile(1).image:clear(pixel(1,255,0,0));populated:tile(2).image:clear(pixel(2,0,255,0));populated:tile(2).properties.shape='narrow'
generated.tileset=populated;visible.tileset=populated
assert(visible.tileset==populated and hidden.tileset==original)
generated.tileset=nil;assert(generated.tileset==populated)
s.layers[1].tileset=populated;assert(s.layers[1].tileset==nil)
print('native-tile-structure-contract-ok')
