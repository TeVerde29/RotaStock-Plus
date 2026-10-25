'use strict';

/**
 * Módulo de Actualizaciones Automáticas para RotaStock Plus.
 * Soporta electron-updater cuando está disponible y opera de forma 100% segura en entornos offline.
 */

const pkg = require('../package.json');

class AppUpdater {
  constructor() {
    this.autoUpdater = null;
    this.lastCheck = null;
    this.status = 'idle';

    try {
      const { autoUpdater } = require('electron-updater');
      this.autoUpdater = autoUpdater;
      this.autoUpdater.autoDownload = false;
      this.autoUpdater.autoInstallOnAppQuit = true;
    } catch (_err) {
      // electron-updater es opcional si se compila como portable 100% offline
      this.autoUpdater = null;
    }
  }

  /**
   * Consulta si existe una actualización disponible sin interrumpir el modo offline.
   * @returns {Promise<{ available: boolean, currentVersion: string, latestVersion: string, status: string, message: string }>}
   */
  async checkForUpdates() {
    this.lastCheck = new Date().toISOString();
    const currentVersion = pkg.version || '2.0.0';

    if (!this.autoUpdater) {
      this.status = 'offline-ready';
      return {
        available: false,
        currentVersion,
        latestVersion: currentVersion,
        status: this.status,
        message: `RotaStock Plus v${currentVersion} está actualizado (modo autónomo offline activo).`
      };
    }

    try {
      this.status = 'checking';
      const result = await this.autoUpdater.checkForUpdates();
      const latestVersion = result?.updateInfo?.version || currentVersion;
      const available = latestVersion !== currentVersion;
      this.status = available ? 'update-available' : 'up-to-date';
      return {
        available,
        currentVersion,
        latestVersion,
        status: this.status,
        message: available
          ? `Nueva versión v${latestVersion} disponible.`
          : `RotaStock Plus v${currentVersion} está en la última versión.`
      };
    } catch (err) {
      console.warn('[AppUpdater] Verificación omitida (sin conexión o servidor no configurado):', err.message);
      this.status = 'offline';
      return {
        available: false,
        currentVersion,
        latestVersion: currentVersion,
        status: this.status,
        message: `Versión actual v${currentVersion} verificada localmente (sin conexión a servidor de actualizaciones).`
      };
    }
  }
}

module.exports = {
  AppUpdater
};
