import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "io.github.nahur1.unison",
  appName: "Unison Player",
  webDir: "dist",
  // Android 7-10 phones can keep an old system WebView. Below Chrome 69 the
  // interface cannot run, so Capacitor shows an update page instead of a blank screen.
  android: { backgroundColor: "#15131a", minWebViewVersion: 69 },
  server: { errorPath: "webview-update.html" },
};
export default config;
