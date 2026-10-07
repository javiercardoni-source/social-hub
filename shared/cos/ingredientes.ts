/**
 * Ingredientes: lo que un texto puede nombrar es SOLO lo que se ve en la imagen o lo que dijo una
 * persona. Javier (07-10-2026): "no reconoce bien los ingredientes, entonces los textos salen con
 * ingredientes que no están". Antes la IA que escribía los textos no veía la foto: recibía una
 * línea de resumen y completaba con lo típico del plato (palta, queso crema…).
 *
 * Tres piezas:
 * - El clasificador separa lo que ve con certeza (`visibles`) de lo que no distingue (`dudosos`).
 * - Los prompts reciben esa lista como la única fuente de ingredientes.
 * - Después de escribir, se controla con este vocabulario cerrado: un ingrediente sin respaldo
 *   hace reintentar; si vuelve a pasar, queda un aviso para quien aprueba.
 */

export type Ingredientes = { visibles: string[]; dudosos: string[] }

/** Canónico → cómo puede aparecer escrito (singular; el plural se tolera solo). */
const LEXICO: Record<string, string[]> = {
  salmón: ["salmon", "sake"],
  atún: ["atun", "maguro"],
  trucha: ["trucha"],
  "pez mantequilla": ["pez mantequilla", "pez manteca"],
  langostino: ["langostino", "camaron", "gamba", "ebi"],
  kanikama: ["kanikama", "kani", "surimi", "cangrejo"],
  pulpo: ["pulpo", "tako"],
  calamar: ["calamar", "ika"],
  anguila: ["anguila", "unagi"],
  ikura: ["ikura", "tobiko", "masago", "caviar", "hueva"],
  palta: ["palta", "avocado", "aguacate"],
  pepino: ["pepino", "kyuri"],
  "queso crema": ["queso crema", "philadelphia", "phila", "queso philadelphia", "cream cheese"],
  queso: ["queso", "cheddar", "muzzarella", "mozzarella", "provolone", "parmesano", "queso azul", "roquefort"],
  mango: ["mango"],
  frutilla: ["frutilla", "fresa"],
  banana: ["banana", "platano"],
  maracuyá: ["maracuya"],
  sésamo: ["sesamo", "ajonjoli"],
  panko: ["panko"],
  tempura: ["tempura", "rebozado"],
  nori: ["nori", "alga"],
  arroz: ["arroz", "gohan"],
  wasabi: ["wasabi"],
  jengibre: ["jengibre", "gari"],
  teriyaki: ["teriyaki"],
  mayonesa: ["mayonesa", "mayo", "spicy mayo"],
  huevo: ["huevo", "tamago", "tortilla"],
  pollo: ["pollo", "karaage", "chicken"],
  cerdo: ["cerdo", "panceta", "bacon", "tocino", "katsu", "tonkatsu", "chashu"],
  carne: ["carne", "medallon", "beef", "vacuno", "lomo", "bife"],
  cebolla: ["cebolla", "cebolla morada", "cebolla caramelizada", "cebolla crocante", "cebolla frita"],
  verdeo: ["verdeo", "cebollin", "ciboulette", "cebolla de verdeo"],
  lechuga: ["lechuga"],
  tomate: ["tomate", "cherry"],
  pepinillos: ["pepinillo", "pickle"],
  hongos: ["hongo", "champinon", "shiitake", "portobello", "champignon"],
  zanahoria: ["zanahoria"],
  morrón: ["morron", "pimiento"],
  choclo: ["choclo", "maiz"],
  trufa: ["trufa"],
  rúcula: ["rucula"],
  palmitos: ["palmito"],
  cilantro: ["cilantro"],
  limón: ["limon", "lima"],
  ají: ["aji", "jalapeno", "jalapeño", "chile"],
  togarashi: ["togarashi"],
  furikake: ["furikake"],
  umeboshi: ["umeboshi", "ciruela"],
  miso: ["miso"],
  tofu: ["tofu"],
  edamame: ["edamame"],
  katsuobushi: ["katsuobushi", "bonito"],
  brioche: ["brioche"],
  papas: ["papa", "papas fritas", "fritas"],
  chocolate: ["chocolate"],
  "dulce de leche": ["dulce de leche"],
  almendras: ["almendra"],
  maní: ["mani"],
  coco: ["coco"],
  batata: ["batata"],
  espinaca: ["espinaca"],
}

const sinTildes = (x: string) =>
  x
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

/** Texto listo para buscar palabras enteras: sin tildes, solo letras y números, con un espacio alrededor. */
const llano = (x: string) => ` ${sinTildes(x).replace(/[^a-z0-9ñ]+/g, " ").replace(/\s+/g, " ").trim()} `

// Variante → canónico, con las variantes más largas primero (que "queso crema" gane a "queso").
const VARIANTES: { forma: string; canonico: string }[] = Object.entries(LEXICO)
  .flatMap(([canonico, formas]) => [canonico, ...formas].map((f) => ({ forma: sinTildes(f), canonico })))
  .sort((a, b) => b.forma.length - a.forma.length)

const formasDe = (v: string) => [v, `${v}s`, `${v}es`]

