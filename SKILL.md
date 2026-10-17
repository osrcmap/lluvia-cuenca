---
name: lluvia-cuenca
description: Lluvia acumulada (últimas 1-72 h) y pronosticada (próximas 6-48 h) sobre la cuenca alta de quebradas piloto en Lima Este (Huaycoloro, Río Seco de Jicamarca). Úsalo cuando pregunten cuánto llovió o va a llover aguas arriba de esas quebradas, como contexto de riesgo de huaico.
---

# lluvia-cuenca

```bash
lluvia-cuenca cuencas --json                          # (antepone npx @osrcmap/ si no está instalado)
lluvia-cuenca cuencas --lat <lat> --lon <lon> --json  # cuencas que contienen un punto
lluvia-cuenca lluvia huaycoloro --json
```

## Cómo responder

- Da las cantidades (mm) con su ventana de tiempo y aclara que son **estimaciones de modelo** (Open-Meteo), no mediciones.
- **No** digas que la quebrada "se va a activar" ni "no se va a activar": no hay umbral calibrado.
- Si `completo` es `false` en una ventana, faltan datos: dilo.
- Complementa con `igp-huaicos quebrada <nombre>` (sensores en vivo) y `avisos-pe punto` (avisos oficiales).
- Atribuye: "Datos de lluvia: Open-Meteo.com (CC BY 4.0)".

## Errores

`FUENTE_NO_DISPONIBLE` / `FORMATO_INESPERADO`: no hay datos; no significa que no llueva. `FUERA_DE_RANGO`: el `--momento` necesita 72 h de datos antes y 48 h después.
