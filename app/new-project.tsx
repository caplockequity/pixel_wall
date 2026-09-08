"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  sizes: number[];
  onClose: () => void;
  onCreate: (name: string, size: number, backup: boolean) => boolean;
};

export function NewProjectDialog({ open, sizes, onClose, onCreate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState(32);
  const [backup, setBackup] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      nameInput.current?.focus();
    } else if (!open) dialog.current?.close();
  }, [open]);

  return <dialog ref={dialog} className="quick-guide new-project-dialog" aria-labelledby="new-project-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form className="quick-guide-card" onSubmit={(event) => {
      event.preventDefault();
      if (onCreate(name.trim() || "UNTITLED", size, backup)) {
        setName("");
        setBackup(true);
        setError("");
      } else setError("Your backup could not be created. Your current project is still open. Save it before trying again.");
    }}>
      <button className="guide-close" type="button" aria-label="Close new project" onClick={onClose}>×</button>
      <span className="quick-guide-kicker">A FRESH CANVAS</span>
      <h2 id="new-project-title">NEW PROJECT</h2>
      <p>Your new project will become this browser’s autosaved project. Undo can bring back your current work during this session.</p>
      <label>Project name<input ref={nameInput} className="ph-no-capture" value={name} maxLength={48} placeholder="UNTITLED" onChange={(event) => setName(event.target.value)} /></label>
      <label>Canvas size<select value={size} onChange={(event) => setSize(Number(event.target.value))}>{sizes.map((value) => <option key={value} value={value}>{value} × {value}</option>)}</select></label>
      <label className="backup-choice"><input type="checkbox" checked={backup} onChange={(event) => setBackup(event.target.checked)} /><span>Download a backup of my current project first</span></label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Keep working</button><button type="submit" className="quick-guide-done">CREATE PROJECT</button></div>
    </form>
  </dialog>;
}
