// ─────────────────────────────────────────────────────────────────────────────
// ARGOS — captura de pantalla. Copiar a: src/lib/argos.capture.ts
//
// Autocontenido: solo depende de `modern-screenshot` (import dinámico, no pesa
// en el bundle inicial). No importa nada del proyecto.
//
// [FIX-2026-08-20] Por qué existe este archivo en vez de llamar domToJpeg pelado:
//
//   modern-screenshot clona el DOM y lo serializa dentro de un <foreignObject>.
//   Ese clon NO conserva el scroll: todo contenedor con overflow arranca en
//   scrollTop = 0. En una pantalla estática no se nota; en una lista scrolleada
//   la captura muestra el principio de la lista en vez de lo que el usuario ve.
//
//   Con listas VIRTUALIZADAS (@tanstack/react-virtual, react-window, Virtuoso)
//   es peor: los items van position:absolute + translateY(<offset del scroll>)
//   dentro de un contenedor de la altura total, y solo existen en el DOM los
//   ~10 visibles. Al perderse el scroll quedan miles de px por debajo del área
//   visible → el panel sale COMPLETAMENTE VACÍO. Es exactamente lo que pasaba
//   con los chats del dashboard de WhatsApp: se capturaba el wallpaper y nada más.
//
// Qué hace acá:
//   1. Marca en el DOM real qué contenedores están scrolleados (y sus estilos
//      de layout), sin tocar nada visible.
//   2. En el clon, "aplana" ese scroll: mueve los hijos por -scrollTop con un
//      wrapper transformado. Los items virtuales caen justo donde se los ve.
//   3. Recorta al viewport (lo que el usuario tiene delante, no el documento
//      entero) y compensa el scroll de la ventana.
//   4. Sustituye las imágenes que no cargaron por un placeholder gris, así una
//      foto cross-origin caída no deja un ícono roto en el medio del reporte.
//   5. Baja calidad/resolución hasta entrar en el límite de subida, en vez de
//      mandar un data URL de 8 MB que el endpoint descarta.
//
// Por qué NO usamos `features: { restoreScrollPosition: true }` (flag nativo de
// la librería, apagado por default): le aplica el shift a cada hijo DIRECTO del
// scroller pisándole su transform propio (`matrix.e/f` se sobrescriben en vez de
// componerse). En una lista virtualizada donde los items cuelgan directo del
// scroller, todos terminan con el mismo translate y se apilan uno arriba del
// otro. El wrapper de acá agrega un nivel en vez de tocar los hijos: compone
// bien pase lo que pase con la estructura.
// ─────────────────────────────────────────────────────────────────────────────

const SCROLL_ATTR = "data-argos-scroll";
const BROKEN_ATTR = "data-argos-broken";
const STICKY_ATTR = "data-argos-sticky";

/** Nodos con este atributo no entran en la captura (el propio botón de Argos). */
export const IGNORE_ATTR = "data-error-report-ignore";

/** El default de modern-screenshot son 30s: una imagen cross-origin que no
 *  responde dejaba al operador mirando el spinner medio minuto. */
const CAPTURE_TIMEOUT = 8000;

/** El endpoint corta en 9 MB. Apuntamos MUY por debajo: la captura viaja como
 *  base64 dentro de un JSON junto a hasta 5 fotos adjuntas. */
const TARGET_BYTES = 1_200_000;
const MIN_QUALITY = 0.45;

/** Cap de resolución: un monitor 4K con devicePixelRatio 2 daba capturas de
 *  7680px de ancho para nada — el texto ya se lee cómodo a 1.5x. */
const MAX_SCALE = 1.5;

export interface CaptureResult {
  /** data URL JPEG, o null si la captura falló por completo. */
  dataUrl: string | null;
  /** Avisos no fatales (imágenes caídas, captura degradada). Para logging. */
  warnings: string[];
}

// ── Layout de un scroller, serializado para reconstruirlo en el clon ─────────
interface ScrollInfo {
  x: number;
  y: number;
  display: string;
  flexDirection: string;
  flexWrap: string;
  gap: string;
  alignItems: string;
  justifyContent: string;
  gridTemplateColumns: string;
}

/**
 * Recorre el DOM real y deja marcados los contenedores scrolleados y las
 * imágenes rotas. Los atributos se clonan junto al nodo, que es como después
 * los encontramos del otro lado (en `onCloneNode` no hay referencia al original).
 *
 * Devuelve la función que limpia las marcas — llamarla SIEMPRE, en `finally`.
 */