/** Ingredientes (canónicos) que nombra un texto, en el orden en que aparecen, sin repetir. */
export function ingredientesEn(texto: string): string[] {
  let t = llano(texto)
  const hallados: { pos: number; canonico: string }[] = []
  for (const { forma, canonico } of VARIANTES) {
    for (const f of formasDe(forma)) {
      const clave = ` ${f} `
      let pos = t.indexOf(clave)
      while (pos >= 0) {
        hallados.push({ pos, canonico })
        // Se tapa lo encontrado para que una variante más corta no lo vuelva a contar ("queso crema" ≠ "queso").
        t = `${t.slice(0, pos + 1)}${"#".repeat(f.length)}${t.slice(pos + 1 + f.length)}`
        pos = t.indexOf(clave)
      }
    }
  }
  const vistos = new Set<string>()
  return hallados
    .sort((a, b) => a.pos - b.pos)
    .map((h) => h.canonico)
    .filter((c) => (vistos.has(c) ? false : (vistos.add(c), true)))
}

/** Lo que escribió la IA como ingrediente → canónico si está en el vocabulario; si no, tal cual (limpio). */
export function normalizarIngrediente(x: string): string {
  const l = llano(x).trim()
  if (!l) return ""
  const v = VARIANTES.find((v) => formasDe(v.forma).includes(l))
  return v ? v.canonico : l
}

/** Lista de ingredientes como la devuelve la IA → limpia, sin repetir, acotada. */
export function normalizarLista(xs: unknown, max = 20): string[] {
  const out: string[] = []
  for (const x of Array.isArray(xs) ? xs : []) {
    if (typeof x !== "string") continue
    const n = normalizarIngrediente(x).slice(0, 40)
    if (n && !out.includes(n)) out.push(n)
    if (out.length >= max) break
  }
  return out
}

/** Lee las listas del `ai_json` de un asset. null = clasificado antes de que existieran (hay que completarlas). */
export function leerIngredientes(aiJson: unknown): Ingredientes | null {
  const j = aiJson && typeof aiJson === "object" ? (aiJson as Record<string, unknown>) : null
  if (!j || !Array.isArray(j.ingredientes_visibles)) return null
  return { visibles: normalizarLista(j.ingredientes_visibles), dudosos: normalizarLista(j.ingredientes_dudosos) }
}

/**
 * Con qué se puede respaldar un ingrediente nombrado en `texto`: los visibles, los que dijo una
 * PERSONA (nunca una descripción escrita por la IA) y los del nombre de un combo de Datos vigentes,
 * solo si el texto nombra ese combo completo (el combo lo cargó el dueño: su nombre vale).
 */
export function respaldoDe(o: { ingredientes: Ingredientes | null; dichoPorPersona?: string | null; combos?: string[]; texto: string }): Set<string> {
  const r = new Set<string>(o.ingredientes?.visibles.flatMap((v) => ingredientesEn(v)) ?? [])
  for (const i of ingredientesEn(o.dichoPorPersona ?? "")) r.add(i)
  const t = llano(o.texto)
  for (const c of o.combos ?? []) {
    const nombre = llano(c).trim()
    if (nombre && t.includes(` ${nombre} `)) for (const i of ingredientesEn(c)) r.add(i)
  }
  return r
}

/** Ingredientes que nombran los textos y no tienen respaldo (vacío = todo bien). */
export function ingredientesSinRespaldo(textos: string[], respaldo: Set<string>): string[] {
  const out: string[] = []
  for (const i of ingredientesEn(textos.join(" \n "))) if (!respaldo.has(i) && !out.includes(i)) out.push(i)
  return out
}

/** Aviso para quien aprueba, por cada ingrediente sin respaldo. */
export const avisoIngrediente = (i: string) => `El texto nombra «${i}» y no se ve en la imagen`

/** El bloque que reciben los prompts que escriben textos: la única fuente de ingredientes. */
export function bloqueIngredientes(i: Ingredientes | null): string {
  if (!i) {
    return (
      "INGREDIENTES: no hay lista verificada de esta imagen. NO nombres ningún ingrediente puntual " +
      "(ni palta, ni salmón, ni queso crema…): hablá del plato en general (roll, bandeja, onigiri, combo) sin detallar qué lleva."
    )
  }
  const vis = i.visibles.length ? i.visibles.join(", ") : "(ninguno con certeza)"
  const dud = i.dudosos.length ? ` · Dudosos, que NO se nombran de ninguna forma: ${i.dudosos.join(", ")}.` : ""
  return (
    `INGREDIENTES QUE SE VEN (los ÚNICOS que podés nombrar, además de los que diga el empleado): ${vis}.${dud} ` +
    "Nada de completar con lo típico del plato: un ingrediente que no está es el peor error posible (el cliente lo lee, pide, y no viene)."
  )
}

/** Regla compartida por el clasificador y por la mirada específica de ingredientes. */
export const REGLA_INGREDIENTES_VISTA =
  "- ingredientes_visibles: SOLO lo que distinguís con certeza en la imagen, en español de Argentina (palta, salmón, langostino, " +
  "queso crema, pepino, sésamo…). Con esta lista se escriben los textos: si dudás, NO va acá.\n" +
  "- ingredientes_dudosos: lo que podría estar pero no se distingue con seguridad. Confusiones típicas: salmón/atún/trucha, " +
  "palta/pepino/wasabi, queso crema/mayonesa, langostino/kanikama, panko/sésamo, cebolla/verdeo. Ante la duda entre dos, los dos van acá.\n" +
  "- Lo que no se ve, no está, aunque sea típico del plato. Lo que dice el empleado (una persona) sí se puede tomar como visto."
