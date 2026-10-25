'use strict';

/**
 * Hook de firma digital Authenticode para Windows (electron-builder).
 * Firma los ejecutables (.exe) generados (NSIS y Portable) con SHA-256 cuando
 * se provee un certificado PFX mediante variables de entorno (WIN_CSC_LINK / CSC_LINK).
 * En entornos de desarrollo sin certificado comercial, registra el aviso sin bloquear el empaquetado.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

exports.default = async function signWindowsBinary(configuration) {
  const targetPath = configuration.path;
  const certPath = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
  const certPass = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || '';
  const timestampUrl = process.env.SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com';

  if (!certPath) {
    console.info(`[SignWindows] Omitiendo firma digital para "${targetPath}" (WIN_CSC_LINK no definido).`);
    return;
  }

  if (!fs.existsSync(certPath)) {
    console.warn(`[SignWindows] Archivo de certificado no encontrado en "${certPath}". Continuando sin firmar.`);
    return;
  }

  const args = [
    'sign',
    '/f', certPath,
    ...(certPass ? ['/p', certPass] : []),
    '/fd', 'sha256',
    '/tr', timestampUrl,
    '/td', 'sha256',
    '/d', 'RotaStock Plus',
    targetPath
  ];

  try {
    execFileSync('signtool.exe', args, { stdio: 'inherit' });
    console.info(`[SignWindows] Ejecutable firmado exitosamente: ${targetPath}`);
  } catch (err) {
    console.error(`[SignWindows] Error al ejecutar signtool.exe sobre ${targetPath}:`, err.message);
    throw err;
  }
};
