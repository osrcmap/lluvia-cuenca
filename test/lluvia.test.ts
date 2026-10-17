import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargarCuencas, contiene, puntosDeMuestreo } from "../src/cuencas.js";
import { celdas, leerRespuesta, promedio, resumir } from "../src/lluvia.js";

const cuencas = cargarCuencas();
const huaycoloro = cuencas.features.find((c) => c.id === "huaycoloro")!;
const rioSeco = cuencas.features.find((c) => c.id === "rio-seco-jicamarca")!;

describe("cuencas delineadas", () => {
  test("Huaycoloro coincide con la referencia publicada (492.9 km², 250-4230 m)", () => {
    const p = huaycoloro.properties;
    expect(Math.abs(p.area_km2 - 492.9) / 492.9).toBeLessThan(0.05);
    expect(Math.abs(p.cota_max_m - 4230)).toBeLessThan(50);
    expect(p.cota_min_m).toBeLessThan(400);
  });

  test("Río Seco es un afluente: más pequeño y con su salida dentro de Huaycoloro", () => {
    expect(rioSeco.properties.area_km2).toBeLessThan(huaycoloro.properties.area_km2);
    expect(contiene(huaycoloro, rioSeco.properties.salida.lat, rioSeco.properties.salida.lon)).toBe(true);
  });

  test("puntos de muestreo: todos dentro de la cuenca, ~1 cada 30 km²", () => {
    const ps = puntosDeMuestreo(huaycoloro);
    expect(ps.every(([lat, lon]) => contiene(huaycoloro, lat, lon))).toBe(true);
    expect(ps.length).toBeGreaterThan(10);
    expect(ps.length).toBeLessThan(30);
  });
});

// Serie sintética: 2 celdas, una con 3 puntos de la cuenca y otra con 1 (pesos 3 y 1).
const H = 3_600_000;
const T0 = Date.parse("2026-10-14T00:00:00Z");
const horas = 144; // 3 días pasados + 3 futuros
const ubic = (lat: number, lon: number, f: (i: number) => number | null) => ({
  latitude: lat,
  longitude: lon,
  elevation: 1000,
  hourly: {
    time: Array.from({ length: horas }, (_, i) => new Date(T0 + i * H).toISOString().slice(0, 16)),
    precipitation: Array.from({ length: horas }, (_, i) => f(i)),
  },
});
const A = (i: number) => (i >= 70 && i <= 72 ? 2 : 0); // 2 mm/h en las horas 70, 71 y 72
const B = (i: number) => (i >= 70 && i <= 72 ? 6 : i === 80 ? 4 : 0);
const sinteticas = [
  ubic(-11.9, -76.9, A),
  ubic(-11.9, -76.9, A),
  ubic(-11.9, -76.9, A),
  ubic(-11.8, -76.8, B),
];
const MOMENTO = T0 + 72 * H + 30 * 60_000; // 72 h y media después del inicio

