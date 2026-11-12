import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  ALFA_POS_ANDROID_PACKAGE,
  isClicSuiteAdminUrl,
  isPosApkReleaseForAlfaPos,
  isRemotePosApkNewer,
  resolvePosApkLatestUrl,
  resolvePosApkPortalUrl,
} from '../services/version/posApkUpdateService';

const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(
  new URL('../services/version/posApkUpdateService.ts', import.meta.url),
  'utf8',
);

test('detecta una versión APK remota únicamente cuando su versionCode es mayor', () => {
  assert.equal(isRemotePosApkNewer(1198, 1199), true);
  assert.equal(isRemotePosApkNewer(1198, 1198), false);
  assert.equal(isRemotePosApkNewer(1198, 1197), false);
});

test('el canal APK de Alfa POS apunta a ALFA-Admin y nunca a Cloud-Admin de CLIC-Suite', () => {
  assert.equal(resolvePosApkLatestUrl(), 'https://alfa-admin-nine.vercel.app/api/pos-apk/latest');
  assert.equal(resolvePosApkPortalUrl(), 'https://alfa-admin-nine.vercel.app/apk-pos');
  assert.equal(isClicSuiteAdminUrl(resolvePosApkLatestUrl()), false);
  assert.equal(isClicSuiteAdminUrl(resolvePosApkPortalUrl()), false);
  assert.doesNotMatch(serviceSource, /DEFAULT_POS_APK_LATEST_URL = `?\$\{?CANONICAL_CLOUD_ADMIN_BASE_URL/);
});

test('remapea un Cloud-Admin heredado de CLIC-Suite al canal de Alfa POS', () => {
  const config = {
    metadata: { cloudAdminBaseUrl: 'https://cloud-admin-gamma.vercel.app' },
  } as any;
  assert.equal(resolvePosApkLatestUrl(config), 'https://alfa-admin-nine.vercel.app/api/pos-apk/latest');

  const clicSuiteConfig = {
    metadata: { cloudAdminBaseUrl: 'https://cloud-admin.clicsuite.com' },
  } as any;
  assert.equal(resolvePosApkPortalUrl(clicSuiteConfig), 'https://alfa-admin-nine.vercel.app/apk-pos');
});

test('respeta el Cloud-Admin de Alfa configurado en metadata', () => {
  const config = {
    metadata: { alfaAdminBaseUrl: 'https://alfa-admin.example.com/' },
  } as any;
  assert.equal(resolvePosApkLatestUrl(config), 'https://alfa-admin.example.com/api/pos-apk/latest');
  assert.equal(resolvePosApkPortalUrl(config), 'https://alfa-admin.example.com/apk-pos');
});

test('descarta releases de APK que no son de Alfa POS', () => {
  assert.equal(ALFA_POS_ANDROID_PACKAGE, 'com.alfapos.app');

  assert.equal(
    isPosApkReleaseForAlfaPos({
      version_name: '1.1.477',
      version_code: 1477,
      apk_url: 'https://example.com/Clic-Pos-1.1.477-release.apk',
      package_name: 'com.clicpos.app',
    }),
    false,
  );

  assert.equal(
    isPosApkReleaseForAlfaPos({
      version_name: '1.1.477',
      version_code: 1477,
      direct_download_url: 'https://cloud-admin.clicsuite.com/apk/Clic-Pos-1.1.477-release.apk',
    }),
    false,
  );

  assert.equal(
    isPosApkReleaseForAlfaPos({
      version_name: '1.1.412',
      version_code: 1412,
      direct_download_url: 'https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk',
      package_name: 'com.alfapos.app',
    }),
    true,
  );

  // Sin package declarado se acepta, siempre que el enlace no sea de CLIC-Suite.
  assert.equal(
    isPosApkReleaseForAlfaPos({
      version_name: '1.1.412',
      version_code: 1412,
      apk_url: 'https://alfa-admin-nine.vercel.app/apk/Alfa-Pos-1.1.412-release.apk',
    }),
    true,
  );
});

test('el chequeo automático espera seguridad y no descarta el resultado por cambios de config', () => {
  assert.match(appSource, /!isDataLoaded \|\| !isSecurityLoaded \|\| posApkUpdateCheckStartedRef\.current/);
  assert.doesNotMatch(appSource, /if \(disposed \|\| !result\?\.hasUpdate\) return/);
  assert.match(appSource, /setPosApkUpdate\(result\)/);
});
