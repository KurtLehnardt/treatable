import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { isHttpsUrl } from "../shared/ipc";
import { createHandlers, registerIpcHandlers, WINDOW_TITLE } from "./ipc";

// The userData folder is "Treatable Desktop" on every OS. This must be set
// before the app is ready, because Electron reads the path on first use.
app.setName("Treatable Desktop");
app.setPath("userData", join(app.getPath("appData"), "Treatable Desktop"));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: WINDOW_TITLE,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // New windows never open inside the app. Only https links go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpsUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // The renderer never navigates away from the app's own page.
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    registerIpcHandlers(
      ipcMain,
      createHandlers({ version: app.getVersion(), openExternal: (url) => shell.openExternal(url) }),
    );
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
