# PLAN — Content OS dentro de Social Hub

> Pedido de Javier, 26-09-2026: construir el "Content OS" del paquete
> `docs/content-os-spec-v2/` (copia fiel del original), **adaptado a la infraestructura que ya
> tenemos**. Este documento es el plan que se ejecuta; el paquete original queda como
> referencia de intención. Donde los dos difieren, **manda este plan** (ver §2).
>
> **Versión 2 (26-09-2026, misma tarde):** se suman comentarios, la mecánica
> «Comentá y te escribo» (respuestas privadas a quien comenta) y los mensajes directos (§10).
> Marca de prueba: **FasutoFudo**. Maqueta visual: https://claude.ai/artifact/HwXuKvr4sYAPSp7ZSP1Ytk
>
> **Versión 3 (26-09-2026, noche — check final con Fable):** correcciones de §3, §6, §9.4 y
> Fase 0/2A. Decisión de Javier: la 2A **se construye completa pero queda apagada**; el
> trámite con Meta (verificación + App Review) se dispara cuando él dé la señal, y prenderla
> es solo un switch.
>
> **Para quien revise este plan:** las decisiones que más conviene discutir están en §18.

## 1. Qué es, en una frase

Los empleados mandan fotos y videos **con descripción obligatoria** desde la PWA de Turnos →
el material se archiva en **Google Drive** → la IA lo clasifica y escribe copies **en el tono de
cada marca** → Javier (o quien apruebe) lo revisa → se programa → se publica solo en
**Instagram y Facebook** (TikTok más adelante) → **los comentarios se contestan desde el
mismo lugar, y los que traen una palabra clave reciben un mensaje privado que lleva la
conversación a WhatsApp, donde se vende** → queda todo auditado y medido hasta el pedido.

## 2. Qué cambia respecto del paquete original (y por qué)

| Paquete v2 | Este plan | Por qué |
|---|---|---|
| App **de escritorio** local-first | **Web** dentro de Social Hub (`social.kitchcocenter.com`) | Ya tenemos servidores 24/7. Una app de escritorio depende de que la compu esté prendida para publicar. |
| **SQLite** local | **Supabase OlivosSpeed**, tablas con prefijo `cos_` | Social Hub ya usa esa base; la compartimos sin chocar con nadie gracias al prefijo. Backups incluidos. |
| Scheduler local + aviso de migración al día 90 | **Worker en el servidor desde el día 1** | La "migración a cloud" es el punto de partida. El aviso del día 90 **se elimina**. |
| Caché local descartable | Bucket de **staging** en Supabase Storage (`cos-staging`) con vencimiento | Instagram necesita las **fotos** en una URL pública (una URL firmada de 1 h sirve). Los **videos** se suben en partes desde el worker (`rupload.facebook.com`), sin URL pública. |
| Instagram + Facebook + TikTok en el MVP | IG + FB en Fase 1, **TikTok en Fase 3** | TikTok publica todo como **privado (SELF_ONLY)** hasta aprobar su auditoría, que lleva semanas. Se tramita en paralelo. |
| Drive con cuenta de servicio en "Mi unidad" | Drive en una **unidad compartida** | Las cuentas de servicio **no tienen espacio propio** en Drive: sin unidad compartida, la subida falla. |
| Una sola "marca" implícita | **Multi-marca real**: `cos_brands` + `cos_social_accounts` | Son 3 marcas activas (Sensaciones, Bijutsukan, FasutoFudo), cada una con su página, su Instagram y su tono. Sumar una es insertar una fila, no tocar código. |
| Edición de video en el MVP | Edición (ffmpeg) en **Fase 2B** | La Fase 1 publica el original bien validado. Editar es lo más caro y lo que menos traba el flujo. |
| No contemplaba comentarios ni mensajes | **Comentarios y palabras clave** (Fase 2A) y **mensajes directos** en la bandeja de wa-dashboard (Fase 3) | Publicar sin atender lo que vuelve desperdicia el alcance. Los comentarios con palabra clave son la mejor forma de convertir alcance en pedidos. |

**Se mantienen todos los no negociables del paquete:** Drive como archivo maestro de los
medios · nada se publica sin aprobación (`SAFE_MODE`) · descripción obligatoria · nunca se
pisa una versión · nunca un post duplicado · cada red en su propio adaptador · secretos
fuera del repo · todo auditado. **Se agrega uno:** nada se contesta en público de forma
automática si no fue aprobado antes (ver §10.4).

## 3. Arquitectura

```text
 PWA Turnos (celular del empleado)
   │  1. sube directo con URL firmada (patrón de Historias, 0139)
   ▼
 Supabase TURNOS  ── bucket privado content-inbox + tabla content_submissions
   │  2. el worker de Content OS consulta "pendientes" (API con secreto compartido)
   ▼
 content-os-worker  (Node 24 + TS, contenedor aparte, kitchco-soluciones)
   ├─ 3. copia el original a Google Drive (unidad compartida "Content OS")
   ├─ 4. crea cos_assets en Supabase OLIVOSSPEED y confirma el ingreso a Turnos
   ├─ 5. ffprobe + fotogramas → Claude (visión) clasifica → sugiere copies por marca
   ├─ 6. cola cos_jobs: publica, reintenta, reconcilia, contesta comentarios
   └─ 7. Meta Graph API (IG / FB) — más adelante TikTok
   ▲
 Social Hub web (Next 16)
   ├─ biblioteca · aprobaciones · calendario · comentarios · palabras clave · cuentas
   ├─ /api/webhooks/meta   ← Meta avisa comentarios y mensajes (Fase 2A)
   │     valida la firma, guarda el evento y encola; nunca procesa en línea
   │     reenvía los MENSAJES a wa-dashboard (Fase 3)
   └─ /r/<código>          ← link corto: registra el clic y redirige a WhatsApp (Fase 2A)
```

