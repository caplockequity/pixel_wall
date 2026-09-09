"use client";
/* eslint react/prop-types: "off" -- Package values are validated by the registry. */
import {useEffect, useRef, useState} from "react";
import {ASEPRITE_EXTENSION_LIMITS, readAsepriteExtension, readExtensionAsset} from "./aseprite-extensions.mjs";

export default function AsepritePackagesPanel({registry, disabled, onOpenScript, onRunScript, onApplyPalette, onDownload, onNotice, onError}) {
  const [packages, setPackages] = useState([]), [working, setWorking] = useState(false), [assets, setAssets] = useState(null);
  const file = useRef(null), replacing = useRef(null);
  useEffect(() => {
    let mounted = true;
    registry?.list().then(value => {if (mounted) setPackages(value);}).catch(onError);
    return () => {mounted = false;};
  }, [registry, onError]);
  async function perform(operation) {
    setWorking(true);
    try {await operation(); if (registry) setPackages(await registry.list());}
    catch (error) {onError(error);}
    finally {setWorking(false);}
  }
  function choose(id = null) {replacing.current = id;file.current.value = "";file.current.click();}
  async function importPackage(event) {
    const archive = event.target.files[0];
    if (!archive) return;
    await perform(async () => {
      if (archive.size > ASEPRITE_EXTENSION_LIMITS.archive) throw Error("Extension files must be 16 MB or smaller.");
      const bytes = new Uint8Array(await archive.arrayBuffer()), preview = readAsepriteExtension(bytes);
      if (replacing.current && preview.id !== replacing.current) throw Error("Choose a new version of the same extension package.");
      const pkg = await registry.install(bytes, {replace:!!replacing.current});
      setAssets(null);
      onNotice(`${pkg.displayName} imported. Review its available scripts, palettes and compatibility notes below.`);
    });
  }
  async function contribution(id, item, operation) {
    await perform(async () => {
      const pkg = await registry.get(id);
      if (!pkg?.enabled) throw Error("Enable this package before using its contents.");
      const full = pkg.contributions.find(entry => entry.kind === item.kind && entry.id === item.id);
      if (!full) throw Error("This contribution is no longer available.");
      if (operation === "run") await onRunScript({packageId:id,contributionId:full.id});
      else if (operation === "script") {onOpenScript(full.source);onNotice("Lua source opened. Choose Run package commands to use its registered commands.");}
      else onApplyPalette(full.colors);
    });
  }
  return <details className="wb-extension">
    <summary>Extension packages</summary>
    <p>Import palettes, review Lua source, and run supported commands from extension ZIP files. Importing a package does not run it.</p>
    <button disabled={!registry || working || disabled} onClick={() => choose()}>Import extension</button>
    <input className="wb-hidden" ref={file} type="file" aria-label="Extension file" accept=".aseprite-extension,.zip" onChange={event => void importPackage(event)}/>
    {packages.map(pkg => <div key={pkg.id} className="wb-extension">
      <strong>{pkg.displayName} · {pkg.version}</strong>
      <p>{pkg.description}</p>
      <div className="wb-button-row">
        <button disabled={working || disabled} onClick={() => void perform(async () => {await registry.setEnabled(pkg.id,!pkg.enabled);setAssets(null);})}>{pkg.enabled ? "Disable" : "Enable"}</button>
        <button disabled={working || disabled} onClick={() => choose(pkg.id)}>Replace package</button>
        <button disabled={working || disabled} onClick={() => void perform(async () => {await registry.remove(pkg.id);setAssets(null);onNotice(`${pkg.displayName} removed. Applied artwork changes are retained.`);})}>Remove package</button>
      </div>
      {pkg.contributions.map(item => <div key={item.kind+":"+item.id}>
        <p><strong>{item.name}</strong> · {item.kind}</p>
        {item.reason && <p>{item.reason}</p>}
        {item.kind === "scripts" && item.status === "source-ready" && <div className="wb-button-row"><button disabled={!pkg.enabled || working || disabled} onClick={() => void contribution(pkg.id,item,"script")}>Open Lua source</button><button disabled={!pkg.enabled || working || disabled || !onRunScript} onClick={() => void contribution(pkg.id,item,"run")}>Run package commands</button></div>}
        {item.kind === "palettes" && item.status === "ready" && <button disabled={!pkg.enabled || working || disabled} onClick={() => void contribution(pkg.id,item,"palette")}>Apply palette</button>}
      </div>)}
      <button disabled={working || disabled} onClick={() => void perform(async () => setAssets(await registry.get(pkg.id)))}>Browse package files</button>
      {assets?.id === pkg.id && <label className="wb-field"><span>Download original package file</span><select defaultValue="" onChange={event => {
        if (!event.target.value) return;
        const path = event.target.value;
        try {onDownload(new Blob([readExtensionAsset(assets,path)],{type:"application/octet-stream"}),path.split("/").at(-1));} catch (error) {onError(error);}
        event.target.value = "";
      }}><option value="">Choose a file…</option>{assets.assets.map(asset => <option key={asset.path} value={asset.path}>{asset.path}</option>)}</select></label>}
    </div>)}
  </details>;
}
