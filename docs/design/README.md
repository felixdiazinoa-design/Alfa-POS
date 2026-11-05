# Rediseño ALFA-POS — propuestas

Mockups de referencia para la pantalla de **acceso** y de **ventas** del APK.
Son HTML autocontenido (1440×900), sin dependencias: se abren en cualquier
navegador y se pueden ajustar editando el CSS.

## Paleta (tomada del material de marca de ALFA)

| Token | Valor | Uso |
|---|---|---|
| `--ink` | `#132124` | Texto principal, barras, fondos oscuros |
| `--teal` | `#00A7A0` | Acción primaria, foco, enlaces |
| `--teal-2` | `#00877F` | Hover / texto sobre teal claro |
| `--lime` | `#B8E336` | Acento, indicador "en línea" |
| `--paper` | `#F4F7F6` | Fondo de aplicación |
| `--line` | `#E1E9E8` | Bordes y separadores |
| `--muted` | `#6C7F80` | Texto secundario |
| `--danger` | `#C0392B` | Solo acciones destructivas |

Tipografía: **Sora** (fallback Inter / system).

## Reglas de diseño

1. **Un solo color de acción.** Teal es lo accionable; lima solo indica estado.
   El rojo queda reservado a lo destructivo (Cierre Z, cerrar app).
2. **Jerarquía por tamaño, no por color.** El total y el CTA dominan la vista;
   el resto se apoya en tipografía y espaciado.
3. **Densidad controlada.** Filas de ticket de 15 px de padding y números
   tabulares alineados a la derecha: se leen de un vistazo a distancia de caja.
4. **Todo etiquetado.** Ningún botón queda solo con icono en las acciones
   críticas; en el dock se usa icono + texto corto.
5. **Marca ALFA, no CLIC-POS.** El logotipo, el wordmark y el nombre del
   producto (`ALFA-POS`) aparecen en acceso y en la barra superior.

## Propuestas

### Acceso

- **`login-a.html` — Split marca + teclado.** Panel oscuro de marca a la
  izquierda (logo, wordmark, sucursal, terminal y versión); a la derecha el
  teclado sobre fondo claro. Da presencia de marca y sitúa al operador.
- **`login-b.html` — Tarjeta centrada.** Todo en una tarjeta blanca con pie
  oscuro de estado. Más neutro; útil si la caja es táctil pequeña o se usa en
  modo kiosco.

### Ventas

- **`ventas-a.html` — Barra oscura + riel de cobro.** Barra superior oscura con
  búsqueda dominante, ticket en tabla clásica y riel derecho con el total grande
  y el CTA fijo. Es la variante más densa: más líneas visibles por pantalla.
- **`ventas-b.html` — Tarjetas + acciones agrupadas.** Tema claro, ticket como
  tarjetas, total en tarjeta oscura y acciones agrupadas por dominio
  (Venta / Caja / Sistema). Más moderna y fácil de escanear; ocupa más alto.

## Renderizar

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars --window-size=1440,900 \
  --screenshot=preview/login-a.png "file://$PWD/login-a.html"
```

Los PNG en `preview/` son el resultado de ese comando.
