import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  describePosApkUpdateSource,
  isRemotePosApkNewer,
  resolvePosApkLatestUrl,
  resolvePosApkPortalUrl,
} from '../services/version/posApkUpdateService';
import type { BusinessConfig } from '../types';

const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('detecta una versión APK remota únicamente cuando su versionCode es mayor', () => {
  assert.equal(isRemotePosApkNewer(1198, 1199), true);
  assert.equal(isRemotePosApkNewer(1198, 1198), false);
  assert.equal(isRemotePosApkNewer(1198, 1197), false);
});

test('usa las rutas canónicas de Cloud Admin sin depender del redirect legado', () => {
  assert.equal(resolvePosApkLatestUrl(), 'https://cloud-admin.clicsuite.com/api/pos-apk/latest');
  assert.equal(resolvePosApkPortalUrl(), 'https://cloud-admin.clicsuite.com/apk-pos');
});

test('ALFA-Admin tiene prioridad sobre Cloud-Admin para el registro de APK', () => {
  const config = {
    metadata: { alfaAdminBaseUrl: 'https://alfa-admin.example.com' },
  } as unknown as BusinessConfig;

  assert.equal(resolvePosApkLatestUrl(config), 'https://alfa-admin.example.com/api/pos-apk/latest');
  assert.equal(resolvePosApkPortalUrl(config), 'https://alfa-admin.example.com/apk-pos');

  const source = describePosApkUpdateSource(config);
  assert.equal(source.origin, 'ALFA_ADMIN');
  assert.equal(source.baseUrl, 'https://alfa-admin.example.com');
});

test('un endpoint explícito gana a cualquier base configurada', () => {
  const config = {
    metadata: {
      alfaAdminBaseUrl: 'https://alfa-admin.example.com',
      posApkLatestUrl: 'https://otro.example.com/custom/latest',
    },
  } as unknown as BusinessConfig;

  assert.equal(resolvePosApkLatestUrl(config), 'https://otro.example.com/custom/latest');
  assert.equal(describePosApkUpdateSource(config).origin, 'EXPLICIT');
});

test('sin configuración el origen reportado es el default de Cloud-Admin', () => {
  assert.equal(describePosApkUpdateSource(null).origin, 'DEFAULT');
});

test('el chequeo automático espera seguridad y no descarta el resultado por cambios de config', () => {
  assert.match(appSource, /!isDataLoaded \|\| !isSecurityLoaded \|\| posApkUpdateCheckStartedRef\.current/);
  assert.doesNotMatch(appSource, /if \(disposed \|\| !result\?\.hasUpdate\) return/);
  assert.match(appSource, /setPosApkUpdate\(result\)/);
});
