# Social Hub — Gestor de Redes Sociales

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
