import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./style.css";
// index.html explains how to update a WebView that is too old to run Unison.
if (!(window as { __unisonTooOld?: boolean }).__unisonTooOld)
  createRoot(document.getElementById("root")!).render(<App />);
if (
  "serviceWorker" in navigator &&
  !Capacitor.isNativePlatform() &&
  import.meta.env.PROD
)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("Offline installation failed", error));
  });
