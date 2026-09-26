# Social Hub — Content OS de Kitchco

> 📍 **ESTE PROYECTO VIVE EN `~/Dev/social-hub/`** desde el 2026-09-26. Se mudó fuera de
> iCloud (`~/Documents/Sistema Kitchco/Sistemas/Social Hub/social-hub/`) por el mismo motivo
> que `kitchco` y `founders`: iCloud dejaba `node_modules` "dataless" y todo se colgaba.
> Si abrís la carpeta vieja, está desactualizada.

> ⛔ **Servidor:** `kitchco-soluciones` · IP **`179.197.225.55`** (Campinas, desde el
> 2026-09-25; la vieja `2.24.64.7` de Boston ya no existe).
>
> - **Entrar:** `ssh -i ~/.ssh/id_ed25519 root@179.197.225.55`
> - **En el servidor:** `/opt/social-hub` · puerto `3650` · social.kitchcocenter.com
> - **Deployar:** `./infra/deploy.sh social-hub` (desde la raíz del workspace, `~/Documents/Sistema Kitchco/`)
> - El compose que corre es **`docker-compose.bridge.yml`** (vive **solo en el servidor**, no
>   el `.prod.yml`, que tiene etiquetas de Traefik viejas) y la app publica **solo en
>   `127.0.0.1:3650`**: nginx del host hace de puerta.
> - Mapa completo de la infra: **`infra/SERVIDORES.md`** en la raíz del workspace.

## Qué es

Social Hub es donde vive **Content OS**: los empleados mandan fotos y videos con descripción
desde la PWA de Turnos → se archivan en Google Drive → la IA los clasifica y escribe los
textos en el tono de cada marca → Javier aprueba → se publican solos en Instagram y Facebook
→ los comentarios se contestan desde acá.

**El plan que se ejecuta es [`PLAN-CONTENT-OS.md`](PLAN-CONTENT-OS.md).** Leelo antes de
tocar cualquier cosa de Content OS. El paquete original de especificaciones está en
`docs/content-os-spec-v2/` y queda solo como referencia de intención: donde difiere, manda
el plan.

- **Marcas activas:** Sensaciones de Oriente, Bijutsukan, FasutoFudo. (StohrBurgers está
  dada de baja.) **Marca de prueba: FasutoFudo.**
- **Maqueta visual aprobada como base:** https://claude.ai/artifact/HwXuKvr4sYAPSp7ZSP1Ytk

## 🧠 Regla: qué modelo de IA usar (decidido por Javier el 26-09-2026)

Se trabaja en **modo híbrido**: el modelo caro solo donde un error es caro.

**Obligación de Claude:** al empezar cada bloque de trabajo, decir en una línea qué modelo
corresponde según esta tabla. Si el modelo actual no es ese, **avisar antes de arrancar** con
el comando exacto (`/model opus`, `/model sonnet`, `/model claude-fable-5`) y esperar. Cuando
se termina un bloque de Opus y el siguiente es de Sonnet, avisarlo también: bajar de modelo es
tan importante como subir.

| Modelo | Cuándo | Ejemplos en este proyecto |
|---|---|---|
| **Opus 5.5** (`/model opus`) | Lo delicado: un bug acá es caro o silencioso | Migraciones SQL y RLS · la cola `cos_jobs` y el worker · publicación en Meta, idempotencia y reconciliación · webhook de Meta y su firma · auth, `proxy.ts` y permisos · API entre Turnos y Content OS · seguridad y secretos · bugs difíciles · decisiones de arquitectura |
| **Sonnet 5** (`/model sonnet`) | El grueso: ejecutar lo que el plan ya definió | Pantallas y componentes (Biblioteca, Composer, Aprobaciones, Calendario, Cuentas, Comentarios) · la pantalla «Enviar contenido» de la PWA · acciones de servidor simples · ajustes de prompts y copies · tests de interfaz · documentación · deploys de rutina |
| **Fable 5** (`/model claude-fable-5`) | Revisar, no construir | Check del plan antes de cada fase · revisión de arquitectura · auditoría al cerrar una fase |
| **Haiku 4.5** | Mecánico y repetitivo | Renombres masivos, formateo, búsquedas. (En producción: clasificar comentarios, ver §11 del plan) |

**Mapa de la hoja de ruta** (ver §14 del plan):

| Fase | Bloque | Modelo |
|---|---|---|
| 0 | Mudanza, deploy, migraciones, RLS, cola, `proxy.ts`, esqueleto del worker, tests base | **Opus** |
| 1 | Ingreso Turnos → Drive, publisher de Meta, cola de publicación | **Opus** |
| 1 | Pantallas: Inicio, Biblioteca, Composer, Aprobaciones, Cuentas · PWA «Enviar contenido» | **Sonnet** |
| 1 | Prompts de clasificación y copies | **Sonnet** (Opus si hay que pensar el esquema) |
| 1→2A | Check antes de avanzar | **Fable** |
| 2A | Webhook, deduplicación, motor de palabras clave | **Opus** |
| 2A | Bandeja de comentarios, pantalla de palabras clave, link corto | **Sonnet** |
| 2B | Pipeline de ffmpeg | **Opus** |
| 2B | Calendario, campañas | **Sonnet** |
| 3 | Mensajes a wa-dashboard, atribución hasta el pedido | **Opus** |

## Stack real

- **Next.js 16.2** (App Router, el middleware se llama `src/proxy.ts`) + React 19.2 +
  TypeScript. ⚠️ Next 16 cambió APIs: **leé `node_modules/next/dist/docs/` antes de
  escribir código** (ver `AGENTS.md`).
- **Supabase OlivosSpeed** (`jhftgcjiymjcamjikuwe`), compartido con otras apps: **todas las
  tablas de Content OS llevan el prefijo `cos_`** y las migraciones viven en
  `supabase/migrations/`.
- Tailwind 4 + shadcn/ui.
- **Worker** en `worker/` (Node 24 + TS, contenedor aparte, con ffmpeg).
- Tests: **vitest** (lógica) y **playwright** (flujos).
- Errores: **Argos** (botón 🐛, panel central argos.kitchcocenter.com).

## Convenciones

- TypeScript estricto. Comentarios en castellano, claros.
- Nada de secretos en el repo: tokens de Meta y Google van por variables de entorno; en la
  base solo se guarda el **nombre** de la variable.
- Social Hub **no publica**: deja trabajos en la cola; publica el worker.
- Correr `npm test` después de cada cambio significativo.

## Repo

- **GitHub:** https://github.com/javiercardoni-source/social-hub · rama `main`
