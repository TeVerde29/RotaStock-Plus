'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Escribe un archivo de manera atómica en el sistema de archivos.
 * Primero escribe a un archivo temporal (.tmp) en el mismo directorio,
 * fuerza el volcado al sistema operativo (fsync) y luego renombra atómicamente.
 *
 * @param {string} targetPath Ruta absoluta del archivo destino
 * @param {string} content Contenido UTF-8 a escribir
 */
function writeFileAtomicSync(targetPath, content) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeErr) {
        console.error('[AtomicFS] Error al cerrar descriptor temporal:', closeErr.message);
      }
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (unlinkErr) {
        console.error('[AtomicFS] Error al limpiar archivo temporal:', unlinkErr.message);
      }
    }
    throw err;
  }
}

module.exports = {
  writeFileAtomicSync
};
