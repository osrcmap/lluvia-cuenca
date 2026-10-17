// Lluvia horaria de Open-Meteo sobre los puntos de una cuenca, promediada por celda de modelo.
import { z } from "zod";
import { type Cuenca, contiene } from "./cuencas.js";
import { fallo } from "./errores.js";
import { type OpcionesHttp, pedir } from "./http.js";

export const BASE_OPENMETEO = process.env.LLUVIA_CUENCA_OPENMETEO_BASE || "https://api.open-meteo.com";
export const DIAS_PASADOS = 3;
export const DIAS_FUTUROS = 3;

export const urlOpenMeteo = (puntos: [number, number][]) =>
  `${BASE_OPENMETEO}/v1/forecast?latitude=${puntos.map((p) => p[0]).join(",")}&longitude=${puntos
    .map((p) => p[1])
    .join(",")}&hourly=precipitation&past_days=${DIAS_PASADOS}&forecast_days=${DIAS_FUTUROS}&timezone=GMT`;

const Ubicacion = z.looseObject({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().nullable().optional(),
  hourly: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)).min(1),
    precipitation: z.array(z.number().min(0).nullable()),
  }),
});
type Ubicacion = z.infer<typeof Ubicacion>;

/** Open-Meteo responde un objeto con una ubicación o un arreglo con varias. */
export function leerRespuesta(json: unknown, esperadas: number): Ubicacion[] {
  const lista = Array.isArray(json) ? json : [json];
  const r = z.array(Ubicacion).length(esperadas).safeParse(lista);
  if (!r.success) throw fallo("FORMATO_INESPERADO", `Open-Meteo: ${z.prettifyError(r.error).slice(0, 300)}`);
  for (const u of r.data) {
    if (u.hourly.time.length !== u.hourly.precipitation.length) {
      throw fallo("FORMATO_INESPERADO", "Open-Meteo: series de tiempo y lluvia de distinto largo.");
    }
  }
  return r.data;
}

export type Celda = {
  lat: number;
  lon: number;
  elevacion_m: number | null;
  puntos: number;
  serie: (number | null)[];
};

/** Agrupa los puntos por celda de modelo (varios puntos pueden caer en la misma celda). */
export function celdas(ubicaciones: Ubicacion[]): { tiempos: number[]; celdas: Celda[] } {
  const tiempos = ubicaciones[0].hourly.time.map((t) => Date.parse(`${t}:00Z`));
  const porCelda = new Map<string, Celda>();
  for (const u of ubicaciones) {
    if (u.hourly.time.length !== tiempos.length || Date.parse(`${u.hourly.time[0]}:00Z`) !== tiempos[0]) {
      throw fallo("FORMATO_INESPERADO", "Open-Meteo: las ubicaciones tienen horarios distintos.");
    }
    const k = `${u.latitude},${u.longitude}`;
    const c = porCelda.get(k);
    if (c) c.puntos++;
    else {
      porCelda.set(k, {
        lat: u.latitude,
        lon: u.longitude,
        elevacion_m: u.elevation ?? null,
        puntos: 1,
        serie: u.hourly.precipitation,
      });
    }
  }
  return { tiempos, celdas: [...porCelda.values()] };
}

/** Promedio ponderado por el número de puntos de la cuenca en cada celda (≈ área). null si falta algún dato. */
export function promedio(cs: Celda[], i: number): number | null {
  let suma = 0;
  let peso = 0;
  for (const c of cs) {
    const v = c.serie[i];
    if (v === null || v === undefined) return null;
    suma += v * c.puntos;
    peso += c.puntos;
  }
  return suma / peso;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Suma de la lluvia horaria en (desde, hasta]. Open-Meteo asigna a la hora T la lluvia de la hora previa,
 * así que "últimas 6 h" a las 10:00 son las horas 05:00..10:00 excluyendo la de las 04:00.
 */
function ventana(tiempos: number[], serie: (number | null)[], desde: number, hasta: number) {
  let suma = 0;
  let maxHora = 0;
  let faltan = 0;
  let horas = 0;
  tiempos.forEach((t, i) => {
    if (t <= desde || t > hasta) return;
    horas++;
    const v = serie[i];
    if (v === null) faltan++;
    else {
      suma += v;
      maxHora = Math.max(maxHora, v);
    }
  });
  return { mm: r1(suma), max_mm_h: r1(maxHora), horas, completo: faltan === 0 && horas > 0 };
}

const H = 3_600_000;

export function resumir(c: Cuenca, tiempos: number[], cs: Celda[], momento: number) {
  if (momento < tiempos[0] + 72 * H || momento > tiempos.at(-1)! - 48 * H) {
    throw fallo(
      "FUERA_DE_RANGO",
      `Con los datos de Open-Meteo (${new Date(tiempos[0]).toISOString()} a ${new Date(tiempos.at(-1)!).toISOString()}) no se pueden calcular las 72 h previas y 48 h siguientes a ${new Date(momento).toISOString()}.`,
    );
  }
  const media = tiempos.map((_, i) => promedio(cs, i));
  // Hora completa más reciente (Open-Meteo la marca al final de la hora).
  const ahora = Math.floor(momento / H) * H;
  const v = (desde: number, hasta: number) => ventana(tiempos, media, desde, hasta);
  const maxCelda = (desde: number, hasta: number) => {
    const porCelda = cs.map((x) => ({
      lat: x.lat,
      lon: x.lon,
      mm: ventana(tiempos, x.serie, desde, hasta).mm,
    }));
    return porCelda.reduce((a, b) => (b.mm > a.mm ? b : a));
  };
  return {
    momento: new Date(momento).toISOString(),
    hora_de_corte: new Date(ahora).toISOString(),
    lluvia_mm: {
      ultima_hora: v(ahora - H, ahora),
      ultimas_6h: v(ahora - 6 * H, ahora),
      ultimas_24h: v(ahora - 24 * H, ahora),
      ultimas_72h: v(ahora - 72 * H, ahora),
      proximas_6h: v(ahora, ahora + 6 * H),
      proximas_24h: v(ahora, ahora + 24 * H),
      proximas_48h: v(ahora, ahora + 48 * H),
    },
    maximo_por_celda_mm: {
      ultimas_24h: maxCelda(ahora - 24 * H, ahora),
      proximas_24h: maxCelda(ahora, ahora + 24 * H),
    },
    celdas_modelo: cs.map((x) => ({
      lat: x.lat,
      lon: x.lon,
      elevacion_m: x.elevacion_m,
      puntos_de_la_cuenca: x.puntos,
      centro_dentro_de_la_cuenca: contiene(c, x.lat, x.lon),
    })),
  };
}

export async function consultar(c: Cuenca, puntos: [number, number][], o: OpcionesHttp) {
  const r = await pedir(urlOpenMeteo(puntos), o);
  let json: unknown;
  try {
    json = JSON.parse(r.cuerpo);
  } catch (e) {
    throw fallo("FORMATO_INESPERADO", "Open-Meteo no devolvió JSON.", e);
  }
  if ((json as { error?: boolean })?.error) {
    throw fallo("FORMATO_INESPERADO", `Open-Meteo: ${(json as { reason?: string }).reason ?? "error"}`);
  }
  return { ...celdas(leerRespuesta(json, puntos.length)), obtenido_en: r.obtenido_en, cuenca: c };
}
