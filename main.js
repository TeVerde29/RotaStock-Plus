const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function getBasePath() {
  // Datos por usuario de Windows (igual que tu otro sistema):
  // C:\Users\<usuario>\AppData\Roaming\RotaStockPlus
  return path.join(app.getPath('appData'), 'RotaStockPlus');
}
function dbPath() { return path.join(getBasePath(), 'datos', 'inventario.json'); }
function backupDir() { return path.join(getBasePath(), 'backups'); }

function defaultDB() {
  return {
    meta: { sistema: 'RotaStock Plus', versionEsquema: '2.0.0', createdAt: new Date().toISOString(), totalProductos: 0, totalMovimientos: 0 },
    config: {
      metodoCosteo: 'FIFO',
      umbrales: { sana: 7, lenta: 15, muyLenta: 30 },
      preferenciasUI: { tema: 'claro', autoBackupMinutos: 1, nombreEmpresa: 'Almacén Central de Infraestructura' }
    },
    productos: [],
    movimientos: [],
    conteosCiclicos: []
  };
}

function ensureFiles() {
  const d = path.dirname(dbPath());
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(backupDir())) fs.mkdirSync(backupDir(), { recursive: true });
  if (!fs.existsSync(dbPath())) {
    // Primera vez: trae tu data actual del proyecto si existe, si no arranca vacío
    const semilla = path.join(__dirname, 'datos', 'inventario.json');
    try {
      if (fs.existsSync(semilla)) fs.copyFileSync(semilla, dbPath());
      else fs.writeFileSync(dbPath(), JSON.stringify(defaultDB(), null, 2), 'utf8');
    } catch (_) { fs.writeFileSync(dbPath(), JSON.stringify(defaultDB(), null, 2), 'utf8'); }
  }
  pruneBackups();
}

let lastBackupDay = '';
function dayStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function pruneBackups() {
  // Elimina copias con más de 30 días (por fecha de archivo)
  try {
    const limite = Date.now() - 30 * 864e5;
    for (const f of fs.readdirSync(backupDir())) {
      if (!f.startsWith('inventario-') || !f.endsWith('.json')) continue;
      const p = path.join(backupDir(), f);
      if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p);
    }
  } catch (_) {}
}
function maybeBackup(dbText) {
  // Una sola copia por día: la primera vez que se guarda en el día
  const hoy = dayStamp();
  if (lastBackupDay === hoy) return;
  try {
    if (fs.existsSync(path.join(backupDir(), `inventario-${hoy}.json`))) { lastBackupDay = hoy; return; }
    fs.writeFileSync(path.join(backupDir(), `inventario-${hoy}.json`), dbText, 'utf8');
    lastBackupDay = hoy;
    pruneBackups();
  } catch (_) {}
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 640,
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(() => {
  ensureFiles();
  ipcMain.handle('db:load', () => {
    try { return fs.readFileSync(dbPath(), 'utf8'); }
    catch (_) { const d = defaultDB(); fs.writeFileSync(dbPath(), JSON.stringify(d, null, 2)); return JSON.stringify(d); }
  });
  ipcMain.handle('db:save', (_e, text) => {
    try { fs.writeFileSync(dbPath(), text, 'utf8'); maybeBackup(text); return true; }
    catch (_) { return false; }
  });
  ipcMain.handle('db:listBackups', () => {
    try { return fs.readdirSync(backupDir()).filter(f => f.endsWith('.json')).sort().reverse(); }
    catch (_) { return []; }
  });
  ipcMain.handle('db:readBackup', (_e, name) => {
    const p = path.join(backupDir(), path.basename(name));
    return fs.readFileSync(p, 'utf8');
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
