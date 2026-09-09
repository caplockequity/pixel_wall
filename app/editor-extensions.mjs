/** Portable command extensions. They can edit artwork, never execute code or make network requests. */
export function validateExtension(input) {
  if (!input || input.format !== "pixelwall-extension" || input.version !== 1)
    throw Error("Choose a PixelWall command extension, version 1.");
  if (!/^[a-z][a-z0-9.-]{0,79}$/.test(input.id || ""))
    throw Error(
      "Extension ID must use lowercase letters, numbers, dots or hyphens.",
    );
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100
  )
    throw Error("Extension needs a name of 1–100 characters.");
  if (
    !Array.isArray(input.commands) ||
    !input.commands.length ||
    input.commands.length > 2000
  )
    throw Error("Extension needs 1–2000 commands.");
  for (const command of input.commands)
    if (!command || typeof command.type !== "string")
      throw Error("Every extension command needs a type.");
  if (JSON.stringify(input).length > 1024 * 1024)
    throw Error("Command extension exceeds 1 MB.");
  return JSON.parse(
    JSON.stringify({
      format: "pixelwall-extension",
      version: 1,
      id: input.id,
      name: input.name.trim(),
      description: String(input.description || "").slice(0, 500),
      commands: input.commands,
    }),
  );
}

export function parsePalette(text) {
  const lines = String(text).split(/\r?\n/),
    colors = [];
  const gimp = lines[0]?.trim() === "GIMP Palette",
    jasc = lines[0]?.trim() === "JASC-PAL";
  for (const line of lines.slice(jasc ? 3 : gimp ? 1 : 0)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (gimp && /^Name:|^Columns:|^#/.test(trimmed)) continue;
    if (gimp || jasc) {
      const rgb = trimmed.split(/\s+/).slice(0, 3).map(Number);
      if (
        rgb.length === 3 &&
        rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
      )
        colors.push(
          "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("") + "ff",
        );
      else throw Error("Palette contains an invalid RGB entry.");
    } else
      for (const token of trimmed.split(/[\s,]+/)) {
        const value = token.startsWith("#") ? token : "#" + token;
        if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
          throw Error("Use HEX, GIMP GPL, or JASC PAL palette files.");
        colors.push(value.toLowerCase() + (value.length === 7 ? "ff" : ""));
      }
  }
  if (!colors.length || colors.length > 65536)
    throw Error("Palette must have between 1 and 65536 colors.");
  return colors;
}
