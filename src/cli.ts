import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { renderDoctor, runDoctor } from "./agent/doctor.js";
import { detectMode, type EmitOptions, emit } from "./agent/json-mode.js";
import { emitNextSteps, type NextStep } from "./agent/next-steps.js";
import { cargarCuencas, contiene, puntosDeMuestreo } from "./cuencas.js";
import { ERRORES, exitCode, fallo } from "./errores.js";
import { AppError } from "./foundation/error-map.js";
import { DIR_CACHE, type OpcionesHttp } from "./http.js";
import { consultar, resumir } from "./lluvia.js";

/** Open-Meteo actualiza sus modelos cada hora: 15 minutos de caché no pierde información. */
const CACHE_SEGUNDOS = 900;

const AVISO = [
  "Lluvia estimada por modelos meteorológicos (Open-Meteo), no medida por estaciones. Su resolución (~7-9 km) es gruesa para una quebrada.",
  "No hay un umbral calibrado: estos valores no indican por sí solos si la quebrada se activará.",
  "Para avisos oficiales usa los del SENAMHI (avisos-pe) y el monitoreo del IGP (igp-huaicos). No es una orden de evacuación.",
];

const FUENTE = {
  lluvia:
    "Weather data by Open-Meteo.com (https://open-meteo.com), CC BY 4.0. Promediada sobre la cuenca por lluvia-cuenca.",
  cuencas:
    "Delineadas por lluvia-cuenca con Copernicus DEM GLO-30 © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y la ESA.",
};

const aNumero = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);
const momento = z
  .string()
  .regex(/(Z|[+-]\d{2}:\d{2})$/, "ISO 8601 con zona horaria")
  .optional()
  .describe("Momento de referencia (por defecto, ahora). Debe tener 72 h de datos antes y 48 h después.");

const ENTRADAS = {
  cuencas: z.strictObject({
    lat: z
      .preprocess(aNumero, z.number().min(-90).max(90))
      .optional()
      .describe("Solo las cuencas que contienen este punto"),
    lon: z.preprocess(aNumero, z.number().min(-180).max(180)).optional(),
  }),
  lluvia: z.strictObject({
    id: z.string().min(1).describe("Id de la cuenca (ver `cuencas`), p. ej. huaycoloro"),
    momento,
    "sin-cache": z
      .boolean()
      .default(false)
      .describe(`Ignorar la caché local (${CACHE_SEGUNDOS / 60} min)`),
  }),
  schema: z.strictObject({ comando: z.enum(["cuencas", "lluvia", "schema", "doctor"]).optional() }),
  doctor: z.strictObject({ "sin-red": z.boolean().default(false) }),
};
type Comando = keyof typeof ENTRADAS;

const DESCRIPCIONES: Record<Comando, string> = {
  cuencas:
    "Cuencas disponibles (área, cotas, salida, estaciones del IGP). Con --lat/--lon, las que contienen el punto.",
  lluvia: "Lluvia acumulada (1, 6, 24, 72 h) y pronosticada (6, 24, 48 h) promediada sobre la cuenca.",
  schema: "Describe entradas y salidas (JSON Schema).",
  doctor: "Revisa los datos de cuencas, la caché y que Open-Meteo responda.",
};
const SALIDAS: Record<Comando, string> = {
  cuencas:
    "{ ok, cuencas: { id, nombre, area_km2, cota_min_m, cota_max_m, salida, igp_estaciones }[], fuente }",
  lluvia:
    "{ ok, cuenca, momento, hora_de_corte, lluvia_mm: { ultima_hora|ultimas_6h|ultimas_24h|ultimas_72h|proximas_6h|proximas_24h|proximas_48h: { mm, max_mm_h, horas, completo } }, maximo_por_celda_mm, celdas_modelo[], fuente, aviso }",
  schema: "{ ok, comandos } o { ok, comando, descripcion, entrada, salida }",
  doctor: "{ ok, checks: { name, ok, detail }[] }",
};

function leerParams(v: string | undefined): Record<string, unknown> {
  if (!v) return {};
  let p: unknown;
  try {
    p = JSON.parse(v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v);
  } catch (e) {
    throw fallo("PARAMS_INVALIDOS", `No se pudo leer --params ${v}.`, e);
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw fallo("PARAMS_INVALIDOS", "--params debe ser un objeto JSON.");
  return p as Record<string, unknown>;
}

/** Las coordenadas del Perú son negativas y parseArgs toma "-12.05" como otra opción. */
export function unirNegativos(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && !a.includes("=") && /^-\d/.test(argv[i + 1] ?? ""))
      out.push(`${a}=${argv[++i]}`);
    else out.push(a);
  }
  return out;
}

