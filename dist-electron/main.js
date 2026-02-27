import { app as y, ipcMain as r, BrowserWindow as _ } from "electron";
import h from "node:path";
import { Client as E } from "ssh2";
import p from "node:fs";
import { fileURLToPath as C } from "node:url";
import R from "node:os";
const S = h.dirname(C(import.meta.url)), u = h.join(R.homedir(), ".minissh_config.json"), g = {
  terminalFontName: "JetBrains Mono",
  terminalFontSize: 17,
  uiFontName: "JetBrains Mono",
  uiFontSize: 12,
  theme: "Gruvbox Light",
  favorites: []
};
function x() {
  if (p.existsSync(u))
    try {
      return JSON.parse(p.readFileSync(u, "utf-8"));
    } catch {
      return g;
    }
  return g;
}
function z(t) {
  p.writeFileSync(u, JSON.stringify(t, null, 2));
}
let o;
function F() {
  o = new _({
    width: 1254,
    height: 909,
    frame: !1,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: h.join(S, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0
    },
    title: "YetAnotherSSHClient"
  }), process.env.VITE_DEV_SERVER_URL ? o.loadURL(process.env.VITE_DEV_SERVER_URL) : o.loadFile(h.join(S, "../dist/index.html"));
}
y.whenReady().then(F);
const d = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map();
r.handle("get-config", () => x());
r.handle("save-config", (t, e) => z(e));
r.on("ssh-connect", (t, { id: e, config: s, cols: n, rows: m }) => {
  const i = new E();
  d.set(e, i), i.on("ready", () => {
    t.reply(`ssh-status-${e}`, "SSH Connection Established");
    const l = {
      rows: m || 24,
      cols: n || 80,
      term: "xterm-256color"
    };
    i.shell(l, (a, f) => {
      if (a) {
        t.reply(`ssh-error-${e}`, a.message);
        return;
      }
      c.set(e, f), f.on("data", (w) => {
        t.reply(`ssh-output-${e}`, w.toString());
      }), f.on("close", () => {
        i.end(), t.reply(`ssh-status-${e}`, "SSH Connection Closed");
      });
    });
  }), i.on("error", (l) => {
    var a;
    console.error("SSH client error:", l), !(l.code === "ECONNRESET" || (a = l.message) != null && a.includes("Connection lost before handshake")) && t.reply(`ssh-error-${e}`, l.message);
  }), i.connect({
    host: s.host,
    port: parseInt(s.port) || 22,
    username: s.user,
    password: Buffer.from(s.password || "", "base64").toString("utf8"),
    readyTimeout: 2e4
  });
});
r.on("ssh-input", (t, { id: e, data: s }) => {
  var n;
  (n = c.get(e)) == null || n.write(s);
});
r.on("ssh-resize", (t, { id: e, cols: s, rows: n }) => {
  var m;
  (m = c.get(e)) == null || m.setWindow(n, s, 0, 0);
});
r.on("ssh-close", (t, e) => {
  var s, n;
  (s = c.get(e)) == null || s.end(), (n = d.get(e)) == null || n.end(), c.delete(e), d.delete(e);
});
r.on("window-minimize", () => {
  o == null || o.minimize();
});
r.on("window-maximize", () => {
  o != null && o.isMaximized() ? o.unmaximize() : o == null || o.maximize();
});
r.on("window-close", () => {
  o == null || o.close();
});
