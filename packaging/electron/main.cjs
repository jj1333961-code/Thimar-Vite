const { app, BrowserWindow, shell } = require("electron");

// ضع هنا رابط النسخة المنشورة من التطبيق (HTTPS).
const APP_URL = process.env.THIMAR_APP_URL || "https://YOUR-DOMAIN";

function createWindow() {
  const window = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: "#FAF7F1",
    title: "ثمار",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadURL(APP_URL);

  // الروابط الخارجية تُفتح في المتصفح لا داخل التطبيق.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
