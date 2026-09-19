/**
 * Exercise animation GIFs.
 *
 * Source: https://github.com/hasaneyldrm/exercises-dataset (1,324 exercises)
 *
 * GIFs are served locally from public/gifs/ (populated by
 * scripts/download-exercise-gifs.cjs) so the app works offline and on
 * networks where the jsdelivr CDN is unreachable. CDN mirrors are kept as
 * runtime fallbacks for files missing locally.
 */
import gifMap from "./data/exercise-gifs.json";

/** Local base (Vite serves public/ at the root; works in dev and Tauri builds). */
export const LOCAL_GIF_BASE = "/gifs/";

/** CDN mirrors tried in order when the local file is missing. gcore first: works where cdn.jsdelivr.net is blocked. */
export const REMOTE_GIF_BASES = [
  "https://gcore.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
  "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
];

const map = gifMap as Record<string, string>;

/** Returns candidate URLs for an exercise slug (local first, then CDN mirrors), or null if unmapped. */
export function gifUrlsFor(slug: string): string[] | null {
  const path = map[slug];
  if (!path) return null;
  return [LOCAL_GIF_BASE + path, ...REMOTE_GIF_BASES.map((b) => b + path)];
}

/** Back-compat: primary URL for an exercise slug, or null if unmapped. */
export function gifUrlFor(slug: string): string | null {
  return gifUrlsFor(slug)?.[0] ?? null;
}
