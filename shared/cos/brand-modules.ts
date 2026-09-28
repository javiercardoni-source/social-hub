/**
 * Módulos de la entrevista de marca (Branding Manager). Método de la skill
 * brand-discovery (.claude/skills/brand-discovery), adaptado a marcas de comida con
 * delivery: se cambió "founder tension" por identidad visual y reglas de contenido,
 * que es lo que después usan los textos y las plantillas.
 */

export const BRAND_MODULES = [
  {
    id: "proposito",
    label: "Propósito",
    frameworks: "Golden Circle (Sinek): por qué → cómo → qué",
    goal: "La convicción de fondo: por qué existe la marca más allá de vender comida. Lo que se niega a ser.",
    topics: [
      "Por qué se creó esta marca y no otra (la historia real, el momento)",
      "Qué cree la marca que otros en el rubro no creen",
      "Valores en acción: cosas concretas que hacen distinto en la cocina o en el delivery",
      "Qué NO quiere ser nunca",
    ],
  },
  {
    id: "posicionamiento",
    label: "Posicionamiento",
    frameworks: "Dunford (Obviously Awesome), plantilla de Moore",
    goal: "Contra qué compite en la cabeza del cliente y qué la hace la opción obvia para alguien.",
    topics: [
      "Alternativas reales del cliente (otras marcas, apps de delivery, cocinar, otro tipo de comida)",
      "Atributos únicos que solo esta marca tiene",
      "El valor que esos atributos le dan al cliente, con ejemplos",
      "Categoría en la que quiere jugar y el territorio que quiere ser dueña",
    ],
  },
  {
    id: "publico",
    label: "Cliente ideal",
    frameworks: "Perfil de cliente ideal: situación, disparador, resultado deseado",
    goal: "Una persona concreta y sus momentos de consumo: cuándo, dónde, con quién y por qué pide.",
    topics: [
      "El mejor cliente actual (describir a una persona real, no un segmento)",
      "Momentos y disparadores del pedido (día, hora, ocasión, clima, con quién)",
      "Qué le preocupa o qué quiere evitar al pedir",
      "Quién NO es cliente o no conviene atraer",
      "Historias o mensajes reales de clientes",
    ],
  },
  {
    id: "personalidad",
    label: "Personalidad",
    frameworks: "12 arquetipos (Mark & Pearson), 5 dimensiones de J. Aaker",
    goal: "Cómo sería la marca si fuera una persona: arquetipo principal y secundario, rasgos.",
    topics: [
      "Si la marca fuera una persona: cómo entra a un lugar, cómo se viste, qué música escucha",
      "Tres adjetivos que la definen y tres que nunca",
      "Arquetipo principal y secundario (proponerlos y validarlos)",
      "Marcas o personajes que admira y cuáles serían el modelo equivocado",
    ],
  },
  {
    id: "voz",
    label: "Voz y tono",
    frameworks: "Espectro de voz (formal↔casual, serio↔juguetón, distante↔cálido, convencional↔irreverente)",
    goal: "Que dos redactores distintos escriban como la misma persona. Voz fija, tono según el contexto.",
    topics: [
      "Textos o posts que le encantan (propios o ajenos) y por qué",
      "Textos que le parecen el registro equivocado y qué tienen de malo",
      "Palabras y expresiones que usan siempre, y las que evitan",
      "Emojis: cuáles, cuántos, cuándo ninguno",
      "Cómo cambia el tono en: post de producto, historia, promo, disculpa por demora",
      "Frases 'siempre…' / 'nunca…' sobre cómo habla la marca",
    ],
  },
  {
    id: "visual",
    label: "Identidad visual",
    frameworks: "Sistema visual: paleta, tipografía, logo, fotografía, texto sobre imagen",
    goal: "Reglas visuales precisas para que las plantillas y las fotos sean inconfundibles de la marca.",
    topics: [
      "Paleta: colores principales y de acento (confirmar los detectados), colores prohibidos",
      "Tipografías: confirmar las detectadas, sensación buscada",
      "Logo y mascota: cuándo y cómo usarlos, tamaño, qué nunca hacer",
      "Estilo de foto: fondos, luz, ángulos, manos/guantes, props, qué evitar",
      "Texto sobre la imagen: cuándo sí y cuándo no, largo, tono, ejemplos de frases buenas",
      "Cuentas de Instagram (de cualquier rubro) cuyo estilo visual admira y por qué",
    ],
  },
  {
    id: "reglas",
    label: "Reglas de contenido",
    frameworks: "Pilares de contenido, claims permitidos, guardrails",
    goal: "Qué se puede decir y prometer, de qué se habla y en qué proporción. Lo que nunca se publica.",
    topics: [
      "Pilares de contenido (producto, detrás de escena, equipo, clientes, humor, promos) y proporción",
      "Qué se puede prometer y qué nunca (tiempos de entrega, 'el mejor', precios, frescura)",
      "Promos y beneficios reales vigentes, y cómo se comunican",
      "Horarios, zonas y canales de pedido correctos, llamado a la acción preferido",
      "Temas sensibles o prohibidos (política, competencia, fútbol, etc.)",
      "Fechas y momentos especiales que le importan a la marca",
    ],
  },
] as const

export type BrandModuleId = (typeof BRAND_MODULES)[number]["id"]
export const BRAND_MODULE_IDS = BRAND_MODULES.map((m) => m.id) as BrandModuleId[]

/** Lo que ya se sabe de lo visual (análisis de sus Instagram, 28-09-2026): se confirma, no se pregunta de cero. */
export const VISUAL_BASELINE: Record<string, string> = {
  fasutofudo:
    "Detectado en su Instagram: mascota de onigiri con sombrero de salmón corriendo; wordmark FASUTO FUDO en tipografía redonda y gruesa (hoy usamos Lilita One) con etiqueta roja 'SUSHI'; flores de sakura; fondo carbón casi negro; colores mostaza (#F4B630), rojo bermellón (#E14B32), crema y rosa sakura. Fotos: onigiris sostenidos con guante negro, Obelisco de fondo, estilo dibujo retro.",
  bijutsukan:
    "Detectado en su Instagram: logo BIJUTSUKAN en letras altas y finas con '— DELIVERY —' espaciado debajo (hoy usamos Bebas Neue); solo blanco y negro. Fotos: fondo oscuro, pizarra negra, flores, guante negro, piezas en primer plano; casi sin texto sobre la imagen.",
  sensaciones:
    "Detectado en su Instagram: no tiene logo visible (la foto de perfil es un roll con palitos); los posts recientes parecen fotos de banco, sin texto ni marca. DECIDIDO por Javier (28-09-2026): se abandona el naranja de la web vieja. Paleta: marfil #F7F6F2, negro #111111, rojo profundo #C53030, dorado suave #C9A96E. Títulos en sans condensada bold (Oswald), textos en Montserrat. Sin logo oficial todavía: se firma con el nombre.",
}
