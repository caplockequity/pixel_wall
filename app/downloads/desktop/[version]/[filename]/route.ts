import { desktopDownloadTarget } from "../../../../desktop-release-core.mjs";

export async function GET(_request: Request, context: { params: Promise<{ version: string; filename: string }> }) {
  const { version, filename } = await context.params;
  const target = desktopDownloadTarget(version, filename);
  if (!target) return new Response("This desktop download does not exist.", { status: 404 });
  return new Response(null, {
    status: 307,
    headers: { Location: target, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