describe("agregación", () => {
  test("agrupa por celda y pondera por puntos de la cuenca", () => {
    const { celdas: cs } = celdas(leerRespuesta(sinteticas, 4));
    expect(cs.map((c) => c.puntos)).toEqual([3, 1]);
    expect(promedio(cs, 71)).toBe((2 * 3 + 6) / 4); // 3 mm/h
  });

  test("ventanas: la hora T trae la lluvia de la hora previa; corte en la última hora completa", () => {
    const { tiempos, celdas: cs } = celdas(leerRespuesta(sinteticas, 4));
    const r = resumir(huaycoloro, tiempos, cs, MOMENTO);
    expect(r.hora_de_corte).toBe(new Date(T0 + 72 * H).toISOString());
    expect(r.lluvia_mm.ultima_hora).toMatchObject({ mm: 3, horas: 1, completo: true });
    expect(r.lluvia_mm.ultimas_6h.mm).toBe(9); // horas 70, 71, 72
    expect(r.lluvia_mm.ultimas_6h.max_mm_h).toBe(3);
    expect(r.lluvia_mm.proximas_24h.mm).toBe(1); // hora 80: 4 mm × peso 1/4
    expect(r.maximo_por_celda_mm.ultimas_24h).toEqual({ lat: -11.8, lon: -76.8, mm: 18 });
  });

  test("un dato faltante marca la ventana como incompleta", () => {
    const conHueco = [...sinteticas.slice(0, 3), ubic(-11.8, -76.8, (i) => (i === 71 ? null : B(i)))];
    const { tiempos, celdas: cs } = celdas(leerRespuesta(conHueco, 4));
    const r = resumir(huaycoloro, tiempos, cs, MOMENTO);
    expect(r.lluvia_mm.ultimas_6h.completo).toBe(false);
    expect(r.lluvia_mm.proximas_24h.completo).toBe(true);
  });

  test("momento sin 72 h de historia → FUERA_DE_RANGO", () => {
    const { tiempos, celdas: cs } = celdas(leerRespuesta(sinteticas, 4));
    expect(() => resumir(huaycoloro, tiempos, cs, T0 + 10 * H)).toThrow(/no se pueden calcular/);
  });

  test("respuestas malformadas → FORMATO_INESPERADO", () => {
    expect(() => leerRespuesta(sinteticas, 5)).toThrow(/Open-Meteo/);
    const corta = { ...sinteticas[0], hourly: { ...sinteticas[0].hourly, precipitation: [1, 2] } };
    expect(() => leerRespuesta([corta], 1)).toThrow(/distinto largo/);
    expect(() =>
      leerRespuesta(
        [
          {
            ...sinteticas[0],
            hourly: {
              ...sinteticas[0].hourly,
              precipitation: sinteticas[0].hourly.precipitation.map(() => -1),
            },
          },
        ],
        1,
      ),
    ).toThrow();
  });

  test("una sola ubicación llega como objeto, no como arreglo", () => {
    expect(leerRespuesta(sinteticas[0], 1)).toHaveLength(1);
  });
});

// ---------- CLI contra un Open-Meteo local con una respuesta real ----------

let servidor: ReturnType<typeof Bun.serve>;
let base: string;
let caido = false;
beforeAll(() => {
  const real = readFileSync(join(import.meta.dir, "fixtures/openmeteo-huaycoloro.json"));
  servidor = Bun.serve({
    port: 0,
    fetch: (req) =>
      caido
        ? new Response("x", { status: 503 })
        : new URL(req.url).pathname === "/v1/forecast"
          ? new Response(real)
          : new Response("no", { status: 404 }),
  });
  base = `http://localhost:${servidor.port}`;
});
afterAll(() => servidor.stop(true));

async function correr(...args: string[]) {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/bin.ts"), ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LLUVIA_CUENCA_OPENMETEO_BASE: base,
      XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "lc-")),
    },
  });
  const out = (await new Response(p.stdout).text()).trim();
  return { code: await p.exited, json: JSON.parse(out) };
}

describe("cli", () => {
  test("lluvia huaycoloro con datos reales (17/10/2026)", async () => {
    caido = false;
    const { code, json } = await correr("lluvia", "huaycoloro", "--momento", "2026-10-17T10:30:00Z");
    expect(code).toBe(0);
    expect(json.cuenca).toMatchObject({ id: "huaycoloro", igp_quebrada: "Huaycoloro" });
    expect(json.celdas_modelo.length).toBe(13);
    expect(json.lluvia_mm.ultimas_72h.completo).toBe(true);
    expect(json.fuente.lluvia).toContain("Open-Meteo");
    expect(json.aviso.join(" ")).toContain("No hay un umbral calibrado");
  });

  test("un punto de Río Seco está en ambas cuencas (Río Seco es afluente de Huaycoloro)", async () => {
    const [lat, lon] = puntosDeMuestreo(rioSeco)[0];
    const { json } = await correr("cuencas", "--lat", String(lat), "--lon", String(lon));
    expect(json.cuencas.map((c: any) => c.id).sort()).toEqual(["huaycoloro", "rio-seco-jicamarca"]);
  });

  test("Open-Meteo caído → FUENTE_NO_DISPONIBLE (no 'sin lluvia')", async () => {
    caido = true;
    const { code, json } = await correr("lluvia", "huaycoloro");
    expect([code, json.code]).toEqual([1, "FUENTE_NO_DISPONIBLE"]);
    expect(json.hint).toContain("No se puede afirmar que no llueva");
  }, 30_000);

  test("cuenca inexistente → NO_ENCONTRADO", async () => {
    expect((await correr("lluvia", "rimac")).json.code).toBe("NO_ENCONTRADO");
  });
});
