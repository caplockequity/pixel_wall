/** Blocking Dialog subset. Every callback stays inside the same suspended Lua VM. */
export const LUA_DIALOG_BOOTSTRAP = String.raw`
local Dialog
local dialogStates={}
local dialogMethods={}
local dialogCommon={id=true,label=true,enabled=true,visible=true,focus=true,hexpand=true,vexpand=true}
local dialogFields={entry={text=true},number={text=true,decimals=true},slider={min=true,max=true,value=true},check={text=true,selected=true},combobox={option=true,options=true},color={color=true},button={text=true,selected=true,onclick=true},label={text=true},separator={id=true,text=true},newrow={always=true}}
local function dialogOptions(options,allowed,common)
  options=options or {}; if type(options)~='table' then error('Dialog options must be a table') end
  for key in pairs(options) do if not allowed[key] and not (common and dialogCommon[key]) then error('Unsupported Dialog option: '..tostring(key)) end end
  return options
end
local function dialogValue(control,value)
  if control.type=='color' then return copyColor(Color(value)) end
  if control.type=='number' then
    local n=tonumber(value); if not n then error('Dialog number must be numeric') end
    local decimals=control.decimals or 0
    if type(decimals)~='number' or decimals%1~=0 or decimals<0 or decimals>6 then error('Dialog number supports 0–6 decimal places') end
    local factor=10^decimals; return math.floor(n*factor+0.5)/factor
  end
  return value
end
local function dialogSnapshot(state)
  local controls={}
  for i,control in ipairs(state.controls) do
    local item={}; for key,value in pairs(control) do if key~='onclick' then item[key]=value end end
    if item.type=='color' then item.value=colorRGBA(item.value) end
    controls[i]=item
  end
  return {title=state.title,controls=controls}
end
for kind,fields in pairs(dialogFields) do
  dialogMethods[kind]=function(self,options)
    local state=dialogStates[self]; options=dialogOptions(options,fields,kind~='newrow' and kind~='separator')
    if #state.controls>=64 then error('Dialog supports at most 64 controls') end
    local item={key='w'..tostring(#state.controls+1),type=kind}
    for key,value in pairs(options) do if key~='color' and key~='onclick' and key~='selected' and key~='option' then item[key]=value end end
    if item.id~=nil then if type(item.id)~='string' or state.ids[item.id] then error('Dialog widget IDs must be unique strings') end; state.ids[item.id]=item end
    if kind=='entry' or kind=='label' then item.value=options.text or ''
    elseif kind=='number' then item.value=dialogValue(item,options.text or '0')
    elseif kind=='slider' then item.value=options.value or options.min or 0
    elseif kind=='button' or kind=='check' then item.value=options.selected or false
    elseif kind=='combobox' then item.value=options.option or (options.options and options.options[1])
    elseif kind=='color' then item.value=Color(options.color) end
    if kind=='button' and options.onclick~=nil then if type(options.onclick)~='function' then error('Dialog onclick must be a function') end; item.onclick=options.onclick; item.callback=true end
    state.controls[#state.controls+1]=item
    return self
  end
end
function dialogMethods:close() dialogStates[self].closed=true; return self end
function dialogMethods:show(options)
  options=dialogOptions(options,{wait=true})
  if options.wait~=nil and options.wait~=true then error('Only blocking Dialog:show() is supported') end
  local state=dialogStates[self]
  if state.showing then error('This Dialog is already being shown') end
  state.showing=true; state.closed=false
  local ok,err=pcall(function()
    while not state.closed do
      local reply=jsonDecode(dialogBridge(jsonEncode(dialogSnapshot(state))):await())
      if not reply.ok then error(reply.error,0) end
      local response=reply.value
      for _,control in ipairs(state.controls) do
        local value=response.values[control.key]
        if control.type=='button' then control.value=control.key==response.button
        elseif value~=nil then control.value=control.type=='color' and colorFromRGBA(value) or value end
      end
      if response.action=='close' then state.closed=true
      else
        local selected
        for _,control in ipairs(state.controls) do if control.key==response.button then selected=control; break end end
        if not selected then error('Invalid Dialog button response') end
        if selected.onclick then selected.onclick() else state.closed=true end
      end
    end
    if state.onclose then state.onclose() end
  end)
  state.showing=false
  if not ok then error(err,0) end
  return self
end
Dialog=function(options)
  if not dialogEnabled then error('Dialog requires an interactive UI host; it is unavailable in headless Lua execution') end
  if type(options)=='string' then options={title=options} end
  options=dialogOptions(options,{title=true,onclose=true})
  if options.onclose~=nil and type(options.onclose)~='function' then error('Dialog onclose must be a function') end
  local state={title=options.title or '',controls={},ids={},onclose=options.onclose,closed=true}
  local object={}; dialogStates[object]=state
  return setmetatable(object,{__metatable='Dialog',__index=function(_,key)
    if dialogMethods[key] then return dialogMethods[key] end
    if key=='data' then
      local data={}; for _,control in ipairs(state.controls) do if control.id then data[control.id]=control.type=='color' and copyColor(control.value) or control.value end end; return data
    end
    error('Unsupported Dialog.'..tostring(key))
  end,__newindex=function(_,key,data)
    if key~='data' or type(data)~='table' then error('Only Dialog.data can be assigned a table') end
    for id,value in pairs(data) do local control=state.ids[id]; if not control then error('Unknown Dialog widget: '..tostring(id)) end; control.value=dialogValue(control,value); if control.type=='label' then control.text=control.value end end
  end})
end
`;