- **Social Hub (Next)** es la interfaz, las acciones de usuario y los dos puntos de entrada
  públicos (webhook y link corto). **No publica nada**: deja trabajos en la cola.
  ⚠️ `/api/webhooks/meta` y `/r/*` van **excluidos del auth** en `src/proxy.ts` (hoy manda
  todo a `/login`: Meta recibiría un redirect y daría de baja el webhook). El webhook además
  contesta el reto de verificación de Meta (`hub.challenge`, con `META_WEBHOOK_VERIFY_TOKEN`
  en env).
- **El worker** es el único que habla con Drive, Meta y la IA en segundo plano. Se toma como
  patrón `meta-ads-scheduler` (Node, Dockerfile alpine, reenvío a Argos incluido), pero
  **la cola vive en Postgres**, no en `node-cron` en memoria, para que sobreviva a reinicios.
- **Dos bases de Supabase y una frontera clara:** Turnos solo sabe "recibí esto de este
  empleado". Content OS es dueño de todo lo que pasa después. No hay claves cruzadas entre
  bases: el vínculo es `source_external_id = content_submissions.id`.

## 4. Modelo de datos (Supabase OlivosSpeed, prefijo `cos_`)

Todas las tablas llevan RLS: la lectura requiere ser `cos_members`; la escritura desde el
navegador solo va por acciones del servidor.

```text
cos_members        user_id PK → auth.users · role: admin | approver | editor | viewer
                   (lista de permitidos: hoy entra CUALQUIER usuario de OlivosSpeed — se cierra)

cos_brands         id · slug (sensaciones|bijutsukan|fasutofudo) · name · color
                   · turnos_slugs text[] (mapa a los slugs de Turnos) · tone_md (sale del KB)
                   · rules_json (palabras prohibidas, CTA por defecto, hashtags base)
                   · whatsapp_number (para los links de §10) · active

cos_social_accounts id · brand_id · platform (instagram|facebook|tiktok) · external_id
                   (Page ID / IG business ID) · display_name · token_ref (NOMBRE de la
                   variable de entorno, jamás el token) · status · last_checked_at
                   · webhooks_subscribed_at

cos_assets         id · brand_id · source (turnos|manual|drive) · source_external_id UNIQUE
                   · description NOT NULL (mín. 15 caracteres) · submitted_by_label
                   · kitchen_label · drive_file_id · drive_md5 · mime · media_type
                   (photo|video) · width · height · duration_ms · size_bytes · captured_at
                   · status · ai_json · quality_score · people_present
                   · consent (unknown|ok|blocked) · current_version_id · created_at

cos_asset_versions id · asset_id · version_number (UNIQUE con asset_id) · parent_version_id
                   · kind (original|ffmpeg|canva|manual) · aspect (orig|9:16|4:5|1:1)
                   · drive_file_id · params_json · created_by · created_at
                   → SOLO INSERT. Nunca UPDATE del archivo: una versión nueva = una fila nueva.

cos_posts          id · brand_id · account_id · platform · post_type (feed|carousel|reel|story)
                   · caption · hashtags · scheduled_at · timezone ('America/Argentina/Buenos_Aires')
                   · status · approved_by · approved_at · approved_hash
                   · idempotency_key UNIQUE · attempts · next_attempt_at
                   · remote_container_id · remote_post_id · permalink · last_error
cos_post_media     post_id · version_id · position   (carruseles = varias filas)

cos_campaigns      (Fase 2B) id · brand_id · name · start_at · end_at · goal · tone · cta
                   · platforms · content_mix_json · rules_json · active

── Comentarios y palabras clave (Fase 2A, ver §10) ──────────────────────────────────────
cos_webhook_events id · object (page|instagram) · field · payload · signature_ok
                   · received_at · processed_at · dedupe_key UNIQUE
                   → se guarda TODO lo que llega, antes de procesar (Meta reintenta y repite)

cos_comments       id · account_id · platform · remote_comment_id UNIQUE · remote_post_id
                   · post_id (nullable: también llegan comentarios de posts viejos o de anuncios)
                   · parent_remote_id · author_remote_id · author_username · text
                   · commented_at · intent (pregunta|pedido|elogio|queja|spam|otro)
                   · status (new|replied|auto_replied|hidden|ignored|escalated)
                   · trigger_id · public_reply_remote_id · private_reply_sent_at
                   · private_reply_error · handled_by · handled_at

cos_triggers       id · brand_id · account_ids · post_id (nullable = vale para toda la cuenta)
                   · name · keywords text[] (normalizadas: minúsculas, sin tildes)
                   · public_replies text[] (varias variantes, se rotan)
                   · private_reply_text (UN mensaje, solo texto)
                   · link_id → cos_links · starts_at · ends_at · status (draft|pending|active|paused|ended)
                   · approved_by · approved_at · approved_hash
                   · per_author_limit (1 cada 7 días por defecto)

cos_links          id · code UNIQUE (ej. FF-ONI-0929) · brand_id · trigger_id · post_id
                   · target (whatsapp|web|menu) · target_url · prefill_text
cos_link_clicks    id · link_id · clicked_at · ua_hash · ref   (sin IP ni datos personales)

── Infra ────────────────────────────────────────────────────────────────────────────────
cos_jobs           id · type · payload · run_at · attempts · max_attempts · status
                   · locked_by · locked_at · dedupe_key UNIQUE · last_error
                   → se reclama con la función cos_claim_jobs() usando FOR UPDATE SKIP LOCKED

cos_settings       safe_mode (true) · global_pause (false) · triggers_pause (false)
                   · missed_post_policy · late_tolerance_min (30) · drive_root_id · ai_model

cos_audit_log      id · event · entity_type · entity_id · actor · details_json · created_at
cos_ai_usage       id · purpose · model · input_tokens · output_tokens · cost_usd · asset_id
cos_post_metrics   (Fase 3) post_id · captured_at · reach · likes · comments · saves · shares · views
```