function markDom(root: HTMLElement): () => void {
  // Dos pases a propósito: leer scrollTop invalida el layout, y escribir un
  // atributo lo vuelve a ensuciar. Intercalarlos serían N reflows en vez de 1.
  const scrollers: { el: HTMLElement; info: ScrollInfo }[] = [];
  const broken: { el: HTMLImageElement; w: number; h: number }[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    // REJECT (no SKIP): lo que se excluye de la captura se poda con sus hijos,
    // así no medimos scroll de nodos que no van a existir en el clon.
    acceptNode: (node) =>
      (node as HTMLElement).hasAttribute(IGNORE_ATTR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as HTMLElement;

    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      const cs = getComputedStyle(el);
      scrollers.push({
        el,
        info: {
          x: Math.round(el.scrollLeft),
          y: Math.round(el.scrollTop),
          display: cs.display,
          flexDirection: cs.flexDirection,
          flexWrap: cs.flexWrap,
          gap: cs.gap,
          alignItems: cs.alignItems,
          justifyContent: cs.justifyContent,
          gridTemplateColumns: cs.gridTemplateColumns,
        },
      });
    }

    // naturalWidth 0 con src puesto = no cargó (404, CORS, o todavía en vuelo).
    if (el instanceof HTMLImageElement && el.src && !el.naturalWidth) {
      broken.push({ el, w: el.offsetWidth, h: el.offsetHeight });
    }
  }

  for (const { el, info } of scrollers) el.setAttribute(SCROLL_ATTR, JSON.stringify(info));
  for (const { el, w, h } of broken) el.setAttribute(BROKEN_ATTR, `${w}x${h}`);

  // Tercer pase: los `position: sticky` DENTRO de un scroller. Al aplanar, el
  // wrapper con transform crea un containing block y el sticky deja de pegarse
  // (un header de tabla o el total de un pedido se iban con el scroll y salían
  // recortados). Guardamos dónde están en pantalla para reanclarlos en el clon.
  // Va después de escribir SCROLL_ATTR porque usa closest() sobre ese atributo.
  const stickies: { el: HTMLElement; box: string }[] = [];
  for (const { el: sc } of scrollers) {
    const cs = getComputedStyle(sc);
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const scRect = sc.getBoundingClientRect();

    for (const el of sc.querySelectorAll<HTMLElement>("*")) {
      if (getComputedStyle(el).position !== "sticky") continue;
      // Con scrollers anidados, cada sticky le toca al más cercano.
      if (el.closest(`[${SCROLL_ATTR}]`) !== sc) continue;
      const r = el.getBoundingClientRect();
      // Relativo al padding box del scroller, que es contra lo que se posiciona
      // un absolute cuando el scroller es el contenedor posicionado.
      stickies.push({
        el,
        box: [r.left - scRect.left - bl, r.top - scRect.top - bt, r.width, r.height]
          .map((n) => Math.round(n))
          .join(","),
      });
    }
  }
  for (const { el, box } of stickies) el.setAttribute(STICKY_ATTR, box);

  return () => {
    for (const { el } of scrollers) el.removeAttribute(SCROLL_ATTR);
    for (const { el } of broken) el.removeAttribute(BROKEN_ATTR);
    for (const { el } of stickies) el.removeAttribute(STICKY_ATTR);
  };
}

/**
 * El corazón del fix. Por cada scroller marcado, envuelve sus hijos en un div
 * desplazado por -scroll y apaga el overflow. Lo que quedaba fuera de vista
 * queda recortado, y lo visible aterriza en la misma posición que en pantalla.
 */
