# F11 · Motor de Vitrinas — plan (01-10-2026)

## Qué hace

Cada vez que se arma un **grupo de anuncios** para una marca, el motor genera sola una
**vitrina**: una web pública, sin login, con los anuncios en teléfonos tal como se ven en Reels,
su texto, su oferta y un botón **«Compartir en Instagram»** en cada uno.

- Javier y el equipo la abren, eligen la que más les gusta y la suben a su Instagram (historia o
  reel) en dos toques.
- El equipo la recibe como **historia en la PWA de Turnos** (y queda fija en Enlaces).
- Cada marca guarda las últimas **N** vitrinas. Al crear la N+1, la más vieja se retira y **su
  link se recicla**: redirige a la vitrina vigente de la marca, así ningún link compartido queda
  en un 404.

Modelo de partida: la vitrina hecha a mano para FasutoFudo el 01-10
(`https://informes.kitchcocenter.com/fasutofudo-anuncios-onigiris-octubre-2026-49hrdsjx/`,
fuente en `Marcas/Fasutofudo/ads-2026-10/mockup-socio/`).

## Lo que ya existe y se reusa

| Pieza | Dónde | Para qué |
|---|---|---|
| Diseño de la vitrina (teléfonos, ficha, burbuja de WhatsApp) | mockup de FF del 01-10 | Plantilla base; colores y logo salen de `cos_brands` / `cos_brand_assets` |
| Anuncios con creativo, texto, CTA y videos guardados | F10 E1: `cos_ads` + `cos-media` | Contenido de la vitrina (los links de video de Meta vencen: se usan los guardados) |
| Worker con ffmpeg, cola `cos_jobs`, handlers | `worker/src/handlers.ts` | Jobs nuevos `vitrina:*` |
| Publicación de Reels/Historias y permalinks | `worker/src/meta.ts`, `cos_media.permalink` | Botón «Ver en Instagram» para repostear el posteo original |
| Historias de la PWA (incluye «historias del sistema») | Turnos: `stories`, migración 0144, `lib/historias-sistema.ts`, `StoriesBar` | Aviso al equipo |
| Enlaces fijos de la PWA | Turnos: `portal_links` (tab `/app/sistemas` → Enlaces) | Acceso permanente por marca |
| Marca del empleado | Turnos: `users.kitchen_id` → `kitchens.brand_slugs` | Mostrar a cada uno solo su marca |
| Nginx en `kitchco-soluciones` (179.197.225.55) | mismo servidor que Social Hub | Servir las vitrinas como estáticos |
| Alta de subdominio | API de Hostinger, patrón de `infra/mover-dns-soluciones.sh` | Un único registro A |

## Cómo funciona el botón «Compartir en Instagram»

Desde una web **no existe un link que suba un video a Instagram**. Hay tres caminos y la vitrina
usa los tres según el aparato:

1. **Celular (principal): menú de compartir del teléfono.** `navigator.share({ files: [video] })`
   abre la hoja nativa; la persona toca Instagram y elige Historia, Reel, Feed o mensaje.
   Anda en iPhone (Safari) y Android (Chrome) con mp4. Dos detalles técnicos:
   - iOS exige que `share()` se llame dentro del toque: el video (versión 720p, ~3-5 MB) se
     **precarga como blob** cuando la tarjeta aparece en pantalla, no al tocar.
   - Instagram no recibe texto en historias: al compartir se **copia al portapapeles** el texto
     sugerido con la mención (`@fasutofudo`) para pegarlo.
2. **Repostear el original** (opcional por vitrina): si el anuncio también salió como Reel
   orgánico de la marca, botón **«Ver en Instagram»** → abre el permalink → la persona usa el
   compartir nativo de Instagram y queda como repost con la marca etiquetada.
3. **Compu o navegador sin soporte:** botón **«Descargar video»** + instrucción corta.

Cada toque se registra (anónimo) para saber **cuál es la favorita del equipo**.

## Dónde viven las vitrinas y cómo se reciclan los links

**Recomendación: un solo subdominio, links por ruta, no dominios nuevos.** No hay comodín `*` en el
DNS: cada subdominio nuevo pide registro A + certificado. Reciclar dominios sería mantener un pool
de subdominios con certificados; reciclar rutas no cuesta nada.

```
vitrina.kitchcocenter.com/fasutofudo/                  → siempre la vigente de la marca (link fijo)
vitrina.kitchcocenter.com/fasutofudo/onigiris-oct-k3x9/ → una vitrina puntual (slug impredecible)
```

