# Río Colorado (EE.UU.) — Monitor de la cuenca

Página web con el estado de toda la cuenca del río Colorado: embalses (% de capacidad, volumen, cota, cuánto entra y cuánto sale), totales de la cuenca, Powell y Mead con sus niveles críticos, y caudales de los ríos.

## Fuentes (todas oficiales y públicas)
- **USBR hydrodata** (Bureau of Reclamation): almacenamiento, entrada, salida y cota diarios de ~46 embalses. `/api/usbr/<sitio>`
- **NRCS AWDB** (USDA): lista completa de embalses de las cuencas HUC 14 y 15 con capacidad útil y almacenamiento diario (suma Granby, Dillon, Ruedi, Salt, Verde, San Carlos, etc.). `/api/basin`
- **USGS**: caudal en tiempo real de 26 estaciones. `/api/usgs`. Una función programada (`usgs-refresh`, cada 15 min) guarda el último dato bueno en Netlify Blobs; si USGS se cae (p. ej. HTTP 503) la página muestra ese dato marcado como viejo. Si falla el servicio clásico, se usa la API nueva de USGS como respaldo.

Las funciones de Netlify hacen de proxy y dejan las respuestas cacheadas en el CDN (USBR 1 h, NRCS 3 h, USGS 15 min).

## Publicar en Netlify
1. Crear un repositorio nuevo en GitHub y subir el contenido de esta carpeta.
2. Netlify → *Add new project → Import an existing project → GitHub* → elegir el repo. La configuración sale de `netlify.toml`.
3. Deploy. No hace falta ninguna variable de entorno. Opcional: `USGS_API_KEY` (gratis en api.waterdata.usgs.gov) sube el límite de la API nueva de USGS.

> Arrastrar y soltar la carpeta en Netlify **no sirve**: no publica las funciones.

## Tests
`npm test`. `npm run build` corre los tests antes de compilar.

## Pendiente conocido
USGS da de baja `waterservices.usgs.gov` en el 1er trimestre de 2027; antes hay que pasar `netlify/functions/usgs.mts` a `api.waterdata.usgs.gov`.
