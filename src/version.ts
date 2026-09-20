/**
 * Single source of truth for the app version shown in the About section.
 * Keep in sync with package.json / src-tauri/tauri.conf.json / Cargo.toml
 * (the release workflow asserts they all match before building).
 */
export const APP_VERSION = "0.2.3";
