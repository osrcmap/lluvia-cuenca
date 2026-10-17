# Investigación

Decisiones del piloto (17 de octubre de 2026).

## Cuencas: por qué Copernicus DEM y no HydroBASINS

- **HydroBASINS** (HydroSHEDS v1) tiene subcuencas globales con enlaces aguas abajo, ideal para agregar la cuenca de un punto. Pero su licencia (Anexo A del documento técnico v1.4) exige que la redistribución a usuarios finales vaya con un acuerdo de licencia "al menos igual de protector". Eso no encaja con un paquete abierto en npm.
- **Copernicus DEM GLO-30** permite usar y redistribuir productos derivados con atribución. Mosaicos públicos en `https://copernicus-dem-30m.s3.amazonaws.com/` (1°×1°, ~35-40 MB cada uno). Para Lima Este bastan `S12_00_W077_00` y `S13_00_W077_00`.
- **pysheds 0.5** (MIT) hace el procesamiento hidrológico estándar. Requiere NumPy < 2.4 (usa `np.in1d`, eliminado en 2.4).

## Lo que salió mal antes de salir bien (para no repetirlo)

1. **Umbral de cauce bajo (1 km²):** la salida de Huaycoloro se ajustó a una cárcava lateral → 7.7 km².
2. **Celda equivocada:** convertir celda a coordenada con `catchment(snap="corner")` (el valor por defecto) cayó en la celda vecina → 0 km². Se usa `snap_to_mask` + `catchment(snap="center")`.
3. **Saltar al río principal:** el punto del INGEMMET para Huaycoloro está en la confluencia, a 31 m del Rímac. Con solo un mínimo de área, la salida cayó en el Rímac → 1,428 km² (recortado por la ventana). Se agregó un máximo de área por quebrada (`area_max_km2`).
4. **Validación:** el área se compara con una referencia publicada antes de aceptar el resultado. Huaycoloro: 486.0 km² contra 492.9 km² (tesis UNMSM), con cota máxima 4,229 m contra 4,230 m publicados.

## Lluvia: por qué Open-Meteo (por ahora)

| Fuente | Ventaja | Problema |
|---|---|---|
| **Open-Meteo** (elegida) | Sin clave, CC BY 4.0, pasado y pronóstico en una llamada, varios puntos a la vez | Modelo, no observación; celdas de ~7-9 km |
| GPM IMERG (NASA) | Satélite, ~10 km, casi tiempo real | Requiere cuenta de NASA Earthdata y procesar HDF5/GeoTIFF |
| Estaciones SENAMHI | Medición real | Pocas en la cuenca; el SENAMHI no responde desde servidores fuera del Perú; datos en HTML |
| PISCO | Grilla calibrada para el Perú | Histórica, no en tiempo real |

Open-Meteo ajusta cada punto pedido a su grilla (p. ej. -11.9, -76.85 → -11.916, -76.924). Por eso se agrupan los puntos por celda y se pondera.

## Pendiente

- **Umbrales:** cruzar la lluvia histórica sobre la cuenca (PISCO o IMERG) con las activaciones registradas de Huaycoloro (IGP desde 2023; INGEMMET: 1983, 1998, 2017, 2023) para estimar cuánta lluvia la activa.
- **IMERG** como segunda fuente (necesita una cuenta de NASA Earthdata).
- **Estaciones del SENAMHI** en la cuenca o cerca, corriendo desde el Perú.
- Más cuencas: zonas críticas por flujo de Lima Este, Piura (quebrada Limón, con sensor del IGP) y la costa norte.
- Integrar en `riesgo-punto` (cuenca que contiene el punto o quebrada cercana → lluvia en su cuenca alta).
