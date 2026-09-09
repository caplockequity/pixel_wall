"use client";
/* eslint react/prop-types: "off" -- Schemas are validated by the Lua host boundary. */
import { useCallback, useEffect, useRef, useState } from "react";
import { validateDialogResponse } from "./lua-dialog-schema.mjs";
import { documentProfile, isSRGB } from "./color-management.mjs";

const editable = new Set(["entry", "number", "slider", "check", "combobox", "color"]);
const colorHex = value => "#" + value.map(byte => byte.toString(16).padStart(2, "0")).join("");

export function useLuaDialog() {
  const [view, setView] = useState(null);
  const pending = useRef(null);
  const show = useCallback((schema, { signal, requestId }) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(Error("Lua dialog cancelled.")); return; }
    if (pending.current) { reject(Error("Another Lua dialog is already open.")); return; }
    let settled = false;
    const finish = (answer, error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      pending.current = null;
      setView(current => current?.requestId === requestId ? null : current);
      if (error) reject(error); else resolve(answer);
    };
    const abort = () => finish(null, Error("Lua dialog cancelled."));
    pending.current = abort;
    signal.addEventListener("abort", abort, {once:true});
    setView({ schema, requestId, respond: answer => finish(answer) });
  }), []);
  useEffect(() => () => pending.current?.(), []);
  return { view, show };
}

export default function LuaDialogView({ view, document, colorManager, onCancelScript }) {
  const { schema, respond } = view;
  const dialogRef = useRef(null);
  const [values, setValues] = useState(() => Object.fromEntries(schema.controls.filter(control => editable.has(control.type)).map(control => [control.key, control.type === "color" ? colorHex(control.value) : control.value])));
  const [error, setError] = useState("");
  const answered = useRef(false);
  useEffect(() => {
    const element = dialogRef.current;
    element.showModal();
    (element.querySelector('[data-script-focus="true"]:not(:disabled)') || element.querySelector('input:not(:disabled), select:not(:disabled), form button:not(:disabled)'))?.focus();
  }, []);
  const change = (control, value) => { setValues(current => ({...current, [control.key]:value})); setError(""); };
  function answer(action, button) {
    if (answered.current) return;
    try {
      const changed = {};
      for (const control of schema.controls) {
        if (!editable.has(control.type) || !control.enabled || !control.visible) continue;
        try {
        let value = values[control.key];
        if (["number", "slider"].includes(control.type)) {
          if (String(value).trim() === "") throw Error(`Enter a number for ${control.label || control.id || "this field"}.`);
          value = Number(value);
        }
        if (control.type === "color") {
          if (!/^#[\da-f]{8}$/i.test(value)) throw Error(`Use #RRGGBBAA for ${control.label || control.id || "this color"}.`);
          value = value.slice(1).match(/../g).map(byte => parseInt(byte, 16));
        }
        if (JSON.stringify(value) !== JSON.stringify(control.value)) {
          const checked = validateDialogResponse({action:"close", values:{[control.key]:value}}, schema);
          changed[control.key] = checked.values[control.key];
        }
        } catch (failure) {
          // Closing retains the previous value of an unfinished/invalid field.
          // Explicit button submission keeps the form open for correction.
          if (action !== "close") throw failure;
        }
      }
      const response = validateDialogResponse({action, ...(button ? {button} : {}), values:changed}, schema);
      answered.current = true;
      respond(response);
    } catch (failure) { setError(failure.message); }
  }
  const firstButton = schema.controls.find(control => control.type === "button" && control.visible && control.enabled);
  function field(control) {
    const props = { disabled:!control.enabled, "data-script-focus":control.focus, "aria-label":control.label || control.text || control.id || control.type };
    const value = values[control.key];
    switch (control.type) {
      case "entry": return <input {...props} value={value} onChange={event => change(control, event.target.value)} />;
      case "number": return <input {...props} type="number" min={-1e9} max={1e9} step={10 ** -control.decimals} value={value} onChange={event => change(control, event.target.value)} />;
      case "slider": return <span className="wb-script-slider"><input {...props} type="range" min={control.min} max={control.max} step={1} value={value} onChange={event => change(control, Number(event.target.value))} /><output>{value}</output></span>;
      case "check": return <span><input {...props} type="checkbox" checked={value} onChange={event => change(control, event.target.checked)} /> {control.text}</span>;
      case "combobox": return <select {...props} value={value} onChange={event => change(control, event.target.value)}>{control.options.map((option, index) => <option key={index} value={option}>{option}</option>)}</select>;
      case "color": {
        const valid = /^#[\da-f]{8}$/i.test(value);
        let ready = isSRGB(documentProfile(document)) || !!colorManager;
        let display = valid ? value : "#000000ff";
        try { if (valid && ready && colorManager) display = colorManager.displayColor(document, value); }
        catch { ready = false; }
        return <span className="wb-script-color"><input type="color" aria-label={`${props["aria-label"]} picker`} disabled={!control.enabled || !ready} value={display.slice(0, 7)} onChange={event => {
          try { const selected = event.target.value + (valid ? value.slice(7) : "ff"); change(control, colorManager?.workingColor(document, selected) || selected); }
          catch (failure) { setError(failure.message); }
        }} /><input {...props} value={value} placeholder="#RRGGBBAA" onChange={event => change(control, event.target.value)} /></span>;
      }
      default: return null;
    }
  }
  return <dialog ref={dialogRef} className="wb-dialog wb-script-dialog" data-pixelwall-lua-controls aria-label={schema.title || "Script dialog"} onCancel={event => { event.preventDefault(); answer("close"); }}>
    <header><h2>{schema.title || "Script dialog"}</h2><button aria-label="Close script dialog" onClick={() => answer("close")}>×</button></header>
    <form noValidate onSubmit={event => { event.preventDefault(); if (firstButton) answer("button", firstButton.key); }}>
      <div className="wb-script-controls">{schema.controls.filter(control => control.visible).map(control => {
        if (control.type === "newrow") return <div key={control.key} className="wb-script-newrow" />;
        if (control.type === "separator") return <div key={control.key} className="wb-script-separator">{control.label || control.text}<hr /></div>;
        if (control.type === "label") return <p key={control.key} className="wb-script-label">{control.label && <span>{control.label} </span>}{control.value}</p>;
        if (control.type === "button") return <div key={control.key} className="wb-script-button">{control.label && <span>{control.label} </span>}<button type="button" disabled={!control.enabled} data-script-focus={control.focus} onClick={() => answer("button", control.key)}>{control.text || control.id || "OK"}</button></div>;
        return <label key={control.key} className={`wb-field${control.hexpand ? " wb-script-expand" : ""}`}><span>{control.label}</span>{field(control)}</label>;
      })}</div>
      {error && <p role="alert">{error}</p>}
    </form>
    <button onClick={onCancelScript}>Cancel script</button>
  </dialog>;
}
