# Prompts del motor de reels (F9)

Probados el 30-09-2026 con material real de Sensaciones (Sensa15.mp4, Social.mp4 y 5 fotos del
archivo). Modelo: el de `cos_settings.ai_model` (hoy `claude-sonnet-5`). **`max_tokens` alto
(12000)**: con 4000 la respuesta llegó vacía una vez porque el modelo gastó todo pensando.

Usar **salida estructurada** (`messages.parse` + zod, como el resto de `worker/src/ai.ts`) en vez
de "respondé solo JSON". El resultado SIEMPRE pasa por `normalizarGuion()` (shared/cos/reel.ts)
antes de usarse.

---

## 1. Guion del reel (una llamada, con todas las fuentes)

**Entrada (content del mensaje de usuario), en este orden:**

1. Por cada fuente `i` (fotos y/o videos que eligió Javier):
   - texto: `Fuente {i} · {foto|video de N s} · tomas medidas: 0.0–2.1, 2.1–5.3, …` (solo videos,
     con `sceneCuts()` de `worker/src/media.ts`)
   - imágenes: foto → la foto a 512 px de ancho. Video → un cuadro al medio de cada toma (máx. 6
     por video, con `framesAt()`), cada uno precedido por el texto `Fuente {i}, segundo {t}:`.
2. El texto de instrucciones de abajo.

**System:** `brandSystemPrompt(brand)` (shared/cos/prompts.ts): trae brandbook aprobado, datos
vigentes, palabras prohibidas. Con `cache_control: ephemeral`.

**Instrucciones:**

```
Sos editor de reels de {MARCA}. Armás un REEL vertical 9:16 de 12 a 16 s con estas fuentes.

Tomas: 4 a 6. Cada una sale de UNA fuente:
- video: trim_start y duracion en segundos, DENTRO de una sola toma medida (no cruces un corte).
- foto: movimiento tipo Ken Burns (no lleva trim).
Duración de cada toma: 1.6 a 2.8 s. Arrancá con la más impactante. Alterná planos (general,
detalle, gente disfrutando si hay) y no repitas el mismo momento.
movimiento: "acercar" | "alejar" | "paneo_derecha" | "paneo_izquierda".
foco_x, foco_y (0 a 1): dónde está lo más apetitoso (hacia ahí se acerca la cámara).
transicion de entrada: "corte" | "fundido" (mayoría cortes, al ritmo; fundido para respirar).

Textos (MAYÚSCULAS, cortos, en la voz de la marca):
- gancho (2 a 3 palabras): va sobre la primera toma y es la TAPA del reel en el perfil.
- medio (2 a 3 palabras): sobre la tercera toma.
- titulo_cierre (2 a 3 palabras): placa final en negro.
- recuadro: una de {RECUADROS} (o vacío).
- combo: si la fuente muestra claramente un combo de DATOS VIGENTES, su nombre exacto; si no, vacío.
- musica: una de {TEMAS DE LA BIBLIOTECA DE LA MARCA}.

Reglas de marca (no negociables):
- Nunca inventes escasez ("últimos", "hasta agotar stock", "cupos") ni precios.
- No prometas frescura como dato técnico ("recién hecho", "fresquísimo").
- La bebida (vino, cerveza) nunca es protagonista, aunque aparezca.
- No uses tomas de videos que ya tienen placas de texto viejas o logos de otras marcas.
- Si hay personas, que sea disfrutando; nada de caras en primer plano si la fuente está bloqueada
  por consentimiento (esas fuentes no te llegan).
```

**Salida (zod):**

```ts
z.object({
  tomas: z.array(z.object({
    fuente: z.number().int(),
    trim_start: z.number(),          // 0 en fotos
    duracion: z.number(),
    movimiento: z.enum(["acercar", "alejar", "paneo_derecha", "paneo_izquierda"]),
    foco_x: z.number(), foco_y: z.number(),
    transicion: z.enum(["corte", "fundido"]),
    por_que: z.string(),             // para que Javier entienda la elección (se muestra en Aprobaciones)
  })),
  gancho: z.string(), medio: z.string(), titulo_cierre: z.string(),
  recuadro: z.string(), combo: z.string(), musica: z.string(),
  idea: z.string(),                  // una línea: qué cuenta el reel
})
```

Ejemplo real de salida (Social.mp4, 30-09): tomas 0.4 s (acercar, mesa de amigos) → 7.6 s (acercar,
mano con sésamo en la salsa) → 19.9 s (alejar, alguien comiendo) → 37.0 s → 41.0 s (fundido);
gancho "PLAN CON AMIGOS" (la IA propuso "BRINDIS DE AMIGOS" y se cambió: bebida no protagonista),
medio "SABOR QUE UNE", cierre "NOCHE DE SUSHI", recuadro "PLAN EN CASA".

---

## 2. Texto de la publicación (caption)

Ya existe: `writeCaption()` en `worker/src/ai.ts` con `captionPrompt()` (shared/cos/prompts.ts).
Para reels llamarla con `postType: "reel"` y en `description` pasar la `idea` del guion + las
descripciones de las fuentes. El `overlay` que devuelve NO se usa en reels (el texto de la tapa es
`gancho`).

---

## 3. Cierre: de dónde sale cada dato (sin IA)

| Dato | Fuente | Si falta |
|---|---|---|
| precio | `cos_brands.datos_vigentes.combos[]` con `activo` y `precio`, cuyo `nombre` = `guion.combo` | el cierre va SIN precio |
| pie | `datos_vigentes.zonas` (si ≤ 40 caracteres: `ENVÍOS {zonas}`) o `retiro` | sin pie |
| logo | kit de la marca (`kitDeMarca()`); Sensaciones va SIN firma | — |

Nunca usar el "$ 31.900" de las pruebas: era un ejemplo de diseño.
