'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseAndValidateDB } = require('./src/validator');
const { writeFileAtomicSync } = require('./src/atomic-fs');
const { SQLiteStore } = require('./src/sqlite-store');
const { AppUpdater } = require('./src/updater');

const MS_PER_DAY = 86_400_000;
const BACKUP_RETENTION_DAYS = 30;

let sqliteStore = null;
const appUpdater = new AppUpdater();

function getBasePath() {
  // Datos por usuario de Windows: C:\Users\<usuario>\AppData\Roaming\RotaStockPlus
  return path.join(app.getPath('appData'), 'RotaStockPlus');
}
function dbPath() { return path.join(getBasePath(), 'datos', 'inventario.json'); }
function sqlitePath() { return path.join(getBasePath(), 'datos', 'inventario.sqlite'); }
function backupDir() { return path.join(getBasePath(), 'backups'); }

function defaultDB() {
  return {
    meta: { sistema: 'RotaStock Plus', versionEsquema: '2.0.2', createdAt: new Date().toISOString(), totalProductos: 0, totalMovimientos: 0 },
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

  // Si existen copias históricas semilla en el proyecto, copiarlas si aún no están en backups del usuario
  const seedBackupsDir = path.join(__dirname, 'backups');
  if (fs.existsSync(seedBackupsDir)) {
    try {
      for (const f of fs.readdirSync(seedBackupsDir)) {
        if (!f.endsWith('.json')) continue;
        const dst = path.join(backupDir(), f);
        if (!fs.existsSync(dst)) {
          const src = path.join(seedBackupsDir, f);
          const raw = fs.readFileSync(src, 'utf8');
          if (parseAndValidateDB(raw).valid) {
            writeFileAtomicSync(dst, raw);
          }
        }
      }
    } catch (err) {
      console.warn('[Main] No se pudieron copiar respaldos iniciales:', err.message);
    }
  }

  if (!fs.existsSync(dbPath())) {
    // Primera vez: trae la semilla del proyecto si existe, si no arranca con defaultDB
    const semilla = path.join(__dirname, 'datos', 'inventario.json');
    try {
      if (fs.existsSync(semilla)) {
        const seedText = fs.readFileSync(semilla, 'utf8');
        const check = parseAndValidateDB(seedText);
        if (check.valid) {
          writeFileAtomicSync(dbPath(), seedText);
        } else {
          console.warn('[Main] Semilla inválida, iniciando con base por defecto:', check.error);
          writeFileAtomicSync(dbPath(), JSON.stringify(defaultDB(), null, 2));
        }
      } else {
        writeFileAtomicSync(dbPath(), JSON.stringify(defaultDB(), null, 2));
      }
    } catch (err) {
      console.error('[Main] Error al inicializar inventario.json, usando base por defecto:', err.message);
      writeFileAtomicSync(dbPath(), JSON.stringify(defaultDB(), null, 2));
    }
  }

  sqliteStore = new SQLiteStore(sqlitePath());
  if (sqliteStore.init()) {
    try {
      const currentText = fs.readFileSync(dbPath(), 'utf8');
      const check = parseAndValidateDB(currentText);
      if (check.valid) {
        sqliteStore.syncFromObject(check.db);
      }
    } catch (err) {
      console.warn('[Main] No se pudo sincronizar SQLite inicial:', err.message);
    }
  }

  pruneBackups();
}

let lastBackupDay = '';
function dayStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pruneBackups() {
  // Elimina copias con más de 30 días, conservando siempre al menos las 15 copias más recientes
  try {
    const files = fs
      .readdirSync(backupDir())
      .filter(f => f.startsWith('inventario-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length <= 15) return;
    const limite = Date.now() - BACKUP_RETENTION_DAYS * MS_PER_DAY;
    for (const f of files.slice(15)) {
      const p = path.join(backupDir(), f);
      if (fs.statSync(p).mtimeMs < limite) {
        fs.unlinkSync(p);
      }
    }
  } catch (err) {
    console.warn('[Main] Error al purgar copias antiguas:', err.message);
  }
}

function maybeBackup(dbText) {
  // Una sola copia por día: la primera vez que se guarda en el día
  const hoy = dayStamp();
  if (lastBackupDay === hoy) return;
  try {
    const targetBackup = path.join(backupDir(), `inventario-${hoy}.json`);
    if (fs.existsSync(targetBackup)) {
      lastBackupDay = hoy;
      return;
    }
    writeFileAtomicSync(targetBackup, dbText);
    lastBackupDay = hoy;
    pruneBackups();
  } catch (err) {
    console.error('[Main] Error al generar copia automática diaria:', err.message);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(() => {
  ensureFiles();

  ipcMain.handle('db:load', () => {
    try {
      const raw = fs.readFileSync(dbPath(), 'utf8');
      const check = parseAndValidateDB(raw);
      if (check.valid) return raw;
      console.warn('[Main] Archivo inventario.json presentó problemas de validación, intentando recuperar de SQLite:', check.error);
      if (sqliteStore && sqliteStore.available) {
        const recovered = sqliteStore.exportToObject();
        if (recovered) {
          const recText = JSON.stringify(recovered, null, 2);
          writeFileAtomicSync(dbPath(), recText);
          return recText;
        }
      }
      return raw;
    } catch (err) {
      console.error('[Main] Error al cargar inventario.json, restaurando base por defecto:', err.message);
      const d = defaultDB();
      const text = JSON.stringify(d, null, 2);
      writeFileAtomicSync(dbPath(), text);
      return text;
    }
  });

  ipcMain.handle('db:save', (_e, text) => {
    try {
      const check = parseAndValidateDB(text);
      if (!check.valid) {
        console.error('[Main] Guardado rechazado por validación de integridad:', check.error);
        return false;
      }
      writeFileAtomicSync(dbPath(), text);
      maybeBackup(text);
      if (sqliteStore && sqliteStore.available) {
        sqliteStore.syncFromObject(check.db);
      }
      return true;
    } catch (err) {
      console.error('[Main] Error crítico al guardar en disco:', err.message);
      return false;
    }
  });

  ipcMain.handle('db:listBackups', () => {
    try {
      return fs.readdirSync(backupDir()).filter(f => f.endsWith('.json')).sort().reverse();
    } catch (err) {
      console.error('[Main] Error al listar copias de seguridad:', err.message);
      return [];
    }
  });

  ipcMain.handle('db:readBackup', (_e, name) => {
    try {
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error('Nombre de archivo de respaldo inválido.');
      }
      const safeName = path.basename(name);
      const p = path.join(backupDir(), safeName);
      if (!fs.existsSync(p)) {
        throw new Error(`El archivo de respaldo "${safeName}" no existe.`);
      }
      const content = fs.readFileSync(p, 'utf8');
      const check = parseAndValidateDB(content);
      if (!check.valid) {
        throw new Error(`El archivo de respaldo está corrupto: ${check.error}`);
      }
      return content;
    } catch (err) {
      console.error('[Main] Error al leer copia de seguridad:', err.message);
      throw err;
    }
  });

  ipcMain.handle('db:sqliteStatus', () => {
    return sqliteStore ? sqliteStore.getStatus() : { enabled: false, engine: 'none' };
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    return appUpdater.checkForUpdates();
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (sqliteStore) sqliteStore.close();
  if (process.platform !== 'darwin') app.quit();
});
