-- Original Image identity contract, shared by PixelWall and the native oracle.
local s=app.sprite;local ts=s.tilesets[1];local held,created,replacement
assert(not pcall(function()app.transaction(function()
 held=ts:tile(1).image;s:deleteTile(ts,1)
 created=s:newTile(ts,1).image;ts:tile(2).image=Image(2,2);replacement=ts:tile(2).image
 error('restore original images')
end)end))
assert(held.id==ts:tile(1).image.id and not held:isEmpty())
assert(not pcall(function()created:clear()end));assert(not pcall(function()replacement:clear()end))
print('native-tile-lifetime-contract-ok')