type Resultado = { valor: unknown; pasos?: NextStep[]; humano?: () => void; fallido?: boolean };

const resumenCuenca = (p: ReturnType<typeof cargarCuencas>["features"][number]["properties"]) => ({
  id: p.id,
  nombre: p.nombre,
  area_km2: p.area_km2,
  cota_min_m: p.cota_min_m,
  cota_max_m: p.cota_max_m,
  salida: p.salida,
  igp_estaciones: p.igp_estaciones,
  igp_quebrada: p.igp_quebrada,
});

function cmdCuencas(e: z.infer<typeof ENTRADAS.cuencas>): Resultado {
  if ((e.lat === undefined) !== (e.lon === undefined))
    throw fallo("ARGS_INVALIDOS", "Usa --lat y --lon juntos.");
  const cs = cargarCuencas().features.filter(
    (c) => e.lat === undefined || contiene(c, e.lat, e.lon as number),
  );
  return {
    valor: {
      ok: true,
      cuencas: cs.map((c) => resumenCuenca(c.properties)),
      fuente: { cuencas: FUENTE.cuencas },
    },
    pasos: cs
      .slice(0, 1)
      .map((c) => ({ command: `lluvia-cuenca lluvia ${c.id}`, description: "Lluvia sobre la cuenca" })),
  };
}

