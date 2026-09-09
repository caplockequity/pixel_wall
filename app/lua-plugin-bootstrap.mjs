/** Explicit one-command package lifecycle; functions never cross the JSON boundary. */
export const LUA_PLUGIN_BOOTSTRAP = String.raw`
local function runPlugin(environment)
  local configuration=jsonDecode(pluginConfig)
  local commands,ids={},{}
  local phase='init'
  local preferences=configuration.preferences
  local plugin
  local function preferenceSnapshot()
    local seen,nodes={},0
    local function check(value,depth)
      nodes=nodes+1
      if nodes>4096 or depth>12 then error('Plugin preferences exceed depth/value limits') end
      local kind=type(value)
      if kind=='boolean' then return end
      if kind=='number' then if value~=value or value==math.huge or value==-math.huge or math.abs(value)>9007199254740991 then error('Plugin preferences require finite exact-safe numbers') end; return end
      if kind=='string' then if #value>16384 or value:find('%z') or not utf8.len(value) then error('Plugin preference strings must be UTF-8 text of at most 16 KiB') end; return end
      if kind~='table' or getmetatable(value)~=nil or handles[value] or values[value] then error('Plugin preferences require plain Lua tables and JSON-compatible values') end
      if seen[value] then error('Plugin preferences cannot be circular') end
      seen[value]=true
      local count,maximum,array=0,0,true
      for key,item in pairs(value) do
        count=count+1
        if type(key)=='number' and key%1==0 and key>=1 then maximum=math.max(maximum,key)
        elseif type(key)=='string' then
          array=false
          if #key>128 or key:find('%z') or not utf8.len(key) or key=='__proto__' or key=='constructor' or key=='prototype' then error('Invalid plugin preference key') end
        else error('Plugin preference keys must be strings or dense array indices') end
        check(item,depth+1)
      end
      if count>0 and maximum>0 and (not array or maximum~=count) then error('Plugin preference arrays must be dense and cannot mix key types') end
      seen[value]=nil
    end
    check(preferences,0)
    for key in pairs(preferences) do if type(key)~='string' then error('Plugin preferences require a top-level string-keyed table') end end
    return preferences
  end
  local function newCommand(self,options)
    if self~=plugin or phase~='init' then error('Plugin commands can be registered only during init') end
    if type(options)~='table' or getmetatable(options)~=nil then error('Plugin:newCommand requires plain options') end
    local allowed={id=true,title=true,group=true,onclick=true,onenabled=true,onchecked=true}
    for key in pairs(options) do if not allowed[key] then error('Unsupported Plugin:newCommand option: '..tostring(key)) end end
    if #commands>=32 then error('A package supports at most 32 commands') end
    local id=options.id
    if type(id)~='string' or #id>128 or not id:match('^[%a_][%w_.:%-]*$') or ids[id] or id=='__proto__' or id=='constructor' or id=='prototype' then error('Plugin command IDs must be unique safe identifiers') end
    if type(options.onclick)~='function' then error('Plugin:newCommand requires an onclick callback') end
    for _,key in ipairs({'onenabled','onchecked'}) do if options[key]~=nil and type(options[key])~='function' then error('Plugin command '..key..' must be a function') end end
    local command={id=id,title=options.title or id,group=options.group or '',onclick=options.onclick,onenabled=options.onenabled,onchecked=options.onchecked}
    commands[#commands+1]=command;ids[id]=command
  end
  plugin=setmetatable({},{__metatable='Plugin',__index=function(_,key)
    if key=='newCommand' then return newCommand end
    if key=='name' or key=='displayName' or key=='version' then return configuration[key] end
    if key=='preferences' then return preferences end
    error('Unsupported Plugin.'..tostring(key))
  end,__newindex=function() error('Plugin identity and preferences binding are read-only; edit preferences table values instead') end})
  if type(environment.init)~='function' then error('Package source must define init(plugin)') end
  if environment.exit~=nil and type(environment.exit)~='function' then error('Package exit must be a function') end
  environment.init(plugin)
  phase='choice'
  local function state(callback,fallback,label)
    if callback==nil then return fallback end
    local value=callback(); if type(value)~='boolean' then error('Plugin '..label..' must return a boolean') end; return value
  end
  local catalog={name=configuration.name,displayName=configuration.displayName,version=configuration.version,commands={}}
  for i,command in ipairs(commands) do
    catalog.commands[i]={id=command.id,title=command.title,group=command.group,enabled=state(command.onenabled,true,'onenabled'),checked=state(command.onchecked,nil,'onchecked')}
  end
  local reply=jsonDecode(pluginBridge(jsonEncode(catalog)):await())
  if not reply.ok then error(reply.error,0) end
  if reply.value.action~='run' then error('Package command session cancelled',0) end
  local selected=ids[reply.value.commandId]
  if not selected or not state(selected.onenabled,true,'onenabled') then error('The chosen package command is no longer enabled') end
  phase='command'
  selected.onclick()
  phase='exit'
  if environment.exit then environment.exit(plugin) end
  phase='finished'
  pluginDone(jsonEncode({name=configuration.name,version=configuration.version,commandId=selected.id,preferences=preferenceSnapshot()}))
end
`;
