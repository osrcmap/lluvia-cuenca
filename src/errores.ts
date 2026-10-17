import { AppError, type ErrorMap } from "./foundation/error-map.js";

export const ERRORES = {
  ARGS_INVALIDOS: {
    name: "ArgsInvalidos",
    human: "Parámetros inválidos.",
    hint: "Revisa los parámetros con `lluvia-cuenca schema <comando>`.",
  },
  COMANDO_DESCONOCIDO: {
    name: "ComandoDesconocido",
    human: "Comando desconocido.",
    hint: "Comandos: cuencas, lluvia, schema, doctor. Usa `lluvia-cuenca --help`.",
  },
  PARAMS_INVALIDOS: {
    name: "ParamsInvalidos",
    human: "No se pudo leer --params.",
    hint: "--params acepta un objeto JSON en línea o @ruta/al/archivo.json.",
  },
  NO_ENCONTRADO: {
    name: "NoEncontrado",
    human: "No hay una cuenca con ese id.",
    hint: "Usa `lluvia-cuenca cuencas` para ver las cuencas disponibles.",
  },
  FUERA_DE_RANGO: {
    name: "FueraDeRango",
    human: "El momento está fuera del rango de datos.",
    hint: "Open-Meteo entrega los últimos 3 días y los próximos 3: usa un --momento dentro de ese rango.",
  },
  DATOS_INVALIDOS: {
    name: "DatosInvalidos",
    human: "Los datos de cuencas del paquete están dañados.",
    hint: "Reinstala el paquete. Diagnóstico: `lluvia-cuenca doctor`.",
  },
  FUENTE_NO_DISPONIBLE: {
    name: "FuenteNoDisponible",
    human: "No se pudo consultar Open-Meteo.",
    hint: "No se puede afirmar que no llueva en la cuenca. Reintenta en unos minutos.",
  },
  FORMATO_INESPERADO: {
    name: "FormatoInesperado",
    human: "Open-Meteo respondió con un formato inesperado.",
    hint: "No se puede afirmar que no llueva en la cuenca. Reporta un issue.",
  },
  ERROR_INTERNO: {
    name: "ErrorInterno",
    human: "Error inesperado.",
    hint: "Abre un issue con el comando exacto que corriste.",
  },
} satisfies ErrorMap;

export type Codigo = keyof typeof ERRORES;

export const exitCode = (code: string) =>
  ["ARGS_INVALIDOS", "COMANDO_DESCONOCIDO", "PARAMS_INVALIDOS", "FUERA_DE_RANGO"].includes(code) ? 2 : 1;

export const fallo = (code: Codigo, detalle?: string, causa?: unknown) =>
  new AppError(code, detalle ? { ...ERRORES[code], human: detalle } : ERRORES[code], causa);
