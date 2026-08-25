import { rm } from "node:fs/promises";

// Vinext and Next generate different route-type declarations in the same
// ignored directory. Remove only those generated declarations before a
// standard Next/Vercel build so either build can be run from one checkout.
await Promise.all([
  rm(new URL("../.next/types/", import.meta.url), { recursive: true, force: true }),
  rm(new URL("../.next/dev/types/", import.meta.url), { recursive: true, force: true }),
]);
