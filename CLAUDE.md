# Social Hub — Gestor de Redes Sociales

> ⛔ **ESTE PROYECTO CAMBIÓ DE SERVIDOR EL 2026-09-25.** Vivía en `kitchco-soluciones`
> con la IP **`2.24.64.7` (Boston)**. Ese VPS **se reinstaló en Campinas, Brasil**, y
> Hostinger le dio otra IP: **`179.197.225.55`**. Si en algún script, doc o comando
> aparece la vieja, está desactualizado — ese servidor ya no existe.
>
> - **Entrar:** `ssh -i ~/.ssh/id_ed25519 root@179.197.225.55`
> - **En el servidor:** `/opt/social-hub` · puerto `3650` · social.kitchcocenter.com
> - **Deployar:** `./infra/deploy.sh social-hub` (desde la raíz del workspace, `~/Documents/Sistema Kitchco/`)
> - **Por qué se mudó:** desde Boston cada consulta a Supabase —que está en São Paulo—
>   costaba entre 197 y 523 ms; desde Campinas cuesta 50-78. Eran 21 apps pagando ese
>   peaje en cada consulta.
> - El compose que corre es **`docker-compose.bridge.yml`** (no el `.prod.yml`) y la app
>   publica **solo en `127.0.0.1:3650`**: nginx del host hace de puerta.
> - Mapa completo de la infra: **`infra/SERVIDORES.md`** en la raíz del workspace.

Dashboard para administrar publicaciones de Instagram, Facebook y otras redes sociales.
Inspirado en Onlypult (app.onlypult.com).

## Stack

- **Framework**: Next.js 15 + TypeScript
- **DB**: Supabase (proyecto OlivosSpeed compartido)
- **UI**: Tailwind CSS + shadcn/ui
- **Auth**: Supabase Auth
- **Deploy**: VPS 147.93.9.138 (Docker + Traefik)

## Features principales (roadmap)

1. **Multi-cuenta**: conectar múltiples cuentas de IG, FB, X, LinkedIn, TikTok
2. **Composer**: crear posts con preview por red social
3. **Calendario visual**: vista mensual/semanal, drag & drop
4. **Media library**: biblioteca centralizada de imágenes y videos
5. **Scheduling**: programar publicaciones con colas automáticas
6. **Analytics**: métricas de engagement por cuenta y post
7. **Queue system**: slots horarios + contenido se llena automáticamente

## Redes sociales objetivo

| Red | API | Prioridad |
|-----|-----|-----------|
| Instagram | Meta Graph API | Alta |
| Facebook | Meta Graph API | Alta |
| Twitter/X | X API v2 | Media |
| LinkedIn | LinkedIn Marketing API | Media |
| TikTok | TikTok for Business API | Baja |

## Estructura del proyecto

```
src/
├── app/                  # App Router pages
│   ├── (auth)/          # Login, registro
│   ├── (dashboard)/     # Layout principal autenticado
│   │   ├── calendar/    # Calendario de publicaciones
│   │   ├── composer/    # Crear/editar posts
│   │   ├── media/       # Biblioteca de medios
│   │   ├── analytics/   # Métricas y reportes
│   │   ├── accounts/    # Gestión de cuentas sociales
│   │   └── settings/    # Configuración
│   └── api/             # API routes
├── components/          # Componentes reutilizables
├── lib/                 # Utilidades, clients, types
└── hooks/               # Custom hooks
```

## Repo

- **GitHub**: https://github.com/javiercardoni-source/social-hub
- **Branch principal**: main

## Convenciones

- TypeScript estricto
- Componentes con shadcn/ui
- Supabase para auth + storage + DB
- API routes para conectar con APIs de redes sociales
