# Migración USGS: WaterServices → Water Data APIs (OGC)

## Qué usaba el proyecto
| Uso | Endpoint anterior | Estado |
|---|---|---|
| Caudal de 26 estaciones, últimos 7 días | `waterservices.usgs.gov/nwis/iv/` (JSON WaterML, `parameterCd=00060`, `period=P7D`) | **Afectado**: se da de baja el 22-feb-2027. Desde Netlify ya devolvía HTTP 503 / timeouts. |
| Coordenadas de estaciones | Venían dentro de la respuesta IV | Ya **no dependen** de USGS en tiempo real: están fijas en `src/data/catalog.json` (tomadas del Site Service de USGS el 25-sep-2026). |

Ninguna otra parte del monitor usa USGS (embalses = USBR; nieve/embalses NRCS = USDA).

## Qué se usa ahora
`GET https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items`
`?f=json&monitoring_location_id=USGS-<sitio>&parameter_code=00060&datetime=<ISO-7d>/..&limit=10000&properties=time,value,unit_of_measure&skipGeometry=true`

Orden de intento por estación: **v1 → v0**. Sólo si ambas fallan y **antes del 22-feb-2027**, respaldo con WaterServices. Desde esa fecha el código no lo consulta más (`LEGACY_SUNSET` en `netlify/lib/usgs.ts`), así que WaterServices no es dependencia de producción.

## ¿Alcanza con cambiar v0 → v1?
No. El cambio de fondo es de formato, no de versión:

| Aspecto | WaterServices (IV) | Water Data API (OGC) | Cómo se resolvió |
|---|---|---|---|
| Formato | WaterML-JSON: `value.timeSeries[].values[].value[]` | GeoJSON: `features[].properties` | Parser nuevo `parseUsgsOgcContinuous` (`src/shared/process.ts`) |
| Estaciones | Muchas por pedido (`sites=a,b,c`) | Una por pedido (`monitoring_location_id=USGS-…`) | 26 pedidos, de a 6 en paralelo |
| Valor | texto; sin dato = `-999999` | texto o número; sin dato = `null` | Se descartan `null`, vacíos y no numéricos |
| Hora | `dateTime` con offset local | `time` ISO 8601 (con zona) | `Date.parse` → epoch UTC; se agrupa por hora (último valor de cada hora) |
| Unidades | cfs implícito por `00060` | `unit_of_measure` | Si la API informara m³/s, el dato se descarta (no se mezclan unidades) |
| Nombre / coordenadas | incluidos | no se piden (`skipGeometry`) | Catálogo propio |
| Errores | 503 frecuentes | HTTP estándar; **429** = límite | 429 corta la ronda (no insiste); cada error queda guardado y se muestra en la pestaña Ríos |
| Límite de consultas | por IP, no publicado | por IP sin clave; más alto con clave (encabezado `X-Api-Key`) | Variable opcional `USGS_API_KEY` en Netlify |

## Netlify Functions
- `usgs-refresh` (programada cada 15 min, hasta 30 s): hace las consultas y guarda en Netlify Blobs el último dato bueno + errores.
- `/api/usgs`: sólo lee lo guardado (responde en milisegundos). Sólo consulta USGS si todavía no hay nada guardado (recién publicado).
- Consumo: 26 pedidos por ronda ≈ 104 por hora, independiente de cuántas personas abran la página.

## Qué se verificó que no se rompe
Estaciones (mismos 26 IDs), coordenadas (fijas), mapa (usa el catálogo), series (misma forma `[epoch ms, cfs]` horaria), valor actual (último punto), timestamps (UTC, sin duplicados por hora). Históricos de ríos: el monitor sólo muestra 7 días; no había históricos de USGS que migrar.

## Pendiente de confirmar en producción
Desde el entorno de desarrollo no se puede consultar `api.waterdata.usgs.gov` (bloqueado por robots/red). El formato se tomó del esquema publicado (`time`, `value`, `unit_of_measure`). Si algo difiere, la pestaña Ríos muestra el error exacto.
