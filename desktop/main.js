// TT Alarms for Windows: a small desktop shell around the hosted web app.
// It keeps running in the tray so alarms ring and notifications show even
// with the window closed, and starts with Windows.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, nativeTheme, session, shell, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const APP_URL = String(process.env.TT_APP_URL || config.appUrl || "").trim().replace(/\/+$/, "");
const APP_ORIGIN = (() => {
  try {
    return new URL(APP_URL).origin;
  } catch {
    return null;
  }
})();
const ICON = path.join(__dirname, "build", "icon.png");
const APP_ID = "com.ttalarms.desktop";
/** Reload when the window is reopened after this long, to pick up app updates. */
const RELOAD_AFTER_HIDDEN_MS = 30 * 60_000;

app.setAppUserModelId(APP_ID); // Windows needs this for notifications
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required"); // alarm sound without a click
nativeTheme.themeSource = "dark";
// Look like regular Chrome (Google sign-in refuses embedded browsers).
// Drops every product token except the standard ones (e.g. "Electron/44", "TTAlarms/1.0.0").
app.userAgentFallback = app.userAgentFallback.replace(/\s(?!(?:AppleWebKit|Chrome|Safari|Mobile)\/)[\w.-]+\/\S+/g, "");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let tray = null;
  let quitting = false;
  let hiddenAt = null;
  let toldAboutTray = false;
  const notifications = new Set(); // keep references so Windows click handlers survive GC

  const isAppUrl = (url) => {
    try {
      return APP_ORIGIN !== null && new URL(url).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  };
  // Google sign-in pages stay inside the app; every other site opens in the browser.
  const isGoogleSignIn = (url) => {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && (hostname === "accounts.google.com" || hostname.endsWith(".accounts.google.com") || hostname === "accounts.youtube.com");
    } catch {
      return false;
    }
  };
  const isLocalPage = (url) => url.startsWith("file://") && url.includes("offline.html");

  const showOffline = () => win?.loadFile(path.join(__dirname, "offline.html"), { query: APP_URL ? { url: APP_URL } : {} });

  const showWindow = () => {
    if (!win) return;
    const wasHiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (wasHiddenFor > RELOAD_AFTER_HIDDEN_MS && isAppUrl(win.webContents.getURL())) win.webContents.reload();
  };

  const openInApp = (url) => {
    if (!win || !APP_URL) return;
    const target = typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? APP_URL + url : APP_URL;
    showWindow();
    win.loadURL(target);
  };

  const nativeNotification = ({ title, body, url }, alarm) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: ICON, timeoutType: alarm ? "never" : "default", urgency: alarm ? "critical" : "normal" });
    notifications.add(n);
    n.on("click", () => openInApp(url));
    n.on("close", () => notifications.delete(n));
    n.show();
    setTimeout(() => notifications.delete(n), 10 * 60_000);
  };

  const fromApp = (event) => isAppUrl(event.senderFrame?.url ?? "");

  ipcMain.on("tt:notify", (event, n) => {
    if (fromApp(event)) nativeNotification(n, false);
  });
  ipcMain.on("tt:alarm", (event, n) => {
    if (!fromApp(event) || !win) return;
    nativeNotification(n, true);
    // Bring the ringing alarm to the front.
    hiddenAt = null;
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
    win.flashFrame(true);
    setTimeout(() => win?.setAlwaysOnTop(false), 3000);
  });

  const buildTrayMenu = () =>
    Menu.buildFromTemplate([
      { label: "Open TT Alarms", click: showWindow },
      { label: "Reload", click: () => (APP_URL ? win?.loadURL(isAppUrl(win.webContents.getURL()) ? win.webContents.getURL() : APP_URL) : showOffline()) },
      { type: "separator" },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] }),
      },
      { type: "separator" },
      {
        label: "Quit (alarms stop)",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 380,
      minHeight: 500,
      show: false,
      title: "TT Alarms",
      icon: ICON,
      backgroundColor: "#0a0e14",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false, // keep checking for alarms while hidden
      },
    });
    win.removeMenu();

    win.once("ready-to-show", () => {
      if (!process.argv.includes("--hidden")) win.show();
    });

    win.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      win.hide();
      hiddenAt = Date.now();
      if (!toldAboutTray) {
        toldAboutTray = true;
        nativeNotification({ title: "TT Alarms is still running", body: "Alarms will still ring. Right-click the tray icon to quit.", url: null }, false);
      }
    });
    win.on("focus", () => win.flashFrame(false));

    // Links to other sites (bookmakers etc.) open in the normal browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isAppUrl(url)) win.loadURL(url);
      else if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (isAppUrl(url) || isGoogleSignIn(url) || isLocalPage(url)) return;
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    });
    win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
      // -3 = aborted (e.g. a redirect); ignore.
      if (isMainFrame && code !== -3 && isAppUrl(url)) showOffline();
    });

    if (APP_URL) win.loadURL(APP_URL);
    else showOffline();
  };

  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    // Only notifications (and fullscreen) may be requested by pages.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "notifications" || permission === "fullscreen"));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "notifications");

    // First run of the installed app: start with Windows (alarms need it running).
    const marker = path.join(app.getPath("userData"), "first-run-done");
    if (app.isPackaged && !fs.existsSync(marker)) {
      app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
      try {
        fs.writeFileSync(marker, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }

    if (!APP_URL) dialog.showErrorBox("TT Alarms", "No server address is set for this copy of the app (desktop/config.json → appUrl).");

    createWindow();
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip("TT Alarms");
    tray.setContextMenu(buildTrayMenu());
    tray.on("click", showWindow);
  });

  app.on("before-quit", () => {
    quitting = true;
  });
  // Stay in the tray when the window is closed.
  app.on("window-all-closed", () => {});
}
