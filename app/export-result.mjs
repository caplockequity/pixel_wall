/**
 * Machine-readable handoff for browser exports.
 *
 * Browser JavaScript can create a file and request a download, but it cannot
 * observe whether the browser's download manager ultimately wrote the file.
 * Keep that distinction explicit so automation callers never mistake a
 * generated artifact for a completed download.
 * @param {{id?: string, files?: Array<{filename: string, url: string, mime?: string, bytes?: number}>, requested?: boolean, requestedAt?: string|null, requestedFiles?: string[], artifacts?: Array<{name: string, artifactId: string, sha256: string, expiresAt: number}>, persistence?: {status: string, error?: {code?: string, message?: string}}|null}} [options]
 */
export function createExportResult({ id, files = [], requested = false, requestedAt = null, requestedFiles = [], artifacts = [], persistence = null } = {}) {
  const generatedAt = new Date().toISOString();
  const sentFiles = requestedFiles.length ? requestedFiles : requested ? files.map(file => file.filename) : [];
  const artifactByName = new Map(artifacts.map(artifact => [artifact.name, artifact]));
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
        ...(artifactByName.has(file.filename) ? { artifactId: artifactByName.get(file.filename).artifactId, sha256: artifactByName.get(file.filename).sha256, expiresAt: artifactByName.get(file.filename).expiresAt } : {}),
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
    persistence: persistence ? Object.freeze({ status: persistence.status, ...(persistence.error ? { error: Object.freeze({ ...persistence.error }) } : {}) }) : null,
  });
}
