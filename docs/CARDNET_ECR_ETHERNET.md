# CardNET — canal ECR Ethernet (POS-Caja PROVEEDORES v2.25)

Integración de cobro con tarjeta contra el terminal **CardNET** de Consorcio de
Tarjetas Dominicanas, usando el canal **ECRti** documentado en
`Espec_ POS-Caja_PROVEEDORES_Ethernet_Vr. 2.25 (4/02/2025)`.

En este canal la caja (CLIC-POS) actúa como **ECR** y el terminal CardNET como
**POS**: el terminal sigue siendo el que lee la tarjeta, captura el PIN y habla
con el autorizador; la caja solo envía montos y recibe los datos no sensibles
para imprimir el comprobante.

## Por qué hay código nativo

El protocolo es **TCP crudo sobre el puerto 7060** con diálogo de enlace
(`ENQ`, `ACK`, `SYN`, `EOM`, `EOT`) y tramas delimitadas por `STX`/`ETX` + `LRC`.
Un WebView no puede abrir sockets TCP, así que el transporte vive en un plugin
de Capacitor (`CardNetEcr`) y el codec de campos en TypeScript:

| Capa | Archivo |
|------|---------|
| Codec de campos, LRC y framing | `services/payments/CardNetEcrCodec.ts` |
| Servicio (acciones + normalización) | `services/payments/CardNetEcrService.ts` |
| Transporte TCP (APK Android) | `native-stubs/android/CardNetEcrPlugin.kt` |
| Registro del plugin | `android/app/src/main/java/com/clicpos/app/MainActivity.java` |
| UI de configuración | `components/IntegrationSettings.tsx` |
| Cobro en caja / self checkout | `components/PaymentModal.tsx`, `App.tsx` |
| Anulación y devolución | `components/TicketHistory.tsx`, `components/RefundModal.tsx` |
| Pruebas | `tests/cardnetEcrCodec.test.ts` |

El codec es puro TypeScript: se puede probar sin terminal y sin Android con
`npx tsx --test tests/cardnetEcrCodec.test.ts`.

## Configuración

La integración se crea en **Configuración → Integraciones** eligiendo el
proveedor `CardNET`, y luego se asigna a una forma de pago tipo tarjeta en
**Métodos de Pago** (igual que AZUL).

| Campo | Descripción |
|-------|-------------|
| IP / Endpoint | IP del terminal, opcionalmente con puerto (`192.168.1.50:7060`). Si se omite el puerto se usa `7060`. |
| Terminal ID (8) | Número de terminal CardNET; se usa en comprobantes y auditoría. |
| Merchant ID (15) | Identificador de comercio configurado en el terminal. |
| Multi-Merchant (2) | Opcional. Se envía en cada trama solo si el terminal usa multi-empresa; `99` cierra todas las empresas. |
| Delimitadores de trama | `STX…ETX+LRC` (por defecto), `STX…ETX` o solo campos con `FS`, según la parametrización del terminal. |
| Timeout | 90 s por transacción (el cierre se fuerza a 150 s por lote). |
| Probar conexión | Ejecuta `ENQ → ACK` contra el terminal y registra el resultado en la auditoría. |

Requisitos en el terminal CardNET: **modo caja (ECRTi)**, puerto `7060` habilitado
y la IP de esta terminal incluida en su lista blanca.

## Flujo de enlace implementado

```
ECR  -> ENQ              POS -> ACK        (autenticación por IP)
ECR  -> SYN              POS -> EOM        (el POS pasa a modo cliente)
                         POS -> ENQ        (listo para recibir)
ECR  -> <trama CNxx>     POS -> ACK        (recibida)
                         POS -> <respuesta>
ECR  -> ACK              POS -> EOT, EOM   (fin de la comunicación)
```

Cada paso se registra en un *transcript* que acompaña a la transacción y queda
disponible en la auditoría de la integración cuando algo falla.

## Tramas soportadas

| Código | Operación | Pantalla |
|--------|-----------|----------|
| `CN00` | Venta | Cobro en caja y self checkout |
| `CU00` / `PU00` | Venta diferida / lealtad | Disponible en el servicio |
| `CN02` | Anulación (`00` = realizada) | Historial de tickets |
| `CN03` | Devolución | Historial de tickets |
| `CN01` | Cierre de lote (`00`, `01`, `02`, `10` = lotes vacíos) | Integraciones → Cierre |
| `AV00` | Ajuste de propina (`05` = ajustada) | Servicio |
| `UT00` | Última transacción aprobada | Servicio (recuperación de ACK perdido) |
| `CS00` | Consulta de tarjeta | Servicio |
| `RT00` | Reverso controlado por la caja | Servicio (parámetro «Reverso ECR») |

Campos enviados en la venta: `Tipo`, `[Multi-Merchant]`, `Monto`, `ITBIS`,
`Otros impuestos`, `Ticket de la Factura`, `[Diferido]` — montos en centavos sin
punto decimal y justificados con ceros a la izquierda.

## Selección anulación vs. devolución

`CN02` solo funciona mientras la venta siga en el lote abierto del terminal;
`CN03` se usa después del cierre (la tarjeta debe estar presente). El POS
decide así:

- Venta de menos de 24 h **y** con `Num. De Ref.` almacenado → **anulación**.
- Venta fuera de esa ventana (o sin referencia) → **devolución**.

Ambas respetan las mismas reglas de integridad que AZUL: ticket intacto, cobrado
100 % con una única transacción integrada y con la integración activa.

## Datos que se guardan en el pago

`gatewayHost` (06=Crédito, 07=Débito, 08=AMEX, 09=Privada, 10=Peaje, 12=Otro),
`gatewayCardProduct` (VC, MC, MD, AC, DC, OT…), `gatewayReference` (RRN),
`gatewaySequenceNumber` (`Num. De Ref.`), `gatewayInvoiceNumber` (ticket),
`gatewayBatchNumber` (lote), `gatewayMaskedPan`, `gatewayCardBrand`,
`gatewayEntryMode`, `gatewayAuthorizationCode` y `gatewayRawResponse` con la
trama cruda y el transcript.

## Comprobantes

CardNET no devuelve el voucher formateado: entrega campos. El servicio arma el
texto (`buildCardNetSaleVoucher` / `buildCardNetCloseVoucher`) con tarjeta
enmascarada, modo de lectura, autorización, lote/terminal, fecha/hora,
referencia, monto, ITBIS, propina, DCC, Promonet y MONI, y ese texto es el que
se envía a la impresora del POS.

## Diagnóstico

1. **Probar conexión** responde `ENQ → ACK`; si falla, revisar IP, puerto 7060 y
   el modo caja del terminal.
2. `NO_ACK_ENQ` → el terminal no contestó el ENQ (IP fuera de la lista blanca).
3. `NO_EOM` → el terminal no pasó a modo cliente (sesión ocupada o en modo POS).
4. `NO_ACK_REQUEST` / `NACK_REQUEST` → la trama no fue aceptada: revisar el
   framing configurado y el layout de campos.
5. `RESPONSE_TIMEOUT` → el terminal no terminó la transacción en el tiempo
   configurado; usar `UT00` para recuperar la última aprobada antes de reintentar.
6. Código `40` → la transacción no está activa en el terminal; `99` → rechazo.