- **Estáticos:** el worker escribe HTML + videos en una carpeta del host montada en el contenedor
  (`/srv/vitrinas/<marca>/<slug>/`) y nginx la sirve. Sin pasar por Next ni por URLs firmadas
  (el bucket `cos-media` es privado y sus firmas vencen). Todo `noindex`, la raíz da 404.
- **Rotación:** cada marca guarda las últimas **N** (propuesta: 6). Al publicar la N+1:
  borra los archivos de la más vieja, la marca `retirada` y su ruta pasa a **redirigir (302) a la
  vigente**. Un link viejo en una historia o en WhatsApp sigue llevando a algo útil.
- **Peso:** ~25 MB por vitrina (4 anuncios × versión liviana + versión para compartir).
  6 por marca × 5 marcas ≈ 750 MB.

## Cuándo se genera

| Disparador | Cuándo | Etapa |
|---|---|---|
| **Desde una campaña de Meta** | Botón «Armar vitrina» en Content OS: pegás el ID de la campaña (o la elegís de la lista) y el worker baja anuncios, textos y videos por la API | V1 (cubre el flujo manual de hoy, como la campaña de FF del 01-10) |
| **Automático desde F10** | Cuando una tanda del Motor de ADS se aprueba y queda creada en Meta (E4), se encola `vitrina:build` | V3 |

Antes de avisar al equipo hay un paso de **aprobación** (ver decisiones): la vitrina se arma
sola, pero la historia de Turnos sale cuando Javier la aprueba.

## Etapas

### V0 · Plantilla y botón (Sonnet)
- La plantilla de la vitrina como módulo compartido `shared/cos/vitrina/` (HTML + CSS, sin
  framework), con los tokens de color y logo de la marca y los tres caminos de compartir.
- Script `npm run vitrina -- --campaign <id>` que arma la carpeta en local, para probar con la
  campaña de FF y reemplazar la vitrina hecha a mano.

### V1 · El motor en Social Hub (Opus: migración, worker, infra)
- Migración: `cos_vitrinas` (marca, slug, título, estado `armando|lista|aprobada|retirada`, origen,
  `meta_campaign_id`, url, fechas, `turnos_story_id`), `cos_vitrina_items` (orden, `cos_ad_id` o
  `meta_ad_id`, título, texto, chip de oferta, mensaje pre-escrito, claves de video y portada en
  `cos-media`, permalink IG opcional), `cos_vitrina_events` (ítem, tipo `vista|compartir|descarga|ver_ig`,
  fecha). Ajuste por marca: `vitrinas_max` (default 6).
- Jobs del worker: `vitrina:build` (baja o toma de `cos-media`, transcodifica 540p para mirar y
  720p para compartir, renderiza, escribe en `/srv/vitrinas`, actualiza el link fijo de la marca,
  corre la rotación) y `vitrina:retire`.
- Filtro antes de publicar: textos sin «sin TACC / sin gluten / apto celíacos» (mismo filtro del
  resto de Content OS).
- Pantalla en Content OS: lista de vitrinas por marca, «Armar vitrina», «Aprobar», ranking de
  compartidos.
- Endpoint público mínimo para los eventos (`/api/vitrina/evento`, en `PUBLIC_PREFIXES`, con límite
  de frecuencia).
- Infra: registro A `vitrina` → 179.197.225.55 (Hostinger, con respaldo de zona y
  `overwrite` cuidado), `certbot`, server block de nginx con `root /srv/vitrinas`, volumen en
  el compose del worker.

### V2 · Turnos (Opus del lado de Turnos)
- **Enlaces:** una entrada en `portal_links` por marca con el link fijo
  (`vitrina.kitchcocenter.com/<marca>/`). Es configuración, sin código.
- **Historia del sistema:** cuando Javier aprueba una vitrina, se publica en Turnos una historia
  con una portada generada («Anuncios nuevos de FasutoFudo · tocá para verlos») y el link,
  solo para quien tenga la marca en `kitchens.brand_slugs` de su cocina.
  ⚠️ El contrato de hoy es **pull** (Turnos nunca llama a Content OS). Esto pide un endpoint
  nuevo en Turnos, con el mismo esquema de secreto compartido, o que Turnos lo tome por pull.
  Hay que verificar si las historias de la PWA ya soportan un link tocable.