function flattenScrollers(root: Element): void {
  const scrollers = root.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`);

  for (const sc of scrollers) {
    const raw = sc.getAttribute(SCROLL_ATTR);
    sc.removeAttribute(SCROLL_ATTR);

    let info: ScrollInfo;
    try {
      info = JSON.parse(raw || "");
    } catch {
      continue;
    }
    if (!info || (!info.x && !info.y)) continue;

    const shift = sc.ownerDocument.createElement("div");

    // El wrapper toma el rol de contenedor: si el scroller era flex/grid, sus
    // hijos siguen esperando ese contexto. Sin esto, una lista en flex-col se
    // desarma en la captura.
    const isFlex = info.display.includes("flex");
    const isGrid = info.display.includes("grid");
    if (isFlex || isGrid) {
      shift.style.display = info.display;
      shift.style.flexDirection = info.flexDirection;
      shift.style.flexWrap = info.flexWrap;
      shift.style.gap = info.gap;
      shift.style.alignItems = info.alignItems;
      shift.style.justifyContent = info.justifyContent;
      if (isGrid) shift.style.gridTemplateColumns = info.gridTemplateColumns;
      // El scroller pasa a ser una caja común: el layout ahora vive en el wrapper.
      sc.style.display = "block";
    }

    // El wrapper crece libre en el eje que scrollea y llena el scroller en el
    // otro. Si no llena el eje transversal, un `align-items: center` en una fila
    // horizontal se centra contra la altura del contenido en vez de la del
    // scroller, y las tarjetas terminan pegadas arriba en vez de en el medio.
    if (info.x) {
      shift.style.width = "max-content";
      shift.style.minWidth = "100%";
    } else {
      shift.style.width = "100%";
    }
    if (!info.y) shift.style.height = "100%";

    shift.style.transform = `translate(${-info.x}px, ${-info.y}px)`;
    shift.style.transformOrigin = "top left";

    while (sc.firstChild) shift.appendChild(sc.firstChild);
    sc.appendChild(shift);

    // Los sticky se redibujan como una copia absoluta anclada al scroller, en la
    // posición que tenían en pantalla. Copia y no mudanza: un `position: sticky`
    // sigue ocupando su lugar en el flujo aunque esté pegado, así que llevarse el
    // nodo hacía subir todo lo que venía abajo. El original se queda de
    // espaciador, invisible. Duplicarlo es seguro porque modern-screenshot ya
    // volcó los estilos computados a cada nodo: no dependen de la herencia.
    for (const st of shift.querySelectorAll<HTMLElement>(`[${STICKY_ATTR}]`)) {
      // Con scrollers anidados los de afuera se procesan primero y verían también
      // los sticky de los de adentro. Al nuestro ya le sacamos SCROLL_ATTR, así
      // que si todavía hay un scroller marcado en el medio, el sticky es de él.
      if (st.closest(`[${SCROLL_ATTR}]`)) continue;

      const [left, top, width, height] = (st.getAttribute(STICKY_ATTR) || "").split(",").map(Number);
      st.removeAttribute(STICKY_ATTR);
      if ([left, top, width, height].some((n) => Number.isNaN(n))) continue;

      const stuck = st.cloneNode(true) as HTMLElement;
      stuck.style.position = "absolute";
      stuck.style.left = `${left}px`;
      stuck.style.top = `${top}px`;
      stuck.style.width = `${width}px`;
      stuck.style.height = `${height}px`;
      stuck.style.transform = "none";
      sc.appendChild(stuck);

      // opacity y no visibility: modern-screenshot le copió `visibility: visible`
      // a cada descendiente, así que esconder al padre no los taparía. opacity
      // aplica al subárbol entero como grupo y conserva el espacio del flujo.
      st.style.opacity = "0";
    }

    // El absolute de los sticky necesita que el scroller sea el ancla.
    // Leemos style.position y no getComputedStyle: el clon no está en el
    // documento (getComputedStyle devolvería vacío), pero modern-screenshot ya
    // volcó los estilos computados a inline en cada nodo.
    if (!sc.style.position || sc.style.position === "static") sc.style.position = "relative";

    // El contenido desplazado se sale por arriba: sin esto lo pintaría igual.
    sc.style.overflow = "hidden";
  }
}

/**
 * Las imágenes que no cargaron se serializan como ícono roto (o como un hueco).
 * Mejor un recuadro que diga qué había ahí: el que lee el reporte entiende que
 * el problema es la imagen, no la captura.
 *
 * Le cambiamos el `src` en vez de reemplazar el nodo: así el <img> conserva su
 * box model exacto (inline, vertical-align, márgenes, clases). Sustituirlo por
 * un <div> corría el contenido de abajo — un block no ocupa el mismo lugar que
 * un inline en el flujo. El data URI además no dispara ningún fetch.
 */
function replaceBrokenImages(root: Element): number {
  const imgs = root.querySelectorAll<HTMLImageElement>(`[${BROKEN_ATTR}]`);

  for (const img of imgs) {
    const [w, h] = (img.getAttribute(BROKEN_ATTR) || "0x0").split("x").map(Number);
    img.removeAttribute(BROKEN_ATTR);

    const vw = Math.max(1, w || 120);
    const vh = Math.max(1, h || 90);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">` +
      `<rect x="1" y="1" width="${vw - 2}" height="${vh - 2}" rx="6" fill="#e2e2e2" stroke="#9a9a9a" stroke-width="2" stroke-dasharray="5 4"/>` +
      // Ícono de "montaña + sol", el universal de imagen no disponible.
      `<g transform="translate(${vw / 2 - 14},${vh / 2 - 11})" fill="none" stroke="#7a7a7a" stroke-width="2">` +
      `<rect x="1" y="1" width="26" height="20" rx="2"/><circle cx="8" cy="8" r="2.5"/>` +
      `<path d="M2 18l7-7 5 5 4-3 7 6"/></g></svg>`;

    img.removeAttribute("srcset");
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return imgs.length;
}

