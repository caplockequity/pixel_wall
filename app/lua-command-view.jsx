"use client";
/* eslint react/prop-types: "off" -- Catalogs are validated by the Lua host boundary. */
import { useEffect, useRef } from "react";

export default function LuaCommandView({view}) {
  const ref = useRef(null), answered = useRef(false);
  const {schema:catalog,respond} = view;
  function answer(value) { if (!answered.current) { answered.current = true; respond(value); } }
  useEffect(() => { ref.current.showModal(); ref.current.querySelector('[data-package-command]:not(:disabled)')?.focus(); }, []);
  return <dialog ref={ref} className="wb-dialog" data-pixelwall-lua-controls aria-label={`${catalog.displayName} commands`} onCancel={event => {event.preventDefault();answer({action:'cancel'});}}>
    <header><h2>{catalog.displayName}</h2><button aria-label="Close package commands" onClick={() => answer({action:'cancel'})}>×</button></header>
    <p>Choose a command to run on the current project.</p>
    <div className="wb-package-commands">{catalog.commands.map(command => <button key={command.id} data-package-command disabled={!command.enabled} onClick={() => answer({action:'run',commandId:command.id})}>{command.checked ? '✓ ' : ''}{command.title || command.id}</button>)}</div>
    {!catalog.commands.some(command => command.enabled) && <p>No commands are available for this project.</p>}
    <button onClick={() => answer({action:'cancel'})}>Cancel</button>
  </dialog>;
}
