# Metodología y auditoría de cálculos

## Temporadas (no es enero–diciembre)
| Concepto | Definición | Fuente |
|---|---|---|
| Año hidrológico (water year) | 1-oct → 30-sep, nombrado por el año en que termina (WY2026 = oct-2025…sep-2026) | USGS, NRCS, USBR |
| Precipitación acumulada SNOTEL (PREC) | vuelve a 0 el 1-oct | NRCS |
| Temporada de acumulación de nieve | ≈ oct → abr (pico mediano Cuenca Alta: fines de marzo a principios de mayo según altura) | NRCS (timing de cada estación) |
| Temporada de escurrimiento | abr → jul (el pronóstico de Powell es volumen abril–julio) | NRCS/CBRFC |
| Año calendario | sólo para rotular fechas | — |

Fechas: NRCS y USBR publican fechas locales ("YYYY-MM-DD"); se comparan como texto, nunca se convierten de zona. USGS trae hora con zona y se pasa a UTC.

## Nieve y precipitación (pestaña "Nieve y lluvia")
- **SWE** (WTEQ): agua almacenada como nieve. **Altura de nieve** (SNWD): sólo informativa. **Precipitación** (PREC): todo lo que cayó (lluvia + nieve) en agua equivalente desde el 1-oct. SNOTEL no separa lluvia de nieve: no se muestra "lluvia" por separado.
- % de la mediana de la cuenca = Σ valores / Σ medianas 1991–2020 (NRCS) de las estaciones con ambos datos. Si la mediana promedio es < 1 pulgada (fuera de temporada) el % no se calcula.
- 7 y 30 días: diferencia de la precipitación acumulada (cruzando el 1-oct correctamente). La normal de la ventana usa el **promedio** diario de NRCS (lineal: diferencia de promedios = promedio de la ventana). La mediana no es lineal y no se usa para ventanas. % sólo si el promedio de la ventana es ≥ 0,2".

## Aporte abril–julio
1. **Pronóstico oficial** NRCS/CBRFC (Lake Powell Inflow, `09379900:AZ:USGS`): se muestra tal cual, con 90 % / 50 % / 10 % de excedencia y la normal NRCS.
2. **Estimación del monitor** (no oficial), reproducible:
   - Fecha de comparación: hoy (día/mes) entre 1-oct y 1-abr; fuera de eso, 1-abr sólo como referencia.
   - Por año 1991 → último completo: SWE y PREC de cada SNOTEL de la Cuenca Alta en esa fecha.
   - Índice del año = promedio de (valor ÷ promedio histórico de esa estación en esa fecha); estaciones con ≥ 80 % de los años y promedio ≥ 0,5".
   - y = volumen abril–julio no regulado de Powell (USBR HDB 919/34, sólo años con ≥ 118 de 122 días).
   - Regresiones lineales y~SWE, y~PREC, y~SWE+PREC. Se informa r, R², R² de validación (dejando un año afuera) y error típico; se elige la de menor error fuera de muestra.
   - Escenarios: central ± 1,2816 × error de validación (≈ 10 %–90 %), sin negativos. Comparación con mediana, promedio, p10, p90, mínimo y máximo 1991–2020.
   - No se usan temperatura ni humedad del suelo (el oficial sí). El estado de los embalses no aplica: el volumen es no regulado.
3. **Confianza** (reglas fijas): 🔴 insuficiente fuera de 1-oct→1-abr, cobertura < 50 % o R² validación < 0,30. Si no, puntos: cobertura ≥ 80 % (+1); R² val ≥ 0,7 (+2) / ≥ 0,5 (+1); dentro del rango histórico (+1) o extrapolación (−1); ≤ 45 días al 1-abr (+1), > 90 días (−1); < 25 años (−1). 🟢 ≥ 4, 🟡 2–3, 🟠 ≤ 1.

## Lo que viene (pronósticos)
- **10 días** (Open-Meteo, modelos globales, no oficial): `snowfall_sum` (cm de nieve nueva, altura) y `precipitation_sum` (mm de agua, incluye la nieve) en las 3 SNOTEL más altas de cada subcuenca de la Cuenca Alta, usando su altura real para corregir la temperatura. Promedio por subcuenca. No se suman nieve y precipitación.
- **3 meses** (NOAA CPC, oficial): se consultan los polígonos de las perspectivas de precipitación y temperatura (servicio ArcGIS de NOAA) para 4 períodos y se ubica el punto central de 5 zonas nevadas. CPC dibuja contornos 33/40/50/60… %: el valor es el límite inferior del rango. Fuera de todo polígono o "EC" = igual probabilidad. Son probabilidades de caer en el tercio superior/inferior, no cantidades.
- Ninguno de los dos entra en la "Estimación del monitor" (que usa sólo lo medido).

## "Alertas"
El monitor no emite alertas. Hay dos cosas distintas y así se rotulan:
- **Estado relativo histórico** (propio): "Vs. historia" de embalses, colores de nieve vs. mediana. Clasificación estadística.
- **Referencias oficiales**: niveles de USBR en Powell (3.700 / 3.525 / 3.490 / 3.370 ft) y Mead (1.229 / 1.075 / 1.050 / 1.025 / 950 / 895 ft). Los de escasez de Mead (Guías Interinas 2007) se aplican con la proyección de agosto del 24-Month Study, no con la cota diaria; esas guías cubren hasta 2026.

## Auditoría de cálculos
| Cálculo | Estado | Cambio |
|---|---|---|
| cfs → acre-feet | 1 cfs·día = 86.400 ft³ / 43.560 = 1,983471 af ✔ | — |
| cfs → m³/s | × 0,028316846592 ✔ | — |
| ft → m | × 0,3048 ✔ · af → hm³ × 0,001233481837548 ✔ · in → mm × 25,4 ✔ | — |
| % almacenamiento | almacenamiento / capacidad; sin capacidad → "—" (no división por cero) ✔ | Capacidad de USBR o NRCS según disponibilidad |
| Promedio 7 d (embalses) | promedio simple de 7 caudales medios diarios ✔ | Ahora se marca **parcial** si faltan días |
| Promedio 7 d (ríos) | promedio de lecturas horarias (último valor de cada hora) | Rotulado así, con horas disponibles |
| Volumen 30 d | **Se extrapolaba** a 30 días si faltaban días | Corregido: suma sin extrapolar, **parcial** con días/30, < 80 % → sin datos |
| Balance 30 d | restaba volúmenes con coberturas distintas | Corregido: sólo días con entrada y salida |
| Entrada estimada | media móvil 7 d **y** después promedio 7 d (ventana efectiva ~13 días) y recorte a ≥ 0 (sesgo) | Corregido: estimación diaria sin recortar; media móvil sólo para el gráfico; marcada **estimado** |
| Cambio de almacenamiento | diferencia contra el dato de hace n días con tolerancia 2 días ✔ | — |
| Medianas / percentiles | mismo día ±3 días, excluyendo el último año, mínimo 5 años ✔ | — |
| Timestamps duplicados | se conserva el último por fecha (USBR) o por hora (USGS) ✔ | — |
| Valores negativos | USGS: se descartan valores sin dato; entrada estimada negativa se conserva y se marca | — |
| SWE / precipitación | % sólo con mediana significativa; ventanas cruzando el 1-oct correctas | Nuevo |

Rótulos de calidad en la interfaz: sin marca = **real**, `parcial`, `estimado`, `sin datos`.
