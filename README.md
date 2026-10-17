# lluvia-cuenca

Lluvia acumulada y pronosticada sobre la **cuenca alta** de una quebrada, no en un punto. En la costa, las quebradas pasan secas casi todo el año y los huaicos los activa la lluvia intensa **aguas arriba**, a veces mientras abajo no llueve.

Piloto: **Huaycoloro** y su afluente **Río Seco (Jicamarca)**, en Lima Este. Son las dos quebradas con sensores del IGP que hoy transmiten ([`igp-huaicos`](https://github.com/osrcmap/igp-huaicos)). Forma parte del conjunto para El Niño 2026-2027.

> **Lluvia estimada por modelos, sin umbral calibrado.** Muestra cuánto llovió y cuánto se pronostica sobre la cuenca; no dice si la quebrada se activará. Para avisos oficiales: SENAMHI ([`avisos-pe`](https://github.com/osrcmap/avisos-pe)) e IGP.

## Uso

```bash
npm i -g @osrcmap/lluvia-cuenca

lluvia-cuenca cuencas
lluvia-cuenca cuencas --lat -11.85 --lon -76.76     # ¿en qué cuenca piloto está este punto?
lluvia-cuenca lluvia huaycoloro
```

```text
Quebrada Huaycoloro (hasta su llegada al Rímac) — 486 km², 300–4229 m
Lluvia estimada (Open-Meteo), promedio sobre la cuenca, al 2026-10-17 10:00 UTC:
  última hora: 0 mm · últimas 6 h: 0 mm · 24 h: 0.6 mm (máx. 0.2 mm/h) · 72 h: 0.7 mm
  próximas 6 h: 0 mm · 24 h: 0.3 mm (máx. 0.1 mm/h) · 48 h: 1.9 mm
  celda más lluviosa en las últimas 24 h: 4.6 mm
  13 celdas de modelo, 6 con centro fuera de la cuenca
```

`--json` (por defecto si stdout no es una terminal) da cada ventana como `{ mm, max_mm_h, horas, completo }`. `completo: false` significa que faltó algún dato del modelo. También informa las celdas del modelo usadas (posición, altura y si su centro está dentro de la cuenca) y la fuente, con atribución.

## Cómo se calcula

1. **Cuenca** (`data/cuencas.geojson`, precalculada con `scripts/delinear/`). Se usa el **Copernicus DEM GLO-30** con pysheds: relleno de sumideros y depresiones, dirección de flujo D8, acumulación y cuenca aguas arriba de la salida. La salida es la celda de cauce más cercana al punto de referencia del INGEMMET, dentro de un rango de área que la mantiene en el cauce principal: ni una cárcava lateral ni el Rímac.
   - **Validación:** Huaycoloro da 486.0 km² y 300–4,229 m de altitud. La referencia publicada (tesis UNMSM) es 492.9 km² y 250–4,230 m.
2. **Lluvia:** una grilla de puntos cada ~5.5 km dentro de la cuenca (17 en Huaycoloro) se consulta a Open-Meteo en una sola llamada. Cada celda del modelo pesa según cuántos puntos de la cuenca caen en ella (≈ área). Se suman las ventanas de 1, 6, 24 y 72 h pasadas y de 6, 24 y 48 h futuras, cortando en la última hora completa.

Detalles y decisiones en [`RESEARCH.md`](RESEARCH.md); límites en [`LIMITATIONS.md`](LIMITATIONS.md).

## Agregar una cuenca

Edita `scripts/delinear/puntos.json`: punto de referencia, rango de área del cauce (`area_min_km2`, `area_max_km2`), radio y área de referencia si existe. Luego:

```bash
python -m venv venv && venv/bin/pip install -r scripts/delinear/requirements.txt
# Mosaicos Copernicus de la zona en una carpeta, p. ej.:
# https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S12_00_W077_00_DEM/Copernicus_DSM_COG_10_S12_00_W077_00_DEM.tif
venv/bin/python scripts/delinear/delinear.py --dem-dir <carpeta> --salida data/cuencas.geojson
```

El script falla si la cuenca toca el borde de la ventana o si el cauce está demasiado lejos del punto. Revisa siempre el área contra una referencia.

## Desarrollo

```bash
bun install
bun test        # cuencas vs. referencia, agregación con series sintéticas, CLI con una respuesta real de Open-Meteo
bun run typecheck && bun run lint
bun run build && node scripts/humo.mjs
```

## Licencias y atribución

- Código: MIT.
- Cuencas: derivadas del Copernicus DEM GLO-30, © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y la ESA.
- Lluvia: [Open-Meteo.com](https://open-meteo.com), CC BY 4.0, promediada por lluvia-cuenca.
