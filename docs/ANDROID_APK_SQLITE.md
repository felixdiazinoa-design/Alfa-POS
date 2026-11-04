# Android APK + SQLite nativo

Este proyecto ya puede empaquetarse con Capacitor para Android y usar SQLite nativo cuando corre dentro del runtime Android.

## Flujo actual

- Web: sigue usando IndexedDB.
- Android nativo: usa `CapacitorSQLiteAdapter`.
- Base de datos nativa: `clic_pos_native` dentro del plugin `@capacitor-community/sqlite`.

La seleccion del adapter vive en `services/db/index.ts`.

## Prerrequisitos

- Node.js y `npm install`
- Android Studio
- Gradle JDK 21
- Android SDK instalado

## Primer build Android

```bash
npm run android:sync
npm run android:open
```

Eso compila la web a `dist`, sincroniza Capacitor y abre el proyecto Android.

## Generar APK debug

```bash
npm run android:apk:debug
```

APK generado en:

`release/Clic-Pos-<versionName>-debug.apk` (copia automática desde `android/app/build/outputs/apk/debug/`)

## Generar APK release firmado

Para el flujo operativo con **worktree firmado**, versión monotónica, copia selectiva de archivos y verificación con `apksigner`, ver **[APK_RELEASE_CHECKLIST.md](./APK_RELEASE_CHECKLIST.md)**.

Este flujo usa un keystore local en `android/keys/` y un `android/key.properties` ignorado por Git.

```bash
npm run android:apk:release
```

APK generado en:

`release/Clic-Pos-<versionName>-release.apk` (copia automática desde `android/app/build/outputs/apk/release/`)

Si solo quieres volcar a `release/` lo último compilado, sin recompilar:

```bash
npm run android:apk:collect
```

## Release

Para un APK o AAB de release, abre Android Studio y configura firma:

1. `Build > Generate Signed Bundle / APK`
2. Crear o seleccionar keystore
3. Elegir `APK` o `Android App Bundle`
4. Compilar `release`

## Notas tecnicas

- La persistencia nativa Android usa una tabla `collections` para mantener compatibilidad con el contrato actual del frontend.
- La cola `sync_queue` se crea como tabla SQLite real para soportar operaciones SQL existentes.
- Se desactiva backup del sistema Android para no duplicar ni restaurar SQLite fuera del control de la app.
