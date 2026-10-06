/**
 * Dibuja las plantillas propias de cada marca (shared/cos/plantillas.ts). A diferencia de
 * overlay.ts (una capa transparente encima de la foto), acá se arma la pieza ENTERA: la foto
 * es un elemento del diseño. Sale un PNG del tamaño final (1080×1350 feed, 1080×1920 historia).
 *
 * Las medidas van en `u` = 1 % del ancho, igual que el mockup que aprobó Javier (cqw).
 */
import satori from "satori"
import { Resvg } from "@resvg/resvg-js"
import { CTA_MARCA, plantilla, type Diseno } from "../../shared/cos/plantillas.ts"
import { conAlfa, type Paleta } from "../../shared/cos/paleta.ts"

type Fuente = { name: string; data: Buffer; weight?: number }
export type KitDiseno = {
  titulo: Fuente
  texto: Fuente
  /** Manuscrita (Bijutsukan: Cormorant Italic). Sin ella se usa la de texto. */
  acento?: Fuente
  paleta: Paleta
}

type El = { type: string; props: Record<string, unknown> }
const el = (style: Record<string, unknown>, children?: unknown): El => ({ type: "div", props: { style: { display: "flex", ...style }, children } })
const img = (src: string, style: Record<string, unknown> = {}): El => ({
  type: "img",
  props: { src, style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", ...style } },
})
const abs = (style: Record<string, unknown>, children?: unknown) => el({ position: "absolute", ...style }, children)
const mayus = (s = "") => s.toUpperCase()
/** Tamaño de letra que entra en `ancho` para un texto de una línea (aprox. por cantidad de letras). */
const entra = (texto: string, ancho: number, max: number, factor = 0.6) => Math.min(max, ancho / Math.max(1, texto.length * factor))

/** La pieza dibujada (PNG). `fotos[0]` es la del post; el resto, otras de la marca (grilla). */
export async function renderDiseno(opts: {
  diseno: Diseno
  marca: string
  fotos: string[]
  kit: KitDiseno
  width: number
  height: number
  /** QR (data URI de un PNG) para las piezas de imprenta. */
  qr?: string
  /** Nombre de la marca para las piezas que lo escriben (imprenta). */
  nombreMarca?: string
}): Promise<Buffer> {
  const { diseno, marca, kit, width: W, height: H } = opts
  const p = plantilla(diseno.plantilla)
  if (!p) throw new Error(`plantilla desconocida: ${diseno.plantilla}`)
  const u = W / 100
  const c = diseno.campos
  const P = kit.paleta
  const T = kit.titulo.name
  const X = kit.texto.name
  const A = (kit.acento ?? kit.texto).name
  const foto = opts.fotos[0]
  const cta = CTA_MARCA[marca] ?? "PEDÍ POR WHATSAPP"

  const fondo = (color: string) => abs({ top: 0, left: 0, width: W, height: H, backgroundColor: color })
  const degradado = (css: string) => abs({ top: 0, left: 0, width: W, height: H, backgroundImage: css })
  const ctaSubrayado = (bottom: number) =>
    abs({ left: 0, width: W, bottom, flexDirection: "column", alignItems: "center" }, [
      el({ fontFamily: X, fontSize: 4.6 * u, color: P.titulo, letterSpacing: "0.16em" }, cta),
      el({ marginTop: 1.5 * u, width: 42 * u, height: 2, backgroundColor: P.titulo }),
    ])
  // Cartela de museo (Bijutsukan): número, nombre y detalle en manuscrita.
  const cartela = (style: Record<string, unknown>, ancho: number) =>
    abs({ ...style, width: ancho, flexDirection: "column", borderTop: `2px solid ${conAlfa(P.titulo, 0.35)}`, paddingTop: 2.6 * u }, [
      el({ flexDirection: "row", justifyContent: "space-between", fontFamily: X, fontSize: 3.2 * u, letterSpacing: "0.22em", color: conAlfa(P.titulo, 0.6) }, [
        el({}, `N.º ${String(diseno.numero ?? 1).padStart(2, "0")}`),
        el({}, "BIJUTSUKAN"),
      ]),
      el({ fontFamily: T, fontSize: entra(c.titulo ?? "", ancho, 6.6 * u, 0.74), lineHeight: 1.15, color: P.titulo, marginTop: 1.2 * u }, mayus(c.titulo)),
      ...(c.detalle ? [el({ fontFamily: A, fontSize: 6 * u, lineHeight: 1.1, color: conAlfa(P.titulo, 0.9) }, c.detalle)] : []),
    ])
  // Foto enmarcada como obra: marco fino y aire alrededor.
  const obra = (x: number, y: number, w: number, h: number) =>
    abs({ left: x, top: y, width: w, height: h, border: `2px solid ${conAlfa(P.titulo, 0.3)}`, padding: 3 * u }, [
      el({ position: "relative", width: "100%", height: "100%", overflow: "hidden" }, [img(foto)]),
    ])
  const pill = (texto: string, bg: string, color: string, fuente: string, size: number, extra: Record<string, unknown> = {}) =>
    el({ backgroundColor: bg, color, fontFamily: fuente, fontSize: size, borderRadius: 999, padding: `${size * 0.4}px ${size * 1.05}px`, letterSpacing: "0.06em", whiteSpace: "nowrap", flexShrink: 0, ...extra }, texto)

  let hijos: El[]
  switch (p.id) {
    case "bj_galeria":
      hijos = [fondo(P.fondo), obra(6 * u, 0.05 * H, 88 * u, 0.64 * H), cartela({ left: 9 * u, bottom: 0.06 * H }, 82 * u)]
      break
    case "bj_galeria_v":
      hijos = [fondo(P.fondo), obra(15 * u, 0.13 * H, 70 * u, 87.5 * u), cartela({ left: 12 * u, top: 0.645 * H }, 76 * u), ctaSubrayado(0.17 * H)]
      break
    case "bj_editorial":
      hijos = [
        fondo(P.fondo),
        abs({ left: 0, top: 0.44 * H, width: W, height: 0.56 * H, overflow: "hidden" }, [img(foto)]),
        abs({ left: 8 * u, top: 0.065 * H, width: 84 * u, flexDirection: "column" }, [
          el({ fontFamily: X, fontSize: 3.6 * u, letterSpacing: "0.24em", color: conAlfa(P.titulo, 0.75) }, mayus(c.kicker)),
          el({ fontFamily: T, fontSize: (c.titulo ?? "").length > 16 ? 10 * u : 12 * u, lineHeight: 1.02, color: P.titulo, marginTop: 2.4 * u, maxWidth: 70 * u }, mayus(c.titulo)),
        ]),
        ...(c.manuscrita
          ? [abs({ right: 8 * u, top: 0.35 * H, fontFamily: A, fontSize: 17 * u, color: P.titulo, textShadow: "0 3px 18px rgba(0,0,0,0.9)" }, c.manuscrita)]
          : []),
      ]
      break
    case "bj_firma":
      hijos = [
        abs({ left: 0, top: 0, width: W, height: H, overflow: "hidden" }, [img(foto)]),
        degradado(`linear-gradient(180deg, rgba(0,0,0,0) 68%, ${conAlfa(P.fondo, 0.85)} 100%)`),
        abs({ left: 0, width: W, bottom: 0.06 * H, flexDirection: "column", alignItems: "center" }, [
          el({ fontFamily: T, fontSize: 5 * u, letterSpacing: "0.42em", color: P.titulo, paddingLeft: "0.42em" }, "BIJUTSUKAN"),
          el({ marginTop: 2 * u, width: 12 * u, height: 2, backgroundColor: conAlfa(P.titulo, 0.8) }),
        ]),
      ]
      break
    case "sn_puro": {
      const crema = P.acentoTexto
      const t = c.titulo ?? ""
      hijos = [
        abs({ left: 0, top: 0, width: W, height: H, overflow: "hidden" }, [img(foto)]),
        degradado(`linear-gradient(180deg, ${conAlfa(P.fondo, 0.86)} 0%, ${conAlfa(P.fondo, 0.15)} 55%, ${conAlfa(P.fondo, 0.9)} 100%)`),
        abs({ left: 7 * u, top: 0.065 * H, width: 86 * u, flexDirection: "column" }, [
          el({ fontFamily: X, fontSize: 4.4 * u, letterSpacing: "0.22em", color: crema }, mayus(c.kicker)),
          el({ fontFamily: T, fontSize: t.length > 11 ? 15 * u : 19 * u, lineHeight: 0.95, color: P.acento, marginTop: 1.5 * u, maxWidth: 80 * u }, t),
          ...(c.bajada ? [el({ fontFamily: X, fontSize: 5.2 * u, lineHeight: 1.3, color: crema, marginTop: 3 * u, maxWidth: 62 * u, textShadow: `0 1px 10px ${P.fondo}` }, c.bajada)] : []),
        ]),
        abs({ left: 7 * u, width: 86 * u, bottom: 0.06 * H, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }, [
          pill(cta, P.acento, crema, X, 4.2 * u),
          ...(c.esquina ? [el({ fontFamily: T, fontSize: 5.6 * u, lineHeight: 1.05, color: crema, maxWidth: 34 * u, textAlign: "right" }, c.esquina)] : []),
        ]),
      ]
      break
    }
    case "sn_cartel":
      hijos = [
        abs({ left: 0, top: 0, width: W, height: H, overflow: "hidden" }, [img(foto)]),
        degradado(`linear-gradient(180deg, rgba(0,0,0,0) 50%, ${conAlfa(P.fondo, 0.8)} 100%)`),
        abs({ left: 0, bottom: 0.08 * H, width: 80 * u, flexDirection: "column", backgroundColor: P.acento, padding: `${4 * u}px ${6 * u}px ${4 * u}px ${7 * u}px`, borderRadius: `0 ${3 * u}px ${3 * u}px 0` }, [
          el({ fontFamily: T, fontSize: 8.6 * u, lineHeight: 1.05, color: P.acentoTexto, width: 67 * u }, c.titulo ?? ""),
          el({ fontFamily: X, fontSize: 3.8 * u, letterSpacing: "0.14em", color: P.acentoTexto, marginTop: 2.4 * u }, cta),
        ]),
      ]
      break
    case "ff_arma5":
      hijos = [
        fondo(P.fondo),
        abs({ left: 7 * u, top: 0.05 * H, maxWidth: 72 * u, fontFamily: T, fontSize: 16 * u, lineHeight: 0.92, color: P.titulo }, mayus(c.titulo)),
        abs({ left: 12 * u, top: 0.31 * H, width: 76 * u, height: 0.47 * H, borderRadius: 4 * u, border: `${1.8 * u}px solid #ffffff`, overflow: "hidden", transform: "rotate(-4deg)", boxShadow: "0 30px 60px -30px rgba(0,0,0,0.45)" }, [img(foto)]),
        abs({ left: 7 * u, width: 86 * u, bottom: 0.14 * H, fontFamily: X, fontSize: 4.4 * u, letterSpacing: "0.06em", color: P.titulo }, mayus(c.linea)),
        abs({ left: 7 * u, bottom: 0.05 * H }, [pill(cta, P.acento, P.acentoTexto, X, 4.4 * u, { letterSpacing: "0.02em" })]),
      ]
      break
    case "ff_sticker":
      hijos = [
        abs({ left: 0, top: 0, width: W, height: H, overflow: "hidden" }, [img(foto)]),
        degradado(`linear-gradient(180deg, rgba(0,0,0,0) 52%, ${conAlfa(P.titulo, 0.85)} 100%)`),
        abs(
          { top: 0.06 * H, right: 6 * u, width: 30 * u, height: 30 * u, borderRadius: 999, backgroundColor: P.acento, alignItems: "center", justifyContent: "center", transform: "rotate(12deg)", boxShadow: `0 ${1.4 * u}px 0 ${P.titulo}` },
          [el({ fontFamily: T, fontSize: entra(c.sticker ?? "", 24 * u, 7.4 * u, 0.62), color: P.acentoTexto, textAlign: "center" }, mayus(c.sticker))],
        ),
        abs({ left: 7 * u, width: 86 * u, bottom: 0.06 * H, flexDirection: "column" }, [
          el({ fontFamily: T, fontSize: (c.titulo ?? "").length > 9 ? 15 * u : 20 * u, lineHeight: 0.9, color: "#ffffff", textShadow: `0 ${1.2 * u}px 0 ${P.titulo}`, maxWidth: 80 * u }, mayus(c.titulo)),
          ...(c.bajada ? [el({ fontFamily: X, fontSize: 4.6 * u, letterSpacing: "0.08em", color: P.fondo, marginTop: 3 * u }, mayus(c.bajada))] : []),
        ]),
      ]
      break
    case "ff_grilla": {
      const g = 2.6 * u
      const top = 0.33 * H
      const alto = H * 0.53
      const tw = (86 * u - g) / 2
      const th = (alto - g) / 2
      // Si faltan fotos de la marca, se repite la del post con otro encuadre.
      const posiciones = ["30% 50%", "50% 70%", "50% 35%", "70% 45%"]
      const tiles = [0, 1, 2, 3].map((i) =>
        abs({ left: 7 * u + (i % 2) * (tw + g), top: top + Math.floor(i / 2) * (th + g), width: tw, height: th, borderRadius: 3 * u, overflow: "hidden" }, [
          img(opts.fotos[i] ?? foto, opts.fotos[i] ? {} : { objectPosition: posiciones[i] }),
          abs({ left: 2 * u, top: 2 * u, width: 9 * u, height: 9 * u, borderRadius: 999, backgroundColor: P.acento, alignItems: "center", justifyContent: "center", fontFamily: T, fontSize: 5.4 * u, color: P.acentoTexto }, String(i + 1)),
        ]),
      )
      hijos = [
        fondo(P.fondo),
        abs({ left: 7 * u, top: 0.05 * H, maxWidth: 80 * u, fontFamily: T, fontSize: 12 * u, lineHeight: 0.92, color: P.titulo }, mayus(c.titulo)),
        ...tiles,
        abs({ left: 7 * u, bottom: 0.055 * H, fontFamily: X, fontSize: 4.4 * u, letterSpacing: "0.06em", color: P.titulo }, mayus(c.pie)),
      ]
      break
    }
    case "ff_palabra": {
      const w = mayus(c.palabra || "ÑAM")
      hijos = [
        fondo(P.fondo),
        abs({ left: 10 * u, top: 0.09 * H, width: 80 * u, height: 0.82 * H, borderRadius: 2 * u, overflow: "hidden", transform: "rotate(3deg)" }, [img(foto)]),
        abs({ left: 0, width: W, top: 0.4 * H, justifyContent: "center", transform: "rotate(-4deg)" }, [
          el({ fontFamily: T, fontSize: entra(w, 88 * u, 19 * u, 0.62), lineHeight: 1, color: P.acento, WebkitTextStroke: `${1.1 * u}px ${P.titulo}`, textShadow: `0 ${1.2 * u}px 0 ${P.titulo}` }, w),
        ]),
      ]
      break
    }
    case "ff_encuesta":
      hijos = [
        fondo(P.fondo),
        abs({ left: 7 * u, width: 86 * u, top: 0.14 * H, justifyContent: "center", textAlign: "center", fontFamily: T, fontSize: 13 * u, lineHeight: 0.95, color: P.titulo }, mayus(c.pregunta)),
        abs({ left: 12 * u, top: 0.3 * H, width: 76 * u, height: 0.34 * H, borderRadius: 4 * u, border: `${1.8 * u}px solid #ffffff`, overflow: "hidden", transform: "rotate(-4deg)", boxShadow: "0 30px 60px -30px rgba(0,0,0,0.45)" }, [img(foto)]),
        abs({ left: 10 * u, width: 80 * u, top: 0.68 * H, flexDirection: "column" }, [
          ...[c.opcionA, c.opcionB].map((o, i) =>
            el({ marginTop: i ? 3 * u : 0, backgroundColor: "#ffffff", color: P.titulo, borderRadius: 999, padding: 3.4 * u, justifyContent: "center", fontFamily: X, fontSize: 5.4 * u, boxShadow: `0 ${1.2 * u}px 0 ${P.titulo}` }, mayus(o)),
          ),
        ]),
      ]
      break
    case "imp_pedido": {
      // Imán / etiqueta: foto arriba, abajo la marca, la frase, el WhatsApp grande y el QR.
      // Va calculado sobre el lado corto, así sirve vertical u horizontal.
      const horizontal = W > H
      const corto = Math.min(W, H)
      const v = corto / 100
      const fotoAlto = horizontal ? H : H * 0.5
      const fotoAncho = horizontal ? W * 0.45 : W
      const qrLado = 24 * v
      const nombre = mayus(opts.nombreMarca ?? marca)
      const zona = { left: horizontal ? fotoAncho : 0, top: horizontal ? 0 : fotoAlto, width: horizontal ? W - fotoAncho : W, height: horizontal ? H : H - fotoAlto }
      const pad = 7 * v
      hijos = [
        fondo(P.fondo),
        abs({ left: 0, top: 0, width: fotoAncho, height: fotoAlto, overflow: "hidden" }, [img(foto)]),
        abs({ ...zona, flexDirection: "column", justifyContent: "space-between", padding: pad }, [
          el({ flexDirection: "column" }, [
            el({ fontFamily: T, fontSize: entra(nombre, zona.width - 2 * pad, 9 * v, 0.7), letterSpacing: "0.06em", color: P.titulo, lineHeight: 1 }, nombre),
            ...(c.titulo ? [el({ fontFamily: A, fontSize: 6 * v, color: conAlfa(P.titulo, 0.85), marginTop: 1.5 * v, lineHeight: 1.1 }, c.titulo)] : []),
          ]),
          el({ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, [
            el({ flexDirection: "column", flexShrink: 1, marginRight: 3 * v }, [
              el({ fontFamily: X, fontSize: 4 * v, letterSpacing: "0.14em", color: P.acento === P.fondo ? P.titulo : P.acento }, "PEDÍ POR WHATSAPP"),
              el({ fontFamily: T, fontSize: entra(c.linea ?? "", zona.width - 2 * pad - qrLado - 3 * v, 8.5 * v, 0.58), color: P.titulo, marginTop: 1 * v, lineHeight: 1.05 }, c.linea ?? ""),
              ...(c.pie ? [el({ fontFamily: X, fontSize: 3.4 * v, color: conAlfa(P.titulo, 0.75), marginTop: 1.6 * v, lineHeight: 1.25 }, c.pie)] : []),
            ]),
            ...(opts.qr
              ? [el({ width: qrLado, height: qrLado, flexShrink: 0, backgroundColor: "#ffffff", padding: 1.4 * v, borderRadius: 1.5 * v }, [{ type: "img", props: { src: opts.qr, style: { width: "100%", height: "100%" } } } as El])]
              : []),
          ]),
        ]),
      ]
      break
    }
    default:
      throw new Error(`plantilla sin dibujo: ${p.id}`)
  }

  const fuentes = [kit.titulo, kit.texto, ...(kit.acento ? [kit.acento] : [])].map((f) => ({ name: f.name, data: f.data, weight: (f.weight ?? 400) as 400, style: "normal" as const }))
  const svg = await satori(el({ width: W, height: H, position: "relative", overflow: "hidden", backgroundColor: P.fondo }, hijos) as never, { width: W, height: H, fonts: fuentes })
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng())
}
