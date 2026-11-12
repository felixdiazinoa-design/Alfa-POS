# Native Stubs (APK/EXE)

Este folder incluye base minima para conectar la WebApp de CLIC POS con runtime nativo de impresion.

## Archivos
- `android/ClicPOSNativePrinterBridge.kt`
- `android/ClicPOSBluetoothPrinterManager.kt`
- `android/CardNetEcrPlugin.kt` — plugin Capacitor `CardNetEcr` (TCP al terminal CardNET, puerto 7060)
- `android/ANDROID_BLUETOOTH_SETUP.md`
- `electron/main-printer.stub.js`
- `electron/preload-printer.stub.js`

## CardNET ECR (cobro con tarjeta)

`CardNetEcrPlugin.kt` implementa el transporte del canal ECR de CardNET:
socket TCP al terminal (diálogo `ENQ/ACK/SYN/EOM` y tramas `STX…ETX+LRC`).
El codec de campos vive en TypeScript (`services/payments/CardNetEcrCodec.ts`),
así que el plugin solo mueve bytes.

1. Se registra en `MainActivity.onCreate` antes de `super.onCreate`:
   - `registerPlugin(CardNetEcrPlugin.class)`
2. Se consume desde el frontend con `registerPlugin('CardNetEcr')`
   (`services/payments/CardNetEcrService.ts`).
3. Documentación funcional: `docs/CARDNET_ECR_ETHERNET.md`.


## Android (WebView APK)
1. Registrar interfaz nativa:
   - `webView.addJavascriptInterface(AndroidPrinterBridge(context), "AndroidPrinter")`
2. Inyectar shim del contrato:
   - `AndroidPrinterBridge.injectContractShim(webView)`
3. Aplicar configuración de permisos:
   - revisar `android/ANDROID_BLUETOOTH_SETUP.md`
4. Transporte Bluetooth real ya incluido en:
   - `ClicPOSBluetoothPrinterManager.kt`

Contrato resultante expuesto en frontend:
- `window.ClicPOSNativePrinter.printEscPos(...)`
- `window.ClicPOSNativePrinter.printHtml(...)`
- `window.ClicPOSNativePrinter.discoverPrinters(...)`
- `window.ClicPOSNativePrinter.pairPrinter(...)`

## Electron/Windows (EXE)
1. Main process:
   - importar y llamar `registerPrinterIpc(ipcMain)` desde `main-printer.stub.js`.
2. Preload:
   - copiar contenido de `preload-printer.stub.js` en tu preload real.
3. Completar TODOs en handlers:
   - `printer:print-escpos`
   - `printer:print-html`
   - `printer:discover`

Contrato expuesto en renderer:
- `window.electronAPI.printer`
- `window.ClicPOSNativePrinter`

## Verificacion
- Al iniciar app empaquetada, consola debe mostrar: `Native print bridge detected`.
- Probar discovery en Ajustes > Hardware.
- Probar impresion de etiquetas desde Inventario Movil.
- Si impresora no esta disponible, debe encolar y reintentar automaticamente.