/** Bytes reales detrás de un data URL base64 (base64 infla ~4/3). */
function bytesOf(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.round((dataUrl.length - comma - 1) * 0.75);
}

/** Baja calidad primero y resolución después, hasta entrar en el target. */
function encode(canvas: HTMLCanvasElement, warnings: string[]): string {
  let quality = 0.75;
  let out = canvas.toDataURL("image/jpeg", quality);

  while (bytesOf(out) > TARGET_BYTES && quality > MIN_QUALITY) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }

  // Si con calidad mínima sigue sin entrar (pantallas muy grandes), redimensionamos.
  if (bytesOf(out) > TARGET_BYTES) {
    const scaled = document.createElement("canvas");
    scaled.width = Math.max(1, Math.round(canvas.width * 0.7));
    scaled.height = Math.max(1, Math.round(canvas.height * 0.7));
    const ctx = scaled.getContext("2d");
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
      out = scaled.toDataURL("image/jpeg", 0.6);
      warnings.push("captura redimensionada por tamaño");
    }
  }

  return out;
}

/**
 * Captura lo que el usuario está viendo. Nunca lanza: si algo falla devuelve
 * `dataUrl: null` y el reporte sale igual con la nota escrita a mano.
 */
export async function captureViewport(): Promise<CaptureResult> {
  const warnings: string[] = [];
  const cleanup = markDom(document.body);

  try {
    const { domToCanvas } = await import("modern-screenshot");

    const scrollX = Math.round(window.scrollX);
    const scrollY = Math.round(window.scrollY);
    let brokenCount = 0;

    // El clon del <body> se reinserta dentro de un <foreignObject> y ahí vuelve
    // a pegarle el `body { margin: 8px }` del user-agent: modern-screenshot no
    // copia `margin: 0` porque es el default de un div, así que la captura salía
    // entera corrida 8px en diagonal. Lo forzamos al valor real del proyecto.
    const bodyStyle = getComputedStyle(document.body);
    const rootStyle: Partial<CSSStyleDeclaration> = {
      margin: bodyStyle.margin,
      // El scroll de la ventana tampoco sobrevive al clon: lo compensamos acá.
      ...(scrollX || scrollY
        ? { transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: "top left" }
        : {}),
    };

    const canvas = await domToCanvas(document.body, {
      // Recortamos al viewport: es lo que el usuario tiene delante, y evita
      // arrastrar un documento de 12.000px que después hay que comprimir a la nada.
      // clientWidth/Height y no innerWidth/Height: estos últimos incluyen la
      // barra de scroll y dejaban una franja de fondo al costado.
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      scale: Math.min(window.devicePixelRatio || 1, MAX_SCALE),
      backgroundColor: bodyStyle.backgroundColor || "#ffffff",
      timeout: CAPTURE_TIMEOUT,
      style: rootStyle,
      // El botón/modal de Argos no van en su propia captura.
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute(IGNORE_ATTR)),
      onCloneNode: (cloned) => {
        if (!(cloned instanceof Element)) return;
        flattenScrollers(cloned);
        brokenCount = replaceBrokenImages(cloned);
      },
    });

    if (brokenCount > 0) warnings.push(`${brokenCount} imagen(es) no cargaron`);

    return { dataUrl: encode(canvas, warnings), warnings };
  } catch (e) {
    console.error("[Argos] captura falló:", e);
    return { dataUrl: null, warnings: [(e as Error)?.message || "error desconocido"] };
  } finally {
    cleanup();
  }
}
