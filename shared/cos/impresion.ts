/**
 * Diseño gráfico para imprenta (06-10-2026): imanes, envoltorios, bolsas, cintas. Javier carga las
 * medidas; el motor dibuja la pieza con la plantilla de la marca y entrega un JPG listo para la
 * imprenta (300 dpi, con sangrado). Sin dependencias: lo usan el worker y la app.
 */

export type FormatoImpresion = { id: string; nombre: string; ancho_mm: number; alto_mm: number; sangrado_mm: number; dpi: number }

const MM_POR_PULGADA = 25.4

/** Píxeles de una medida en mm a cierta resolución. */
export const mmAPx = (mm: number, dpi: number) => Math.round((mm / MM_POR_PULGADA) * dpi)

/** Tamaño final en píxeles: el corte (lo que queda después de la guillotina) y el sangrado. */
export function medidas(f: Pick<FormatoImpresion, "ancho_mm" | "alto_mm" | "sangrado_mm" | "dpi">) {
  const ancho = mmAPx(f.ancho_mm, f.dpi)
  const alto = mmAPx(f.alto_mm, f.dpi)
  const sangrado = mmAPx(f.sangrado_mm, f.dpi)
  return { ancho, alto, sangrado, totalAncho: ancho + 2 * sangrado, totalAlto: alto + 2 * sangrado }
}

/** Valida lo que carga Javier (en cm, como se piensa una pieza) y lo pasa a mm. */
export function validarFormato(x: { nombre: string; ancho_cm: number; alto_cm: number; sangrado_mm?: number }): { nombre: string; ancho_mm: number; alto_mm: number; sangrado_mm: number } | string {
  const nombre = x.nombre.trim()
  if (!nombre) return "Ponele un nombre (ej. Imán 7 × 9 cm)"
  if (nombre.length > 80) return "El nombre es muy largo"
  const ancho = Number(x.ancho_cm)
  const alto = Number(x.alto_cm)
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho < 1 || alto < 1) return "Las medidas van en centímetros y tienen que ser de 1 cm o más"
  if (ancho > 300 || alto > 300) return "Hasta 3 metros por lado"
  const sangrado = x.sangrado_mm == null ? 3 : Number(x.sangrado_mm)
  if (!Number.isFinite(sangrado) || sangrado < 0 || sangrado > 20) return "El sangrado va de 0 a 20 mm (lo normal es 3)"
  return { nombre, ancho_mm: Math.round(ancho * 100) / 10, alto_mm: Math.round(alto * 100) / 10, sangrado_mm: sangrado }
}

/**
 * Resolución de trabajo según el tamaño: 300 dpi para lo chico (imanes, etiquetas); en piezas
 * grandes se baja, porque se miran de más lejos y el archivo no se vuelve inmanejable.
 */
export function dpiPara(ancho_mm: number, alto_mm: number): number {
  const lado = Math.max(ancho_mm, alto_mm)
  return lado <= 450 ? 300 : lado <= 1000 ? 200 : 120
}

/**
 * ¿La foto alcanza? Compara los píxeles de la foto con los que va a ocupar en la pieza (aprox. el
 * ancho entero). Devuelve un aviso o null.
 */
export function avisoFoto(fotoAncho: number, fotoAlto: number, piezaAncho: number, piezaAlto: number): string | null {
  const escala = Math.max(piezaAncho / fotoAncho, piezaAlto / fotoAlto)
  if (escala <= 1.25) return null
  const dpiReal = Math.round(300 / escala)
  return `La foto queda chica para esta medida (se estira ${escala.toFixed(1)} veces, ~${dpiReal} dpi): puede verse borrosa de cerca`
}

/**
 * Link de WhatsApp para el QR. Acepta el número como está cargado (+54 9 11 2622-2202) o como se
 * escribe en un imán (11 2622-2202): un número argentino de 10 cifras se completa con 549.
 */
export function linkWhatsapp(numero: string): string | null {
  let d = numero.replace(/\D/g, "")
  if (d.length === 10) d = `549${d}`
  if (d.length === 12 && d.startsWith("54") && !d.startsWith("549")) d = `549${d.slice(2)}`
  return d.length >= 11 ? `https://wa.me/${d}` : null
}

/** Cómo se escribe el número en una pieza impresa en Argentina: 11 2622-2202 (sin +54 9). */
export function numeroLocal(numero: string): string {
  const d = numero.replace(/\D/g, "").replace(/^549/, "").replace(/^54/, "")
  if (d.length !== 10) return numero.trim()
  const area = d.startsWith("11") ? 2 : d.length - 8 >= 2 ? 3 : 2
  const resto = d.slice(area)
  return `${d.slice(0, area)} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`
}

/** Horario corto para una pieza chica: la primera oración de los datos de la marca. */
export function horarioCorto(horarios: string): string {
  const h = horarios.split(/[.\n]/)[0]?.trim() ?? ""
  return h.length > 60 ? `${h.slice(0, 57).trim()}…` : h
}

/** Nombre del archivo para la imprenta: marca-formato-medida.jpg */
export function nombreArchivo(marca: string, f: Pick<FormatoImpresion, "nombre" | "ancho_mm" | "alto_mm">): string {
  const limpio = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  return `${limpio(marca)}-${limpio(f.nombre)}-${f.ancho_mm / 10}x${f.alto_mm / 10}cm.jpg`
}

/**
 * Marca 300 dpi (o los que sean) en la cabecera JFIF del JPG, para que la imprenta lo abra con la
 * medida real (si no, lo ve a 72 dpi y "gigante"). Si el JPG no trae JFIF lo deja igual.
 */
export function conDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const esJfif = jpg[0] === 0xff && jpg[1] === 0xd8 && jpg[2] === 0xff && jpg[3] === 0xe0 && String.fromCharCode(jpg[6], jpg[7], jpg[8], jpg[9]) === "JFIF"
  if (!esJfif) return jpg
  const out = new Uint8Array(jpg)
  out[13] = 1 // unidades: puntos por pulgada
  out[14] = (dpi >> 8) & 0xff
  out[15] = dpi & 0xff
  out[16] = (dpi >> 8) & 0xff
  out[17] = dpi & 0xff
  return out
}
