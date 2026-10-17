# Limitaciones

## Lluvia

- **Es modelo, no medición.** Open-Meteo combina modelos numéricos (*best_match*). Las horas pasadas son pronósticos/análisis archivados, no lo que midió una estación o un satélite.
- **Resolución gruesa:** celdas de ~7-9 km. Huaycoloro (486 km²) cae en 13 celdas, 6 con su centro fuera de la cuenca. Una tormenta localizada sobre una quebrada pequeña puede no verse.
- **Relieve:** la altura de cada celda del modelo (`elevacion_m`) puede diferir mucho del terreno real. La lluvia orográfica de la cuenca alta (hasta 4,229 m) puede quedar subestimada.
- **Sin umbral calibrado.** No sabemos cuántos mm en cuántas horas activan Huaycoloro. Por eso no hay "nivel" ni alerta: solo cantidades.
- **La hora en curso** (incompleta) cuenta como pronóstico, no como lluvia pasada.
- **Uso de Open-Meteo:** la API gratuita es para uso no comercial y tiene límites diarios. Un servicio con muchos usuarios debe cachear (lluvia-cuenca cachea 15 minutos) o contratar su plan.

## Cuencas

- **Solo dos cuencas piloto** (Huaycoloro y Río Seco de Jicamarca). Las demás zonas críticas no tienen cuenca aún.
- Delineadas con un DEM de 30 m. En el tramo urbano (San Juan de Lurigancho) el cauce canalizado puede no coincidir con el del DEM: la salida de Huaycoloro quedó ajustada a 1.1 km del punto del INGEMMET, en la confluencia con el Rímac.
- **Río Seco:** identificado como el afluente de ~193 km² más cercano a la zona crítica del INGEMMET y a las estaciones del IGP en Jicamarca. Falta confirmarlo con el IGP.
- La validación de área usa una sola referencia (tesis UNMSM, 492.9 km²).
- Polígonos simplificados a ~55 m para que el archivo sea liviano.

## Uso

- No es una alerta ni una orden de evacuación. Combínalo con los avisos del SENAMHI y el monitoreo del IGP.
