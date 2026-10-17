// Cuencas precalculadas (scripts/delinear) y puntos de muestreo dentro de cada una.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import pointOnFeature from "@turf/point-on-feature";
import { z } from "zod";
import { fallo } from "./errores.js";

// Relativo a src/ y a dist/: ambos están un nivel debajo de la raíz del paquete.
export const RUTA_CUENCAS = fileURLToPath(new URL("../data/cuencas.geojson", import.meta.url));

const Cuenca = z.object({
  type: z.literal("Feature"),
  id: z.string(),
  geometry: z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.any()) }),
  properties: z.looseObject({
    id: z.string(),
    nombre: z.string(),
    area_km2: z.number().positive(),
    cota_min_m: z.number(),
    cota_max_m: z.number(),
    salida: z.object({ lat: z.number(), lon: z.number(), ajuste_m: z.number() }),
    punto_de_referencia: z.string(),
    igp_estaciones: z.array(z.string()),
    igp_quebrada: z.string().nullable(),
  }),
});
export type Cuenca = z.infer<typeof Cuenca>;

const Coleccion = z.object({
  type: z.literal("FeatureCollection"),
  metadata: z.looseObject({ dem: z.string(), metodo: z.string() }),
  features: z.array(Cuenca).min(1),
});

export function cargarCuencas(ruta = RUTA_CUENCAS) {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(ruta, "utf8"));
  } catch (e) {
    throw fallo("DATOS_INVALIDOS", `No se pudo leer ${ruta}.`, e);
  }
  const r = Coleccion.safeParse(json);
  if (!r.success) throw fallo("DATOS_INVALIDOS", `${ruta}: ${z.prettifyError(r.error).slice(0, 300)}`);
  return r.data;
}

/** Espaciado de la grilla de muestreo (~5.5 km): menor que las celdas de Open-Meteo (~7-9 km). */
export const PASO_GRADOS = 0.05;

/**
 * Puntos dentro de la cuenca en una grilla regular, más un punto interior garantizado.
 * Cada punto representa la misma área, así que sirven de peso al promediar.
 */
export function puntosDeMuestreo(c: Cuenca, paso = PASO_GRADOS): [number, number][] {
  const [oeste, sur, este, norte] = bbox(c);
  const puntos: [number, number][] = [];
  for (let lat = sur + paso / 2; lat < norte; lat += paso) {
    for (let lon = oeste + paso / 2; lon < este; lon += paso) {
      if (booleanPointInPolygon([lon, lat], c)) puntos.push([+lat.toFixed(4), +lon.toFixed(4)]);
    }
  }
  if (!puntos.length) {
    const [lon, lat] = pointOnFeature(c).geometry.coordinates;
    puntos.push([+lat.toFixed(4), +lon.toFixed(4)]);
  }
  return puntos;
}

export const contiene = (c: Cuenca, lat: number, lon: number) => booleanPointInPolygon([lon, lat], c);
