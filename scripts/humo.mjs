// Prueba de humo del paquete compilado (dist/cli.js) con el Node que la ejecute (>= 20). Sin red:
// un servidor local imita a Open-Meteo con una respuesta real. Corre sobre una copia aislada
// (solo lo que se publica: dist, data y package.json) para detectar si el bundle deja de ser autónomo.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const respuesta = readFileSync(join(raiz, "test/fixtures/openmeteo-huaycoloro.json"));
const aislado = mkdtempSync(join(tmpdir(), "lluvia-cuenca-humo-"));
for (const f of ["dist", "data", "package.json"])
  cpSync(join(raiz, f), join(aislado, f), { recursive: true });

const servidor = createServer((_req, res) => res.end(respuesta));
await new Promise((ok) => servidor.listen(0, ok));
const env = {
  ...process.env,
  LLUVIA_CUENCA_OPENMETEO_BASE: `http://localhost:${servidor.address().port}`,
  XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "lluvia-cuenca-cache-")),
};
// Hijo asíncrono: spawnSync bloquearía al servidor de este mismo proceso.
const correr = (...args) =>
  new Promise((ok) => {
    const h = spawn(process.execPath, [join(aislado, "dist/cli.js"), ...args, "--json"], { env });
    let out = "";
    h.stdout.on("data", (d) => (out += d));
    h.on("close", (code) => {
      assert.ok(out.trim(), `sin salida para: ${args.join(" ")}`);
      ok({ code, json: JSON.parse(out) });
    });
  });

try {
  assert.equal((await correr("--version")).json.version, pkg.version);
  assert.equal((await correr("cuencas")).json.cuencas.length, 2);
  const r = await correr("lluvia", "huaycoloro", "--momento", "2026-10-17T10:30:00Z");
  assert.equal(r.code, 0);
  assert.equal(r.json.celdas_modelo.length, 13);
  assert.equal((await correr("lluvia", "no-existe")).json.code, "NO_ENCONTRADO");
  console.log(`humo ok: node ${process.version}, ${pkg.name}@${pkg.version}`);
} finally {
  servidor.close();
}