### V3 · Automático y aprendizaje
- Disparo desde F10 E4.
- El ranking de compartidos («la favorita del equipo») entra como señal al motor de gustos (F7) y
  al ranking de ganadores de F10 (E2).

## Decisiones que faltan (Javier)

1. **Dónde:** `vitrina.kitchcocenter.com` (recomendado), dentro de `informes`, o un link por dominio
   de marca.
2. **Cuántas guardar por marca** antes de reciclar (propuesta: 6) y si los links viejos
   redirigen a la vigente (recomendado) o dan «esta vitrina ya no está».
3. **Aprobación:** ¿la historia de Turnos sale sola o después de aprobar? (Recomendado: aprobar.)
4. **Qué repostea el equipo:** el video del anuncio (menú de compartir, anda siempre) o también el
   Reel orgánico de la marca (pide publicarlo como orgánico; da el repost con etiqueta).
5. **Medición:** contar compartidos en forma anónima, o por empleado (el link de Turnos llevaría un
   token de la persona).

## Reglas que no se negocian
- La vitrina nunca toca Meta: solo lee anuncios. No prende, no pausa, no cambia presupuestos.
- Precio solo en el texto, nunca en el video. Nada de «sin TACC / sin gluten / apto celíacos».
- Producto real: si una pieza viene de IA, la vitrina no la muestra sin marcarla.
- `noindex` y slugs impredecibles. Sin datos de clientes ni números de gasto en la página.

## Estado (01-10-2026): V0–V3 construidas

Decisiones tomadas (recomendaciones aceptadas por Javier al pedir construirlo): `vitrina.kitchcocenter.com`,
6 por marca con redirección a la vigente, la historia de Turnos sale **al aprobar**, se comparte el
video (+ «Ver en Instagram» si el anuncio tiene publicación), compartidos **por persona** desde Turnos.

Cambio de diseño respecto del plan: **no hay estáticos en el host**. Las vitrinas las sirve la misma
app (`src/app/vitrina/[marca]/[[...slug]]`): nginx manda `vitrina.` al contenedor de social-hub y el
proxy (`rutaVitrina` en `src/lib/supabase/middleware.ts`) solo deja ver `/<marca>/…` (el panel da 404
en ese dominio). Rotación = estado en la base; videos desde `cos-media` con links firmados al momento.

| Pieza | Dónde |
|---|---|
| Tablas | `0024_cos_vitrinas.sql` (`cos_vitrinas`, `cos_vitrina_items`, `cos_vitrina_events`, `cos_brands.vitrinas_max`) |
| Lógica pura | `shared/cos/vitrina.ts` (+ tests) |
| Worker | `worker/src/vitrina.ts`: `vitrina:build` (campaña o tanda del motor, 540p para mirar + 720p para compartir + portada, rotación) y `vitrina:turnos` |
| Página pública + compartir | `src/app/vitrina/…/vitrina-vista.tsx` (navigator.share con el archivo precargado, texto con @ al portapapeles, descargar, ver en IG) |
| Eventos | `POST /api/vitrina/evento` (límite por IP) |
| Pantalla | Anuncios → pestaña «Vitrinas» (armar desde campaña, editar textos, aprobar, rearmar, favorita del equipo, compartidos por persona) |
| V3 | `ads:create`: cuando la tanda entera queda en Meta, crea la vitrina de esa semana |
| Infra | registro A `vitrina` → 179.197.225.55, `/etc/nginx/sites-enabled/vitrina.conf`, certbot |

**V2 · Turnos sin tocar el código de Turnos:** Turnos no tenía ninguna API para recibir avisos
(`TURNOS_API_URL` nunca se configuró) y su repo tenía cambios de otra sesión en los archivos de
historias. La historia se publica escribiendo en la base de Turnos (env `TURNOS_SUPABASE_URL` /
`TURNOS_SUPABASE_SERVICE_KEY`) igual que `publicarComunicado`: foto en el bucket `stories` + fila con
`system_sender='kitchco'` y sticker de link. Una historia por persona de las cocinas de la marca
(`kitchens.brand_slugs`), con un token propio en el link (`?e=`) → compartidos por persona. Además
deja «Anuncios <marca> (para compartir)» en Enlaces (`portal_links`) de cada cocina.
Si algún día Turnos cambia el esquema de `stories`, esto hay que ajustarlo (o pasarlo a una API de Turnos).
