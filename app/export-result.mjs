/**
 * Machine-readable handoff for browser exports.
 *
 * Browser JavaScript can create a file and request a download, but it cannot
 * observe whether the browser's download manager ultimately wrote the file.
 * Keep that distinction explicit so automation callers never mistake a
 * generated artifact for a completed download.
 * @param {{id?: string, files?: Array<{filename: string, url: string, mime?: string, bytes?: number}>, requested?: boolean, requestedAt?: string|null, requestedFiles?: string[]}} [options]
 */
export function createExportResult({ id, files = [], requested = false, requestedAt = null, requestedFiles = [] } = {}) {
  const generatedAt = new Date().toISOString();
  const sentFiles = requestedFiles.length ? requestedFiles : requested ? files.map(file => file.filename) : [];
  return Object.freeze({
    id: String(id || "export"),
    generated: Object.freeze({
      status: "generated",
      completedAt: generatedAt,
      urlLifetime: "Available until the next export, dismiss, or editor unmount.",
      files: Object.freeze(files.map(file => Object.freeze({
        filename: file.filename,
        mime: file.mime || "application/octet-stream",
        bytes: Number.isSafeInteger(file.bytes) ? file.bytes : null,
        url: file.url,
      }))),
    }),
    download: Object.freeze({
      status: requested ? "requested" : "not_requested",
      requestedAt: requested ? (requestedAt || generatedAt) : null,
      completedAt: null,
      completion: "unobservable",
      message: "The browser does not expose download completion to the editor.",
      files: Object.freeze(files.map(file => Object.freeze({
        filename: file.filename,
        status: sentFiles.includes(file.filename) ? "requested" : "not_requested",
        completedAt: null,
      }))),
    }),
  });
}
