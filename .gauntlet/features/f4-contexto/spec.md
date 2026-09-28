# F4 — Contexto: feriados, fechas especiales y clima · SPEC

> Pedido de Javier (28-09): "que le podamos cargar contexto anual: feriados, días especiales,
> menciones en base al clima, para hacerlo lo más orgánico posible". Adelantada antes de F2/F3
> por decisión de Javier (se viene el Día de la Madre, 18-10).

## Fuentes (probadas 28-09)
- Feriados AR: `api.argentinadatos.com/v1/feriados/<año>` (19 en 2026, incluye puentes y trasladables).
- Clima Buenos Aires: Open-Meteo, pronóstico diario 7 días (código WMO, máx/mín, prob. de lluvia). Gratis.
- Fechas del rubro: lista curada en código (`shared/cos/special-days.ts`), calculada por año
  (Día de la Madre = 3.er domingo de octubre, etc.), con idea de contenido por fecha.
- Fechas propias de cada marca: se cargan a mano desde Calendario (y más adelante, del brandbook).

## Requisitos
1. Tablas `cos_special_days` (fecha, nombre, tipo, marca opcional, fuente, idea) y
   `cos_weather_daily`. Lectura: miembros. Escritura: worker y acciones del servidor.
2. Worker `context:sync` cada 6 h: feriados del año actual y el siguiente, fechas curadas, clima 7 días.
   Idempotente (upsert por clave natural).
3. IA: al escribir un post (borrador y rehacer) recibe el **contexto real** de hoy y mañana:
   fechas especiales (globales y de la marca) y clima. Regla: usarlo solo si suma, nunca inventar,
   nunca prometer por el clima (ej. "llegamos rápido aunque llueva" NO; "llueve, pedí y quedate
   adentro" SÍ).
4. Calendario: "Próximas fechas" (30 días) con su idea de contenido, clima de los próximos 7 días
   marcando los **días de delivery** (lluvia, frío o calor fuerte), y alta/baja de fechas propias.
5. Motor de horarios: un feriado se trata como domingo (al aprender y al sugerir).

## Aceptación
- Feriados 2026/2027 + fechas curadas + clima cargados en producción.
- Un borrador creado hoy menciona la lluvia de mañana solo si suma, y no inventa.
- Tests: fechas curadas (3.er domingo, etc.), clima → "día de delivery", feriado = domingo en el motor.
- gauntlet verde, crítico sin P0/P1, gauntlet:prod verde.
