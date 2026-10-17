// GET con timeout, reintentos y caché en disco (para no saturar a Open-Meteo cuando muchos consultan).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { fallo } from "./errores.js";
import { atomicWrite } from "./foundation/atomic-write.js";

export const DIR_CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "lluvia-cuenca");

export type OpcionesHttp = {
  /** Segundos que una respuesta en caché se considera válida. 0 desactiva la caché. */
  cacheSegundos: number;
  timeoutMs?: number;
  intentos?: number;
};

export type Respuesta = { cuerpo: string; obtenido_en: string; url: string };

const ruta = (url: string) => join(DIR_CACHE, `${createHash("sha256").update(url).digest("hex")}.json`);

function deCache(url: string, segundos: number): Respuesta | null {
  if (segundos <= 0) return null;
  try {
    const r: Respuesta = JSON.parse(readFileSync(ruta(url), "utf8"));
    return r.url === url && Date.now() - Date.parse(r.obtenido_en) < segundos * 1000 ? r : null;
  } catch {
    return null;
  }
}

function aCache(r: Respuesta) {
  try {
    atomicWrite(ruta(r.url), JSON.stringify(r));
  } catch {
    // Sin caché no pasa nada: solo se vuelve a consultar.
  }
}

export async function pedir(url: string, o: OpcionesHttp): Promise<Respuesta> {
  const cacheada = deCache(url, o.cacheSegundos);
  if (cacheada) return cacheada;
  const intentos = o.intentos ?? 3;
  let ultimo: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": `lluvia-cuenca/${pkg.version} (+https://github.com/osrcmap/lluvia-cuenca)` },
        signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = { cuerpo: await res.text(), obtenido_en: new Date().toISOString(), url };
      aCache(r);
      return r;
    } catch (e) {
      ultimo = e;
      if (i < intentos) await new Promise((ok) => setTimeout(ok, 1500 * i));
    }
  }
  const motivo = ultimo instanceof Error ? ultimo.message : String(ultimo);
  throw fallo("FUENTE_NO_DISPONIBLE", `No se pudo obtener ${url} (${motivo}).`, ultimo);
}

export async function pedirJson(url: string, o: OpcionesHttp): Promise<{ json: any; obtenido_en: string }> {
  const r = await pedir(url, o);
  try {
    return { json: JSON.parse(r.cuerpo), obtenido_en: r.obtenido_en };
  } catch (e) {
    throw fallo("FORMATO_INESPERADO", `${url} no devolvió JSON.`, e);
  }
}

/** Ejecuta `fn` sobre cada elemento con a lo más `n` en paralelo, conservando el orden. */
export async function enParalelo<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  const trabajador = async () => {
    while (i < xs.length) {
      const j = i++;
      out[j] = await fn(xs[j]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, trabajador));
  return out;
}
