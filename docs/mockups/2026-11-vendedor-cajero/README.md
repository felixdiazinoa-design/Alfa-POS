# Mockup · Vendedor del ticket + identidad del cajero

**Estado: implementado** en `components/POSInterface.tsx` y `components/OrderServiceTypeButton.tsx`
(typecheck + `vite build` en verde). Lo de abajo queda como registro de la propuesta y de las decisiones.

Propuesta visual para dos pedidos sobre la pantalla de venta:

1. Un botón de **Vendedor** que asigne un vendedor a **todas** las líneas del ticket, dejando
   después cambiarlo por línea desde **Acciones ⋯**.
2. Que en la izquierda del encabezado se vea el **cajero** (foto + nombre + caja) y desaparezca
   el logo **ALFA-POS**.

## Archivos

| Archivo | Para qué |
|---|---|
| `04-cabecera-final.png` | La cabecera ya estandarizada, renderizada con el CSS real compilado. |
| `05-antes-despues.png` | Comparación lado a lado de los botones (alturas 36/48/64 → 48). |

## Sistema de la cabecera (lo implementado)

Todos los controles de la cabecera del ticket comparten ahora la misma métrica:
**48 px de alto, radio 16 px (`rounded-2xl`), borde neutro `#E2E8E7` y tile de 32 px
(`rounded-xl`) con el icono de color**. Las etiquetas son de 8.5 px / 900 / tracking 0.16em
y el valor de 10.5 px / 900.

| Control | Estado vacío | Estado lleno |
|---|---|---|
| Vendedor | borde discontinuo + “Sin asignar” ámbar | borde teal + nombre + contador de líneas + ✕ |
| Cliente | borde discontinuo + “Sin asignar” ámbar | borde neutro + nombre/foto + ✕ |
| Servicio | — | borde violeta + “En local / Para llevar / Delivery” |
| Carrito / Acciones / Borrar | 48×48, tile de color, badge de unidades | activo = relleno degradado |

En la barra lateral estrecha (modo restaurante, 384 px) los chips pierden el texto y quedan
solo los iconos con tooltip; la fila del toolbar tiene `flex-wrap` para que nada se salga.

## Propuesta en una línea

- **Botón principal:** chip `VENDEDOR` en la barra superior, a la izquierda de `CLIENTE`
  (es una asignación **del ticket**, igual que el cliente).
- **Espejo:** la misma acción como línea dentro de la tarjeta de totales (fila “unidades / B02”),
  que es lo único que sobrevive cuando la barra se comprime en móvil.
- **Dock izquierdo:** descartado como 13.º botón (la rejilla es 4×3 y el panel tiene alto máximo
  con scroll: el botón quedaría oculto).
- **Encabezado:** el bloque del logo se reemplaza por foto + nombre + `CAJERO · CAJA xx`.

## Lo que ya existe (esto es sobre todo cablear UI)

| Pieza | Dónde |
|---|---|
| `salespersonId` por línea del carrito | `types.ts` (`CartItem`) · `components/ProductTableSupermarket.tsx:122` |
| Chip de vendedor por línea (debajo de la descripción) | `components/ProductTableSupermarket.tsx:182-186` |
| Acción “Asignar vendedor” en el menú de la línea | `components/ProductTableSupermarket.tsx:271-279` (`onAssignSeller`) |
| Escritura del vendedor en una línea | `components/POSInterface.tsx:4944` (`assignSellerToCartLine`) |
| Selector (modal) de vendedor | `components/POSInterface.tsx:9290-9340` |
| Lista de vendedores del snapshot del terminal | `utils/terminalSnapshotSellers.ts` (`getTerminalSnapshotSellers`) |
| Impresión del vendedor por línea | `utils/printer.ts:439` (`Vendedor: …`) |
| Resumen por vendedor en Cierre Z | `utils/closeReportOptions.ts` (`SELLER_SUMMARY`) |
| Logo a reemplazar | `components/POSInterface.tsx:4431` (`renderTicketBrand`), usado en `7922` (móvil) y `8065` (desktop) |
| Identidad del cajero que ya se usa en el otro encabezado | `components/POSInterface.tsx:7520` (`pos-catalog-identity`: foto, nombre, “Cajero”, terminal) |
| Dock de 12 botones | `components/ActionGrid.tsx:117` (`grid-cols-4`) + `components/POSInterface.tsx:8792` |
| Tarjeta de totales | `components/SupermarketTicketSummary.tsx` (fila de `unidades` / `B02`) |

## Trabajo estimado cuando se apruebe

1. **Estado**: `ticketSellerId` en `POSInterface` (y su espejo en el resumen), no en config.
2. **Acción global**: al elegir vendedor, recorrer `cart` y escribir `salespersonId` en cada línea;
   las líneas tocadas a mano quedan con `sellerOverride: true` (o se reescriben si se marca la casilla).
3. **Chip**: componente único reutilizado en la barra y en la tarjeta de totales.
4. **Encabezado**: sustituir `renderTicketBrand(...)` por el bloque de cajero (foto → inicial si no hay).

## Decisiones abiertas

- ¿La asignación global **pisa** las líneas cambiadas a mano, o las respeta (y hay que marcar una
  casilla para pisarlas)? En el mock está la versión que respeta + casilla.
- En modo **restaurante** (no supermercado) la identidad del cajero ya aparece en el encabezado del
  catálogo. Si se pone también en el del ticket, se duplica: habría que quitar la del catálogo.
- ¿El vendedor del ticket se guarda en el ticket en espera / reserva recuperada? (hoy solo viaja el
  vendedor de cada línea).