async function cmdLluvia(e: z.infer<typeof ENTRADAS.lluvia>): Promise<Resultado> {
  const c = cargarCuencas().features.find((x) => x.id === e.id);
  if (!c) throw fallo("NO_ENCONTRADO", `No hay una cuenca "${e.id}".`);
  const o: OpcionesHttp = { cacheSegundos: e["sin-cache"] ? 0 : CACHE_SEGUNDOS };
  const r = await consultar(c, puntosDeMuestreo(c), o);
  const m = e.momento ? Date.parse(e.momento) : Date.now();
  const res = resumir(c, r.tiempos, r.celdas, m);
  const valor = {
    ok: true,
    cuenca: resumenCuenca(c.properties),
    ...res,
    fuente: { ...FUENTE, obtenido_en: r.obtenido_en },
    aviso: AVISO,
  };
  const q = c.properties.igp_quebrada;
  const pasos: NextStep[] = q
    ? [
        {
          command: `igp-huaicos quebrada "${q}"`,
          description: "Estado en vivo de los sensores del IGP en esta quebrada",
        },
      ]
    : [];
  const humano = () => {
    const l = res.lluvia_mm;
    const fuera = res.celdas_modelo.filter((x) => !x.centro_dentro_de_la_cuenca).length;
    const out = [
      `${c.properties.nombre} — ${c.properties.area_km2} km², ${c.properties.cota_min_m}–${c.properties.cota_max_m} m`,
      `Lluvia estimada (Open-Meteo), promedio sobre la cuenca, al ${res.hora_de_corte.slice(0, 16).replace("T", " ")} UTC:`,
      `  última hora: ${l.ultima_hora.mm} mm · últimas 6 h: ${l.ultimas_6h.mm} mm · 24 h: ${l.ultimas_24h.mm} mm (máx. ${l.ultimas_24h.max_mm_h} mm/h) · 72 h: ${l.ultimas_72h.mm} mm`,
      `  próximas 6 h: ${l.proximas_6h.mm} mm · 24 h: ${l.proximas_24h.mm} mm (máx. ${l.proximas_24h.max_mm_h} mm/h) · 48 h: ${l.proximas_48h.mm} mm`,
      `  celda más lluviosa en las últimas 24 h: ${res.maximo_por_celda_mm.ultimas_24h.mm} mm`,
      `  ${res.celdas_modelo.length} celdas de modelo${fuera ? `, ${fuera} con centro fuera de la cuenca` : ""}`,
    ];
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

function cmdSchema(e: z.infer<typeof ENTRADAS.schema>): Resultado {
  if (!e.comando) {
    return {
      valor: {
        ok: true,
        comandos: Object.entries(DESCRIPCIONES).map(([nombre, descripcion]) => ({ nombre, descripcion })),
      },
    };
  }
  return {
    valor: {
      ok: true,
      comando: e.comando,
      descripcion: DESCRIPCIONES[e.comando],
      entrada: z.toJSONSchema(ENTRADAS[e.comando], { io: "input" }),
      salida: SALIDAS[e.comando],
    },
  };
}

const chequeo = (name: string, fn: () => Promise<{ ok: boolean; detail: string }>) => async () => {
  try {
    return { name, ...(await fn()) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

async function cmdDoctor(e: z.infer<typeof ENTRADAS.doctor>): Promise<Resultado> {
  const checks = [
    chequeo("cuencas", async () => {
      const cs = cargarCuencas().features;
      return { ok: true, detail: cs.map((c) => `${c.id} (${c.properties.area_km2} km²)`).join(", ") };
    }),
    chequeo("cache", async () => {
      try {
        mkdirSync(DIR_CACHE, { recursive: true });
        accessSync(DIR_CACHE, constants.W_OK);
        return { ok: true, detail: DIR_CACHE };
      } catch (err) {
        return { ok: true, detail: `sin caché (${(err as Error).message}); se consultará siempre` };
      }
    }),
  ];
  if (!e["sin-red"]) {
    checks.push(
      chequeo("open-meteo", async () => {
        const c = cargarCuencas().features[0];
        const r = await consultar(c, puntosDeMuestreo(c), { cacheSegundos: 0, intentos: 1 });
        return {
          ok: true,
          detail: `${r.celdas.length} celdas de modelo para ${c.id}; ${r.tiempos.length} horas`,
        };
      }),
    );
  }
  const r = await runDoctor(checks);
  return { valor: r, fallido: !r.ok };
}

const AYUDA = `lluvia-cuenca ${pkg.version} — lluvia sobre la cuenca alta de quebradas (piloto: Huaycoloro, Río Seco)

Uso:
  lluvia-cuenca cuencas [--lat -11.95 --lon -76.87]
  lluvia-cuenca lluvia <id> [--momento <ISO>]      (p. ej. huaycoloro)
  lluvia-cuenca schema [comando]
  lluvia-cuenca doctor [--sin-red]

Flags globales: --json, --params <json|@archivo>, --sin-cache, -h/--help, --version

Lluvia estimada por modelo (Open-Meteo), no medida. Sin umbral calibrado.
`;

function parsear(argv: string[]) {
  return parseArgs({
    args: unirNegativos(argv),
    allowPositionals: true,
    strict: true,
    options: {
      lat: { type: "string" },
      lon: { type: "string" },
      momento: { type: "string" },
      "sin-cache": { type: "boolean" },
      "sin-red": { type: "boolean" },
      json: { type: "boolean" },
      params: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

async function main(argv: string[]) {
  let parsed: ReturnType<typeof parsear>;
  try {
    parsed = parsear(argv);
  } catch (err) {
    throw fallo("ARGS_INVALIDOS", err instanceof Error ? err.message : String(err), err);
  }
  const { values, positionals } = parsed;
  const opts: EmitOptions = { json: values.json };
  if (values.version) return emit({ ok: true, version: pkg.version }, opts, (v) => console.log(v.version));
  const comando = positionals[0];
  if (values.help || !comando) return void process.stdout.write(AYUDA);
  if (!(comando in ENTRADAS)) throw fallo("COMANDO_DESCONOCIDO", `Comando desconocido: ${comando}.`);
  const cmd = comando as Comando;

  const { json: _j, params, help: _h, version: _v, ...flags } = values;
  const crudo: Record<string, unknown> = { ...leerParams(params) };
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) crudo[k] = v;
  const posicional: Partial<Record<Comando, string>> = { lluvia: "id", schema: "comando" };
  if (positionals[1] !== undefined) {
    if (!posicional[cmd] || positionals.length > 2)
      throw fallo("ARGS_INVALIDOS", `Argumentos de más: ${positionals.slice(1).join(" ")}`);
    crudo[posicional[cmd] as string] = positionals[1];
  }
  const entrada = ENTRADAS[cmd].safeParse(crudo);
  if (!entrada.success) throw fallo("ARGS_INVALIDOS", z.prettifyError(entrada.error));
  const e: any = entrada.data;

  const r =
    cmd === "cuencas"
      ? cmdCuencas(e)
      : cmd === "lluvia"
        ? await cmdLluvia(e)
        : cmd === "schema"
          ? cmdSchema(e)
          : await cmdDoctor(e);
  if (cmd === "doctor") renderDoctor(r.valor as any, opts);
  else emit(r.valor, opts, r.humano ? () => r.humano?.() : undefined);
  emitNextSteps(r.pasos ?? [], opts);
  if (r.fallido) process.exitCode = 1;
}

/** Punto de entrada (lo llama src/bin.ts). Nunca lanza: todo error sale estructurado con su exit code. */
export async function ejecutar(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (err: unknown) {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(
            "ERROR_INTERNO",
            { ...ERRORES.ERROR_INTERNO, human: err instanceof Error ? err.message : String(err) },
            err,
          );
    if (detectMode({ json: argv.includes("--json") }) === "json") {
      process.stdout.write(`${JSON.stringify(appErr.toJSON())}\n`);
    } else {
      process.stderr.write(`✗ ${appErr.human}\n${appErr.hint ? `  ${appErr.hint}\n` : ""}`);
    }
    process.exitCode = exitCode(appErr.code);
  }
}
