"use client";

import { useEffect, useState } from "react";

export type ExportPreferences = {
  layout: "horizontal" | "vertical" | "grid";
  padding: number;
  trim: boolean;
  individualFrames: boolean;
  gifScale: number;
};
type Preset = { name: string; settings: ExportPreferences };
const STORAGE_KEY = "pixelwall-export-presets-v1";

function readPresets(source: string | null): Preset[] {
  if (!source) return [];
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is Preset => {
    const value = item?.settings;
    return typeof item?.name === "string" && item.name.trim().length > 0 && item.name.length <= 32 && value
      && ["horizontal", "vertical", "grid"].includes(value.layout)
      && Number.isInteger(value.padding) && value.padding >= 0 && value.padding <= 64
      && typeof value.trim === "boolean" && typeof value.individualFrames === "boolean"
      && [1, 2, 4, 8].includes(value.gifScale);
  }).slice(0, 8);
}

export function ExportPresets({ settings, onApply, authorize }: { authorize: () => Promise<boolean>; settings: ExportPreferences; onApply: (settings: ExportPreferences) => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setPresets(readPresets(window.localStorage.getItem(STORAGE_KEY))); }
      catch { setMessage("Saved presets could not be loaded. You can still export normally."); }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function persist(next: Preset[]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setPresets(next);
      return true;
    } catch { setMessage("Browser storage is unavailable. Your export settings still work for this session."); return false; }
  }

  return <details className="export-presets ph-no-capture">
    <summary>SAVED EXPORT PRESETS <em className="pro-badge">PRO</em></summary>
    <p>Reuse layout, padding, trim, individual PNGs, and GIF scale. Presets stay in this browser.</p>
    <label>Load preset<select value={selected} disabled={!ready || !presets.length} onChange={async (event) => {
      const preset = presets.find((item) => item.name === event.target.value);
      if (preset && await authorize()) { onApply(preset.settings); setSelected(preset.name); setName(preset.name); setMessage(`Loaded ${preset.name}`); }
    }}><option value="">Choose a preset</option>{presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>
    <label>Preset name<input value={name} maxLength={32} placeholder="My game exports" onChange={(event) => setName(event.target.value)} /></label>
    <div className="preset-actions">
      <button type="button" disabled={!ready || !name.trim()} onClick={async () => {
        if (!await authorize()) return;
        const cleanName = name.trim();
        const existing = presets.some((preset) => preset.name === cleanName);
        if (!existing && presets.length >= 8) { setMessage("You have 8 presets. Remove one or reuse its name to update it."); return; }
        const next = [...presets.filter((preset) => preset.name !== cleanName), { name: cleanName, settings: { ...settings } }];
        if (persist(next)) { setSelected(cleanName); setMessage(existing ? "Preset updated" : "Preset saved"); }
      }}>{presets.some((preset) => preset.name === name.trim()) ? "UPDATE PRESET" : "SAVE PRESET"}</button>
      <button type="button" disabled={!selected} onClick={() => {
        if (persist(presets.filter((preset) => preset.name !== selected))) { setSelected(""); setName(""); setMessage("Preset removed"); }
      }}>REMOVE</button>
    </div>
    {message && <p role="status">{message}</p>}
  </details>;
}
