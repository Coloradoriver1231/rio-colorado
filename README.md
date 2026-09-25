# Río Colorado (EE.UU.) — Monitor de la cuenca

Página web con el estado de toda la cuenca del río Colorado: embalses (% de capacidad, volumen, cota, cuánto entra y cuánto sale), totales de la cuenca, Powell y Mead con sus niveles críticos, y caudales de los ríos.

## Fuentes (todas oficiales y públicas)
- **USBR hydrodata** (Bureau of Reclamation): almacenamiento, entrada, salida y cota diarios de ~46 embalses. `/api/usbr/<sitio>`
- **NRCS AWDB** (USDA): lista completa de embalses de las cuencas HUC 14 y 15 con capacidad útil y almacenamiento diario (suma Granby, Dillon, Ruedi, Salt, Verde, San Carlos, etc.). `/api/basin`
- **USGS** Water Data API (OGC v1, respaldo v0; el servicio viejo sólo hasta su baja el 22-feb-2027): caudal de 26 estaciones. `/api/usgs`. La función programada `usgs-refresh` (cada 15 min) guarda el último dato bueno en Netlify Blobs; si USGS se cae la página lo muestra marcado como viejo.

Las funciones de Netlify hacen de proxy y dejan las respuestas cacheadas en el CDN (USBR 1 h, NRCS 3 h, USGS 15 min).

- **Nieve y lluvia**: NRCS SNOTEL (SWE, precipitación, normales 1991–2020) + pronóstico oficial abril–julio de Powell (NRCS/CBRFC) + "Estimación del monitor" (regresión documentada en `docs/METODOLOGIA.md`). `/api/snow`, con funciones programadas `snow-refresh` (cada 3 h) y `snow-model` (1 vez por día).

Documentación: `docs/USGS-MIGRACION.md` (paso de WaterServices a la API nueva) y `docs/METODOLOGIA.md` (temporadas, estimación, confianza y auditoría de cálculos).

## Publicar en Netlify
1. Crear un repositorio nuevo en GitHub y subir el contenido de esta carpeta.
2. Netlify → *Add new project → Import an existing project → GitHub* → elegir el repo. La configuración sale de `netlify.toml`.
3. Deploy. No hace falta ninguna variable de entorno. Opcional: `USGS_API_KEY` (gratis en api.waterdata.usgs.gov) sube el límite de la API nueva de USGS.

> Arrastrar y soltar la carpeta en Netlify **no sirve**: no publica las funciones.

## Tests
`npm test`. `npm run build` corre los tests antes de compilar.

