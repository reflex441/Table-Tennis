// Exposes window.ttDesktop to the TT Alarms web app (see src/lib/desktop-bridge.ts).
// The main process only acts on messages from the app's own pages.
const { contextBridge, ipcRenderer } = require("electron");

const clean = (n) => ({
  title: String(n?.title ?? "").slice(0, 200),
  body: String(n?.body ?? "").slice(0, 1000),
  url: typeof n?.url === "string" ? n.url : null,
});

contextBridge.exposeInMainWorld("ttDesktop", {
  notify: (n) => ipcRenderer.send("tt:notify", clean(n)),
  alarm: (n) => ipcRenderer.send("tt:alarm", clean(n)),
});
