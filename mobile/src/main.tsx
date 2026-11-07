import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./style.css";
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