**`approved_hash`** es la pieza de seguridad más importante: guarda un hash de
(caption + hashtags + versiones + cuenta + fecha **+ palabra clave vinculada, si hay**) en el
momento de aprobar. Si algo de eso cambia después, el post **vuelve solo a
`PENDING_APPROVAL`**. Así nunca se publica algo distinto de lo que se aprobó. Las palabras
clave tienen su propio `approved_hash` con el mismo criterio.

## 5. Estados

**Asset:** `NEW → VALIDATING → READY → (IN_USE) → ARCHIVED`
· errores: `MISSING_DESCRIPTION` · `REJECTED` (lo descarta quien revisa) · `FAILED_SYNC`
· `FAILED_PROCESSING`. Sin descripción: no hay IA, no hay planificación, no hay publicación.

**Post:** `DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED`
· `PENDING_APPROVAL → REJECTED`
· `APPROVED|SCHEDULED → CANCELLED`
· `SCHEDULED → PAUSED` (pausa global o individual)
· `PUBLISHING → FAILED → RETRY_SCHEDULED → PUBLISHING` (hasta 5 intentos, espera exponencial)
· `SCHEDULED` sin aprobar al llegar la hora → `EXPIRED` (**no se publica**)
· worker caído y se pasó la hora → **`MISSED_POST_POLICY`**: si el atraso es ≤ 30 min se
  publica igual; si es mayor, pasa a `MISSED` y hay que reprogramarlo a mano.
  (El paquete la nombraba pero nunca la definía.)

**Palabra clave:** `DRAFT → PENDING_APPROVAL → ACTIVE → (PAUSED) → ENDED`. Si está vinculada a
un post, se activa cuando ese post se publica y termina a los 7 días (el plazo máximo de Meta
para las respuestas privadas).

**Comentario:** `NEW → (AUTO_REPLIED | REPLIED | HIDDEN | IGNORED | ESCALATED)`.

**Etiquetas en pantalla** (en castellano): Nuevo · Falta descripción · Listo · Borrador ·
Esperando aprobación · Aprobado · Programado · Publicando · Publicado · Falló · Rechazado ·
Vencido · Perdido · Pausado · Activa · Terminada · Respondido · Respondido solo · Oculto ·
Para vos.

## 6. Cómo se evita publicar (o responder) dos veces

Meta **no acepta** claves de idempotencia, así que la garantía se arma en tres capas:

1. **Clave única** `idempotency_key = post.id` + `cos_jobs.dedupe_key = publish:<post.id>`: no
   puede haber dos trabajos de publicación vivos para el mismo post.
2. **Paso a paso con registro:** crear contenedor → guardar `remote_container_id` → esperar
   `FINISHED` → `media_publish` → guardar `remote_post_id` **de inmediato**. Si el worker se
   cae, retoma desde el último dato guardado; no vuelve a empezar.
