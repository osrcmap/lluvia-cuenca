#!/usr/bin/env node
// Ejecutable del paquete. Separado de cli.ts para no depender de import.meta.main.
import { ejecutar } from "./cli.js";

await ejecutar(process.argv.slice(2));