3. **Reconciliación:** si murió entre `media_publish` y guardar el id, antes de reintentar
   consulta `/{ig-user-id}/media` en la ventana de ±15 min y compara **caption exacto +
   hora de publicación**. Si lo encuentra, lo adopta como publicado. (Nada de "marcas
   invisibles" en el caption: Meta puede normalizar el texto y la marca se pierde.)

**Para los comentarios vale lo mismo:** `cos_webhook_events.dedupe_key` (Meta manda el mismo
evento más de una vez) + `cos_comments.remote_comment_id UNIQUE` + `dedupe_key =
private_reply:<remote_comment_id>`. Meta permite **una sola** respuesta privada por
comentario: si un reintento choca con el error de "ya respondido", se toma como éxito.

Se testea con los tres casos de la skill de idempotencia: correrlo dos veces, cortarlo en
cada paso y verificar que siempre converge al mismo resultado.

## 7. Ingreso desde Turnos (módulo «Enviar contenido»)

**Del lado de Turnos** (repo propio, migración `0140_content_submissions.sql` — verificar el
número al escribirla):

- Tabla `content_submissions`: `id, company_id, kitchen_id, brand_slug, created_by,
  storage_path, mime, size_bytes, duration_ms, description (CHECK length ≥ 15), priority,
  status (uploading|submitted|ingested|rejected), ingested_at, external_ref, created_at`.
- Bucket privado **`content-inbox`**, reusando `createSignedUploadUrl` de
  `admin/src/lib/stories.ts`: el celular sube directo, sin base64 por la API.
- Permiso **por persona**, igual que en Historias: `users.can_send_content`.
- En la PWA: botón «📸 Enviar contenido» → cámara o galería → **descripción obligatoria**
  (con ayuda: *"¿qué es?, ¿de qué marca?, ¿algo especial hoy?"*) → marca (si la cocina tiene
  una sola, se completa sola) → enviar.
- API para Content OS, protegida con `x-content-os-secret`, siguiendo el patrón de
  `x-cron-secret`:
  - `GET  /api/v1/integrations/content/pending`: hasta 20 envíos, con URL firmada de lectura de 1 h.
  - `POST /api/v1/integrations/content/:id/ack` `{ external_ref }`: marca `ingested`.
  - Pasados 14 días de `ingested`, un job de Turnos borra el archivo del bucket (el original
    ya vive en Drive).

**Del lado de Content OS:** un job `ingest:turnos` corre cada 2 minutos y hace pending →
bajar → subir a Drive → crear el asset → `ack`. Si falla a mitad de camino, el
`source_external_id UNIQUE` evita el duplicado en el próximo ciclo.

**Carga manual:** desde Social Hub (Javier o un editor) va al mismo circuito, con
`source = manual`.

## 8. Google Drive

- **Unidad compartida** "Content OS", con la cuenta de servicio
  `kitchco-bridge@prospectos-489903` como *Administrador de contenido*. Todas las llamadas
  llevan `supportsAllDrives=true`. agente-google hoy no lo usa: acá se escribe desde cero.
- Estructura de carpetas: la del paquete, con la marca como segundo nivel:
  ```text
  Content OS/
  ├── 10_ORIGINALS/<marca>/<AAAA-MM>/
  ├── 20_GENERATED/<marca>/<AAAA-MM>/
  ├── 50_PUBLISHED_EXPORTS/<marca>/<AAAA-MM>/
  ├── 90_ARCHIVE/
  └── _backups/            (dump diario de las tablas cos_, ver §13)
  ```
  Las carpetas **no son estados**: los estados viven en la base. Un archivo nunca se mueve por
  cambiar de estado.
- Subida **resumible** (los videos pueden pesar cientos de MB). Se guarda el `md5Checksum`
  que devuelve Drive para detectar duplicados.
- **Nunca se borra nada de Drive automáticamente.**

## 9. Meta: acceso, permisos y publicación

### 9.1 Token y permisos (se pide TODO de una vez)

El `long_lived_token` de `.credentials/meta-ads.json` **venció el 13-05-2026** y además es de
usuario, así que se descarta. Hace falta un **token de System User** del Business Manager, que
no vence. Para no tramitar dos veces, se pide ya con los permisos de todas las fases:

| Para qué | Permisos | Fase |
|---|---|---|
| Ver y publicar | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management` | 1 |
| Recibir avisos (webhooks) de las páginas | `pages_manage_metadata` | 2A |
| Leer y contestar comentarios | `pages_read_user_content`, `pages_manage_engagement` (FB) · `instagram_manage_comments` (IG) | 2A |
| Respuestas privadas y mensajes directos | `pages_messaging` (FB) · `instagram_manage_messages` (IG) | 2A / 3 |
| Métricas | `read_insights`, `instagram_manage_insights` | 3 |

Se usa **Facebook Login for Business** (cuentas de Instagram vinculadas a sus páginas), no
"Instagram Login": por eso los permisos son `instagram_manage_*` y no
`instagram_business_manage_*`. De ese token se sacan los **page tokens** de las 3 páginas.
Todo va como variable de entorno del worker; en la base solo se guarda el **nombre** de la
variable (`token_ref`).

### 9.2 ⚠️ Acceso avanzado: el camino crítico de §10

- Con **acceso estándar**, la app solo puede leer y responder conversaciones con **personas que
  tienen rol en la app**. Alcanza para probar con nuestras propias cuentas, **no alcanza para
  clientes reales**.
- Para comentarios y mensajes del público hace falta **acceso avanzado**, que exige
  **App Review** (Meta revisa un video del flujo funcionando) y **verificación del negocio**.
  La ficha de FasutoFudo dice que su portfolio (business id `1318238572977700`) está **sin
  verificar**.
- **Publicar** en nuestras propias páginas no depende de esto: la Fase 1 no se traba.
- **Orden (decidido por Javier el 26-09-2026):** la 2A se construye **completa** y se prueba
  con cuentas que tienen rol en la app. Queda apagada detrás de `triggers_pause`. Cuando
  Javier dé la señal: verificación del negocio → grabar el video → App Review → prender el
  switch. Nada de eso requiere tocar código.
- **Portfolios:** si cada marca está en un portfolio distinto, la app y el System User viven
  en uno (el que se verifique) y las otras páginas se comparten a ese negocio como activos de
  socio. Se define en Fase 0 mirando el Business Manager.

### 9.3 Cuentas iniciales (sacadas de `.credentials/meta-ads.json`)

| Marca | Page ID | IG business ID |
|---|---|---|
| Sensaciones de Oriente | 333425610087983 | 17841404968403096 |
| Bijutsukan | 103552051939142 | 17841446127051208 |
| **FasutoFudo (prueba)** | 862367476948970 | 17841477485052896 |

### 9.4 Publicación

- **Instagram:**
  - Foto → `image_url` = URL firmada de `cos-staging` (1 h). **Cada intento genera su
    propia URL**: un reintento tardío nunca reusa una firma que pudo vencer. Un job diario
    limpia `cos-staging` (lo publicado ya vive en Drive).
  - Carrusel → contenedores hijos + padre.
  - Reel → `upload_type=resumable` + binario a `rupload.facebook.com`.
  - En todos los casos: esperar `status_code=FINISHED` y recién ahí `media_publish`.
- **Facebook:**
  - Foto → `/{page-id}/photos`.
  - Video/Reel → `/{page-id}/videos` o `video_reels` (subida en partes).
- **Límites** (cantidad de posts por día, duración de videos, proporciones permitidas):
  **nada fijo en el código**. Van en `config/platforms.json`, que se valida antes de publicar.
- **Versión de la Graph API:** también va en configuración. `meta-ads-scheduler` usa v21.0;
  al arrancar se verifica la vigente.

## 10. Comentarios, «Comentá y te escribo» y mensajes

### 10.1 Las reglas de Meta que mandan

| Regla | Qué implica |
|---|---|
| **Respuesta privada**: se le puede mandar **un** mensaje privado a quien comentó un post (o un anuncio), hasta **7 días** después del comentario | Es la puerta de entrada: el comentario habilita el primer mensaje. Uno solo por comentario |
| En Facebook la respuesta privada es **solo texto** (sin fotos) y Meta le agrega el link al comentario | El mensaje tiene que funcionar con texto y un link |
| **Ventana de 24 h**: si la persona contesta el mensaje, se abre una ventana de 24 h para seguir hablando libremente; se reinicia cada vez que escribe | Después de eso solo responde una persona real (etiqueta `human_agent`, hasta 7 días, se tramita aparte) |
| **No se puede escribir primero** a alguien que nunca escribió ni comentó | No hay envíos masivos por Instagram ni Messenger. Para eso está WhatsApp |
| Nada de spam: respuestas públicas idénticas en masa o contenido engañoso pueden hacer que Meta limite la cuenta | Variantes rotativas, límites por persona y botón de pausa (§10.4) |

### 10.2 Por qué el mensaje privado lleva a WhatsApp

Según `knowledge-base/negocio/marcas/fasutofudo.md`, **el 88% de los pedidos entra por
`fasutofudo.entretiendas.app`** y la atribución solo funciona cuando vive en la conversación,
no en la web. WhatsApp es donde está **Kenji** (el agente de FasutoFudo), el menú y el pedido.
Entonces la respuesta privada **no intenta vender por Instagram**: lleva a la persona a
WhatsApp con un código que dice de qué post viene.

```text
 Post de FasutoFudo: «... Comentá ONIGIRI y te mandamos el menú por privado 📩»
   │
   ▼  alguien comenta "onigiri!!"
 Webhook → cos_webhook_events → cos_comments (normaliza: minúsculas, sin tildes)
   │  coincide con la palabra clave activa de ese post
   ▼
 1. Respuesta PÚBLICA (variante rotativa, aprobada de antemano):
      «¡Te escribimos por privado! 📩»
 2. Respuesta PRIVADA (un solo mensaje):
      «¡Hola! 🍙 Acá tenés el menú y pedís directo por WhatsApp:
       https://social.kitchcocenter.com/r/FF-ONI-0929»
   │
   ▼  clic → cos_link_clicks → redirige a
 wa.me/5491126222202?text=Hola! Vengo de Instagram, quiero ver el menú (FF-ONI-0929)
   │
   ▼
 wa-dashboard + Kenji atienden · el código FF-ONI-0929 queda en la conversación
   │
   ▼  (Fase 3) el pedido que entra al COMANDERO se atribuye al post → $ por post
```

El número de WhatsApp sale de `cos_brands.whatsapp_number`, no del código. El de FasutoFudo
es `+54 9 11 2622-2202` (confirmado el 30/07/2026 en la ficha).

### 10.3 Mecánicas para jugar (todas con la misma pieza)

| Mecánica | Cómo funciona | Cuidado |
|---|---|---|
| **Menú por privado** | «Comentá ONIGIRI y te mando el menú» → link a WhatsApp con código | La base: arranca con esta |
| **Palabra por producto** | Un post por producto, cada uno con su palabra (CRISPY, CAJA…) | Cada código mide qué producto genera más conversaciones |
| **Lanzamiento** | «Comentá QUIERO y sos de los primeros en probarlo» → invita a sumarse a una lista de WhatsApp | Por Instagram no se puede escribirle "cuando salga", pero por WhatsApp sí, si acepta |
| **Promo real** | «Comentá FASUTO y te paso el código» | **Solo con una promo que exista y esté cargada.** La IA nunca inventa promos (§11); el texto lo aprueba Javier |
| **Comentarios en anuncios** | La misma palabra clave funciona en los anuncios de Meta Ads, cuando se vuelva a pautar | Los anuncios tienen muchos más comentarios: arrancar con límites bajos |
| **Sorteo** | «Comentá y etiquetá a un amigo»: a cada participante le llega un privado con las bases | Revisar las reglas de promociones de Instagram antes de lanzarlo |

### 10.4 Barandas (lo que evita un papelón)

- **Nada público se contesta solo si no fue aprobado antes.** Las respuestas automáticas
  salen **únicamente** de palabras clave aprobadas (texto público y privado incluidos en su
  `approved_hash`). Cualquier otro comentario recibe una respuesta **sugerida** por la IA
  que una persona aprueba con un toque.
- **Quejas nunca en automático.** Antes de responder, la IA clasifica la intención. Si es
  `queja`, no hay respuesta automática aunque tenga la palabra clave: pasa a `ESCALATED`
  («Para vos») y avisa.
- **Límites:** una respuesta privada por persona y por palabra clave cada 7 días · no se
  responde a comentarios de la propia cuenta ni a respuestas dentro de un hilo · tope
  configurable de respuestas automáticas por hora por cuenta.
- **Variantes:** mínimo 3 respuestas públicas por palabra clave, rotadas, para no parecer un
  robot ni caer en el filtro de spam de Meta.
- **Pausa propia:** `triggers_pause` en Inicio frena todas las respuestas automáticas sin
  frenar las publicaciones.
- **Privacidad:** de quien comenta se guarda solo lo necesario (id, usuario, texto). Los
  clics del link corto no guardan IP.

### 10.5 Mensajes directos (Fase 3): a la bandeja de wa-dashboard

- Los mensajes privados de Instagram y Messenger van a **la misma bandeja donde ya se atiende
  WhatsApp**, con Kenji y los demás agentes. Una conversación de venta no debería estar
  partida en dos lugares.
- **Una sola URL de webhook por app:** Meta manda comentarios y mensajes de páginas e Instagram
  al mismo callback. Por eso Social Hub recibe todo, se queda con los comentarios y **reenvía
  los mensajes** a wa-dashboard con un secreto compartido. WhatsApp sigue llegando directo a
  wa-dashboard, porque es otro tipo de objeto en Meta.
- **Antes de la Fase 3:** si alguien contesta el mensaje privado dentro de Instagram en vez de
  ir a WhatsApp, Social Hub muestra «N mensajes sin leer en Instagram» con un link a la bandeja
  de Meta Business Suite. Nada queda sin ver.
- **A revisar al llegar a la Fase 3:** si wa-dashboard ya tiene algo de Instagram o Messenger.
  El relevamiento no pudo confirmarlo: los archivos estaban en iCloud y la búsqueda se colgó.

## 11. IA (Claude)

- `@anthropic-ai/sdk` **en su versión actual**, no la 0.39 de Hermes/agente-google.
- Modelo **`claude-sonnet-5`** para clasificar y escribir copies, configurable en
  `cos_settings.ai_model`. Para clasificar comentarios, que es una tarea chica y de volumen,
  se evalúa **`claude-haiku-4-5`**.
- **Clasificador de fotos y videos:** recibe la descripción, la metadata y la foto (o 3-4
  fotogramas del video sacados con ffmpeg) y devuelve el JSON del paquete (`AI_PROMPTS.md`
  §1) con **salida estructurada**. Reglas: no inventar nada, separar lo que dice el empleado de
  lo que se ve, marcar `risk_flags` (caras de clientes, menores, marcas ajenas, higiene,
  **imagen generada o de banco**).
- **Copies:** por plataforma, en el tono de la marca. El contexto sale de
  `knowledge-base/negocio/marcas/<marca>.md` + `.agents/product-marketing-context.md`, copiado
  a `cos_brands.tone_md` con un script `sync-brands`, y va con **prompt caching**. Reglas duras:
  no inventar precios ni promociones, y no usar las palabras prohibidas del grupo
  ("restaurante", "gourmet", "dark kitchen", "oferta/liquidación"…). El Composer puede
  sumar al caption el llamado de la palabra clave («Comentá ONIGIRI…»).
- **Comentarios:** clasifica la intención (§10.4) y sugiere respuestas en el tono de la marca,
  con las mismas reglas duras. Si preguntan precio, la respuesta sugerida manda al menú o a
  WhatsApp: **nunca inventa un número**.
- **Costo:** cada llamada se registra en `cos_ai_usage`. En la Fase 1 se mide el costo real
  por asset antes de automatizar volumen.

## 12. Interfaz en Social Hub

Se reemplazan las maquetas actuales por pantallas reales. La navegación sigue
`UI_UX_SPEC.md`, recortada. La base visual es la maqueta aprobada (link arriba): base neutra
con **el color de la marca activa como acento**, Bricolage Grotesque + Figtree, modo claro y
oscuro.

| Pantalla | Fase | Qué hace |
|---|---|---|
| **Inicio** | 1 | Tarjetas: nuevos de empleados · esperando aprobación · programados esta semana · salud (Drive, Meta, worker, último backup) · interruptores de modo seguro y pausa global |
| **Biblioteca** (`/media`) | 1 | Tarjetas con miniatura, descripción, empleado, cocina, marca, estado, calidad y etiquetas de la IA. Filtros por marca y estado. Acciones: *Crear post* · *Rechazar* |
| **Composer** (`/composer`) | 1 | Elegir assets → cuenta(s) → la IA propone copy → editar → fecha → *Enviar a aprobación*. En 2A: *Agregar palabra clave* |
| **Aprobaciones** | 1 | Vista previa real (el archivo que se va a publicar), caption, hashtags, fecha, cuenta, versión y advertencias. Botones: **Aprobar · Editar · Regenerar copy · Rechazar · Reprogramar** |
| **Programados / Publicados** | 1 | Lista con estado, link al post y error legible si falló. En 2A: comentarios de cada post |
| **Cuentas** (`/accounts`) | 1 | Las 6 cuentas (3 IG + 3 FB), con un "probar conexión" que valida el token y los permisos |
| **Comentarios** | 2A | Bandeja de todos los comentarios, con filtros **Para vos** (quejas y preguntas sin respuesta) · Respondidos solos · Todos. Respuesta sugerida por la IA, ocultar, ver el post |
| **Palabras clave** | 2A | Crear o editar una palabra clave: palabras, variantes públicas, mensaje privado, destino del link, vigencia. Embudo por palabra: comentarios → privados enviados → clics → (Fase 3) pedidos |
| **Calendario** (`/calendar`) | 2B | Semana y mes con arrastrar y soltar (librería según la skill `pick-ui-library`) |
| **Campañas** | 2B | Planificador con IA |
| **Métricas** (`/analytics`) | 3 | Alcance e interacción por post y por marca, pedidos atribuidos por código, ranking de empleados que aportan |

Mobile-friendly para aprobar y contestar desde el celular.

## 13. Backups

- **Medios:** Drive (archivo maestro).
- **Base:** Supabase ya tiene sus backups, y además un job diario hace un dump de las tablas
  `cos_` a `Content OS/_backups/` en Drive, con la retención del paquete (7 diarios, 4
  semanales y 12 mensuales). Así hay restauración aunque se pierda el proyecto de Supabase.
- **Código:** GitHub privado (el repo de Social Hub).
- **Secretos:** variables de entorno en el servidor, excluidas del rsync como siempre.
- **Simulacro de restauración:** en la Fase 3, se levanta en local desde el dump y se verifica
  que reconstruye todo.

## 14. Fases

### Fase 0 — Cimientos (sin esto no arranca nada)

> **Estado al 26-09-2026 (noche):** hecho en local y verificado (`npm run predeploy` en
> verde: typecheck app + worker, lint, **71 tests**, build). Falta lo que toca producción,
> que se hace con Javier: aplicar las migraciones en OlivosSpeed, darlo de alta como
> miembro, registrar `social-hub` en Argos central y el primer deploy.
>
> - ✅ 1 `deploy.sh` · ✅ 2 `CLAUDE.md` (con la regla de modelos) · ✅ 3 migraciones
>   `0001_cos_base` + `0002_cos_seed_marcas` · ✅ 4 `cos_members`, `requireMember()` y
>   proxy que falla cerrado · ✅ 5 Argos central-only · ✅ 6 vitest + PGlite (playwright
>   entra con la primera pantalla real, Fase 1) · ✅ 7 esqueleto del worker ·
>   ⏳ 8 Meta · ⏳ 9 credenciales
> - **Extra:** Social Hub se mudó a `~/Dev/social-hub/` (iCloud colgaba `node_modules`).
> - **Cambio respecto a lo planeado:** las reglas de aprobación las hace cumplir **la base**
>   (triggers), no solo el código: aprobar sella el hash, editar devuelve a aprobación,
>   nada llega a PUBLISHING sin coincidir con lo aprobado. Los tests lo prueban contra un
>   Postgres real (PGlite) con las mismas migraciones de producción.

1. Agregar `social-hub` a `infra/deploy.sh`: hoy **no figura** y el deploy fallaría.
2. Actualizar el `CLAUDE.md` de Social Hub (dice Next 15 y es 16.2) y leer
   `node_modules/next/dist/docs/` como pide su `AGENTS.md`.
3. Crear `supabase/migrations/` en Social Hub con las tablas `cos_` de la Fase 1, RLS y la
   función `cos_claim_jobs()`.
4. Crear `cos_members` y cerrar el acceso: hoy entra cualquier usuario de OlivosSpeed. Y
   arreglar que `src/proxy.ts` **se saltea el auth si faltan las env vars** (hoy lo hace):
   sin variables debe fallar cerrado, no abierto.
5. Instalar Argos (`node install.mjs "../Social Hub/social-hub"`) en modo solo-central.
6. Tests: **vitest** (lógica: estados, hash de aprobación, idempotencia, coincidencia de
   palabras clave) y **playwright** (flujo). Social Hub hoy no tiene ninguno.
7. Esqueleto de `worker/` (Node 24 + TS, Dockerfile con `ffmpeg`, `cpus: 1.0` en el compose
   porque el servidor comparte recursos con otras 20 apps).
8. **Meta:** crear o elegir la app y revisar portfolios. El trámite de verificación +
   App Review queda **documentado y listo para disparar** cuando Javier decida activar la
   2A (§9.2); no frena nada de las Fases 0 y 1.
9. Checklist de credenciales para Javier (§16).

### Fase 1 — MVP útil: del celular del empleado a Instagram publicado
- Módulo «Enviar contenido» en Turnos (§7).
- Ingreso → Drive → asset (§7 y §8).
- Clasificación y copies con IA (§11).
- Biblioteca, Composer, Aprobaciones, Programados/Publicados, Cuentas, Inicio (§12).
- Cola, publicación en IG y FB (foto, carrusel, reel), reintentos, reconciliación,
  `MISSED_POST_POLICY`, modo seguro y pausa global (§5, §6 y §9).
- Auditoría completa y backup diario.

**Pruebas de aceptación de la Fase 1** (adaptadas de `MVP_ACCEPTANCE_TESTS.md`):
- Un envío sin descripción no se puede mandar; uno con descripción queda `READY`.
- El original queda en Drive y se puede abrir desde la Biblioteca.
- La IA clasifica y propone copies para las 2 plataformas en el tono de la marca correcta.
- Sin aprobar no se publica. Editar un post aprobado lo devuelve a aprobación.
- Un post programado sale **una sola vez**, aunque el worker se reinicie en cualquier paso.
- Un error de Meta se reintenta y, si falla definitivamente, se ve con un mensaje legible.
- Con la pausa global activada no sale nada.
- El dump diario aparece en Drive.
- **Prueba final:** un empleado de prueba manda una foto desde la PWA y queda publicada en
  **FasutoFudo**. Recién después se habilitan Sensaciones y Bijutsukan.

### Fase 2A — Comentarios y «Comentá y te escribo» (antes que la edición de video)
Va antes que la 2B porque convierte alcance en pedidos y es mucho más barata que editar video.
- Webhook `/api/webhooks/meta`: valida `X-Hub-Signature-256`, guarda en `cos_webhook_events`,
  responde 200 enseguida y encola. Suscripción de las páginas (`subscribed_apps`).
- Bandeja de Comentarios con intención clasificada y respuestas sugeridas (§10.4, §11).
- Palabras clave: creación, aprobación, respuesta pública rotativa + respuesta privada,
  límites y pausa (§10).
- Link corto `/r/<código>` con registro de clics → WhatsApp con el código precargado.
- En el Composer: *Agregar palabra clave* al armar el post.
- **Cierre de la 2A:** todo construido, testeado con cuentas con rol y **apagado**
  (`triggers_pause = true`). La activación para el público es: trámite con Meta (§9.2)
  cuando Javier dé la señal + prender el switch. Cero código nuevo ese día.

**Pruebas de aceptación de la Fase 2A:**
- El mismo evento del webhook llegando 3 veces genera **un** comentario y **una** respuesta.
- Un comentario con la palabra clave (con tildes, mayúsculas o emojis) dispara una respuesta
  pública y **una** privada, y el link registra el clic.
- La misma persona comentando 5 veces recibe **un** privado.
- Una queja con la palabra clave **no** se responde sola: aparece en «Para vos».
- Con `triggers_pause` activado no sale ninguna respuesta automática, pero los posts se
  siguen publicando.
- Una palabra clave editada después de aprobada vuelve a pedir aprobación.

### Fase 2B — Edición y planificación
- Pipeline ffmpeg: recortes 9:16 / 4:5 / 1:1, logo de la marca, corte de duración,
  normalización de audio y portada. Cada resultado es una **versión nueva** en Drive; la
  anterior nunca se toca.
- *Regenerar* (feedback → V2, V1 sigue existiendo).
- Subtítulos: hace falta transcripción de audio, que Claude no hace. **Decisión pendiente**
  (ElevenLabs, que ya aparece en el ecosistema, o Whisper).
- Calendario con arrastrar y soltar. Campañas y planificador con IA.
- Aviso de "tenés X posts esperando aprobación" por WhatsApp (vía wa-dashboard), 24 h antes.
- **Decidir dónde corre el ffmpeg pesado:** en `kitchco-soluciones` con límite de CPU o en un
  worker aparte. Turnos, por su lado, prohíbe transcodificar en su servidor.

### Fase 3 — Conversaciones, alcance y aprendizaje
- **Mensajes directos** de Instagram y Messenger en la bandeja de wa-dashboard, con Kenji
  (§10.5). Etiqueta `human_agent` si hace falta responder después de las 24 h.
- **Atribución hasta el pedido:** wa-dashboard lee el código (`FF-ONI-0929`) de la
  conversación y lo pasa al pedido del COMANDERO → pesos vendidos por post y por palabra
  clave. Coordinar con ReachEngine, que es el motor de atribución.
- **TikTok**, una vez aprobada la auditoría (la solicitud se manda al terminar la Fase 1).
- Métricas por post (`get_metrics`) y retroalimentación al planificador.
- En Turnos: aviso al empleado de *"¡tu foto se publicó!"* y ranking de quién aporta. Sin
  esto, la gente deja de mandar.
- Simulacro de restauración de backup.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| Publicar algo no aprobado o distinto de lo aprobado | `SAFE_MODE` + `approved_hash` + `EXPIRED` si no se aprobó |
| Post o respuesta duplicados | Las capas del §6, con tests de corte en cada paso |
| **Meta rechaza el App Review o la verificación del negocio se demora** | Se arranca en la Fase 0. La Fase 1 (publicar) no depende de eso. Mientras tanto, las palabras clave se prueban con cuentas que tienen rol |
| **Meta toma las respuestas automáticas como spam y limita la cuenta** | Variantes rotativas, límites por persona y por hora, pausa propia, arrancar con una sola palabra clave en FasutoFudo |
| Respuesta automática a una queja | Clasificación de intención antes de responder; las quejas nunca van en automático |
| La IA inventa precios o promos en una respuesta | Reglas duras en el prompt + chequeo posterior: si la respuesta tiene `$` o un número de precio, no sale sin revisión |
| Caras de clientes o menores sin consentimiento | `people_present` + `risk_flags` → `consent=blocked` bloquea la publicación hasta revisión humana |
| Token de Meta vencido o revocado | "Probar conexión" diario + alerta en Inicio y en Argos. El System User no vence |
| El servidor compartido se ahoga con ffmpeg | Fase 1 casi sin transcodificar. Límite de CPU y concurrencia 1 para ffmpeg |
| iCloud deja `node_modules` dataless y el build se cuelga | Si pasa, mover Social Hub a `~/Dev/` como kitchco y founders |
| Límite global de tamaño de archivo en Supabase (Turnos) | Verificarlo antes de crear `content-inbox`, igual que en Historias |
| Cambios en las APIs de Meta | Versión y límites en configuración, cada adaptador aislado |

## 16. Lo que necesito de Javier

1. **Token de System User de Meta** con **todos** los permisos de §9.1 (no solo los de
   publicar), sobre las 3 páginas y los 3 Instagram.
2. **Verificación del negocio** en el Business Manager (el portfolio de FasutoFudo figura sin
   verificar) y decidir qué portfolio es el dueño de la app (§9.2).
3. En cada Instagram: activar **"Permitir acceso a los mensajes"** (Configuración →
   Mensajes → Herramientas conectadas).
4. **Google Workspace:** ¿existe? Si existe → crear la unidad compartida "Content OS" y
   sumar a la cuenta de servicio. Si no → alternativa OAuth con tu cuenta (con la app de OAuth
   en producción; en modo "testing" el token vence cada 7 días).
5. **¿Quién aprueba?** ¿Solo vos, o también Facu o algún encargado por marca?
6. ~~StohrBurgers en Turnos~~ → **Resuelto el 26-09-2026:** StohrBurgers está **dada de
   baja** y sale del plan. `brothers` / `webbrothers` en Turnos son de **StBrothers**, otra
   empresa (con Facundo), y no entran en Content OS por ahora.
7. **¿Quiénes pueden mandar contenido?** Arrancamos con 2-3 empleados de prueba o con todos.
8. ~~Marca de prueba~~ → **FasutoFudo** (decidido el 26-09-2026).
9. **Primera palabra clave:** confirmar el texto (propuesta: *«Comentá ONIGIRI y te mandamos
   el menú por privado 📩»*) y si hay alguna promo real para usar en §10.3.

## 17. Skills para construirlo

Instaladas en Social Hub (`.claude/skills/`) el 26-09-2026 y revisadas por dentro:
`supabase` (Storage, colas, Cron, RLS) · `ffmpeg` · `principle-make-operations-idempotent`
· `pick-ui-library`. Del workspace o del proyecto: `next-best-practices`,
`supabase-postgres-best-practices`, `shadcn`, `tailwind-design-system`, `claude-api`,
`prompt-engineering-patterns`, `error-handling-patterns`, `social-content`,
`playwright-skill`, `multi-stage-dockerfile`, `meta-ads` (para los comentarios en anuncios).
**Descartada:** `video-editing` (apunta a edición manual con DaVinci/CapCut, no a un pipeline
automático).

## 18. Decisiones para revisar (checklist del revisor)

1. **Supabase OlivosSpeed compartida** (prefijo `cos_`) vs. un proyecto de Supabase propio
   para Content OS. Se eligió compartir porque Social Hub ya la usa. El costo: aislamiento
   más débil y migraciones en una base que tocan otras apps.
2. ✅ **Decidido (26-09-2026): cola propia.** Motivos: `pgmq` no tiene clave única de
   deduplicación (la necesitamos para "una sola publicación viva por post"), exige
   habilitar una extensión en una base compartida, y la cola propia se puede probar
   entera con PGlite. Implementada en `0001_cos_base.sql` con leases y reintentos.
   (Texto original de la duda:) **Cola propia en Postgres** (`cos_jobs` + `SKIP LOCKED`) vs. `pgmq` / Supabase Queues. La
   skill `supabase` cubre Queues; hay que decidir antes de la Fase 0.
3. **Worker en `kitchco-soluciones`** (21 apps) vs. `kitchco-gestion` (donde ya corre el
   scheduler de Meta).
4. **Webhook de Meta en Social Hub, que reenvía los mensajes a wa-dashboard** (§10.5) vs. una
   app de Meta separada para cada sistema.
5. **Fase 2A antes que 2B**: priorizar comentarios y palabras clave antes que la edición de
   video.
6. **El mensaje privado lleva a WhatsApp** en vez de vender por Instagram (§10.2).
7. **Link corto propio** (`/r/<código>`) en `social.kitchcocenter.com` vs. un subdominio
   dedicado (por ejemplo `ir.fasutofudo.com`). El propio de la marca da más confianza al
   hacer clic, pero cada subdominio nuevo necesita su registro A (ya no hay comodín en el DNS).
8. **Modelos de IA:** Sonnet 5 para copies y visión; Haiku 4.5 para clasificar comentarios.
