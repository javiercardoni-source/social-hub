# F12 · App de aprobación en el celular · SPEC

> Pedido de Javier (07-10-2026): "un formato app de Social Hub para que yo pueda realizar el proceso
> de aprobación desde una app en mi móvil. Quiero eso, nada más que eso, que sea 100 % dedicada a
> aprobación. Realizá el plan utilizando Gauntlet, loop y goal."
> **Estado: TEST, en producción** (E1-E4 implementadas; críticos propios con hallazgos 60-62 en findings.md, corregidos; falta la prueba final de Javier en su iPhone — ver GOAL).

## GOAL (cuándo está terminada)

**Javier aprueba la semana de una marca desde el iPhone, con la app instalada, sin abrir la compu,
en menos de 10 minutos y sin un solo error.** Medible:

1. Se instala desde Safari ("Agregar a inicio"), abre a pantalla completa y queda logueada.
2. Con 30 piezas pendientes de una marca, Javier puede verlas, escucharlas y decidir cada una en
   ≤ 20 s promedio (un toque para aprobar, uno + motivo para rechazar).
3. **Nunca se aprueba algo distinto de lo que se vio** (misma regla que la web: pieza final armada
   y revisada; la hora que se aprueba es la que se mostró).
4. Ninguna acción se pierde: sin señal, la app lo dice y no marca como aprobado lo que no llegó.
5. `npm run gauntlet` y `npm run gauntlet:prod` verdes, con la app incluida en la prueba de iPhone.

## Qué es (y qué no)

**Es:** una sola pantalla, pensada para el pulgar, que muestra lo que espera aprobación y deja
decidir. **No es:** Social Hub achicado. Nada de Biblioteca, Marca, Calendario, Anuncios ni ajustes.

| Hace | No hace (queda en la web) |
|---|---|
| Ver cada pieza tal cual sale (video con sonido, imagen, historia en 9:16) | Subir material, editar marca, plantillas de imprenta |
| Aprobar con la hora de la agenda (o "ya", o elegir día y hora) | Editar el guion de un reel, cambiar tipografías |
| Rechazar con motivo (los mismos chips que la web: el motor aprende) | Calendario, métricas, anuncios |
| Aprobar o rechazar toda la subida de una vez (reel + historia + FB) | |
| Ver el texto del post y el porqué del horario | |
| Filtrar por marca | |

## DESIGN

### Dónde vive
`social.kitchcocenter.com/app` dentro del mismo proyecto Next (misma sesión, misma base, mismas
reglas). Sin DNS nuevo, sin otro deploy. Layout propio: sin barra lateral ni topbar.
Manifest propio (`/app/manifest.webmanifest`) con `start_url: /app` y nombre "Aprobar" → al
instalarla se abre directo en la cola.

### Pantalla (una sola)
- **Arriba:** marca (chips: Todas · Bijutsukan · Sensaciones · FasutoFudo) y contador "12 por aprobar".
- **Centro:** una tarjeta por subida (lo que hoy es un grupo en Aprobaciones):
  - la pieza a pantalla casi completa: el reel se reproduce solo, se toca para sonido;
  - pestañas chicas para pasar entre los formatos de la subida (Reel · Historia · FB · Post);
  - debajo, plegado: texto del post, horario propuesto ("jue 19:30 · +28 %"), aviso de la IA si lo hay.
- **Abajo, fijo (zona del pulgar):** `Rechazar` · `Aprobar` (grande). Aprobar = horario de la
  agenda; mantener apretado abre "Ya" / "Elegir día y hora". Rechazar abre los chips de motivo +
  nota opcional + "rechazar toda la subida".
- Al decidir, pasa sola a la siguiente (con "Deshacer" 5 s en lo aprobado mientras falte > 3 h
  para salir, usando `volverAAprobacion`).
- Estado vacío: "Nada por aprobar 🎉 · próxima tanda: …".

### Datos y acciones (se reusa todo, nada nuevo en la base)
- Lectura: la misma consulta de `aprobaciones/page.tsx`, extraída a `lib/cos/aprobaciones-datos.ts`
  y usada por las dos pantallas (una sola fuente de verdad: lo que se oculta "preparando", el armado
  pendiente, etc.).
- Acciones: `aprobarPost`, `rechazarPost`, `volverAAprobacion` (las mismas de la web, con sus
  controles: pieza revisada, hora vista = hora aprobada, choques con la agenda).
- Sin migraciones. Sin cambios en el worker.

### Instalable y rápida
- PWA: manifest + íconos + `apple-mobile-web-app-capable`; service worker mínimo solo para que
  abra rápido y muestre "sin conexión" (no cachea datos: lo que se aprueba es siempre lo del
  servidor).
- Videos con `preload="metadata"` y el siguiente precargado; imágenes ya firmadas por el servidor.

### Avisos (decisión 2)
Si Javier quiere: notificación push en el iPhone cuando hay piezas nuevas por aprobar (Web Push,
iOS 16.4+ con la app instalada). Una por tanda, no una por pieza. Necesita: tabla de suscripciones
(migración chica), claves VAPID en variables de entorno, el worker manda el aviso al terminar de
armar una tanda.

## Plan por etapas (el loop de Gauntlet por cada una)

| Etapa | Qué | Modelo |
|---|---|---|
| E1 | Extraer `aprobaciones-datos.ts` (sin cambiar la web) + tests de que la web sigue igual | Opus |
| E2 | Ruta `/app`, layout propio, manifest e íconos, login que vuelve a `/app` | Sonnet |
| E3 | La cola: tarjeta, formatos, aprobar/rechazar/deshacer, filtro por marca, estados vacío y error | Sonnet |
| E4 | (si se decide) Push: suscripción, VAPID, aviso del worker | Opus |

Cada etapa recorre: **IMPLEMENT → TEST → CRITIC → FIX → REGRESSION → VERIFY**.

## Críticos (independientes, con la consigna de romperla)
- **UX Critic (celular):** iPhone real (Playwright con perfil iPhone 15 + Safari): pulgar, zonas
  seguras (notch y barra), videos con sonido, rotación, textos largos, 40 piezas en cola.
- **Product Critic:** ¿se cumple el GOAL? ¿Hay algo que obligue a abrir la compu?
- **Data / Integration Critic:** que nunca se apruebe algo no visto ni otra hora; doble toque;
  dos dispositivos aprobando lo mismo; sin señal a mitad de la acción; sesión vencida.

## TEST
- Unitarios: la extracción de datos devuelve lo mismo que hoy (snapshot de grupos).
- e2e con Playwright en perfil iPhone contra un build local: instalar (manifest válido), aprobar,
  rechazar con motivo, deshacer, filtro de marca, cola vacía, error de red simulado.
- `gauntlet:prod`: se suma `/app` a la recorrida de iPhone (sin errores de JS, sin desborde).
- Prueba final con Javier: aprueba una tanda real desde su iPhone (el GOAL).

## Riesgos
- iOS limpia la sesión de una PWA si no se abre en ~7 días → login simple y que vuelva a `/app`.
- Videos pesados con datos móviles → se muestra la tapa y el video carga al tocar si hay red lenta.
- Push en iOS solo con la app instalada desde Safari (no desde Chrome).

## Decisiones para Javier
1. **Dirección:** `social.kitchcocenter.com/app` (recomendado: ya anda, sin DNS) o un dominio propio
   tipo `aprobar.kitchcocenter.com` (hay que crear el registro DNS).
2. **Avisos push** cuando hay piezas nuevas para aprobar: sí / no (suma la etapa E4).
3. **Gesto:** botones Aprobar / Rechazar abajo (recomendado, sin errores por deslizar sin querer) o
   deslizar la tarjeta (derecha aprueba, izquierda rechaza) además de los botones.

## Decisiones de Javier (07-10)
1. **Dirección:** `social.kitchcocenter.com/app`.
2. **Avisos push:** sí (etapa E4).
3. **Gesto tipo Tinder:** deslizar a la derecha = aprobar, a la izquierda = rechazar (los botones
   quedan además, para quien prefiera tocar). **Cada pieza va sola** (reel, historia, post y FB por
   separado aunque sean la misma gráfica), en su formato real: historia 9:16 a pantalla completa,
   reel 9:16 con el texto del post legible abajo, post 4:5 con su texto. **Siempre con sonido.**
   - Límite de iOS: ninguna página puede arrancar con sonido sola. Al abrir, un toque en "Empezar"
     desbloquea el audio; desde ahí cada deslizamiento es un gesto del usuario y el siguiente video
     arranca con sonido dentro de ese gesto.
   - Rechazar deslizando abre los motivos (chips) antes de confirmar; cancelar devuelve la tarjeta.
   - Aprobar deslizando = horario de la agenda; si la pieza no tiene horario de agenda, pregunta
     "Ya" o "Elegir día y hora" (no aprueba a ciegas).

4. **Solo lo listo y terminado (07-10, tarde):** la app no muestra piezas sin render (aunque la web
   las muestre como «trabadas» para no perderlas) ni piezas con un trabajo pendiente en la cola (se
   están rehaciendo: lo que se ve cambiaría enseguida). `cargarAprobaciones(brand, { soloListas: true })`.
   La web sigue mostrando lo trabado.

## Nota de proceso (07-10)
El repaso de "UX Critic (celular)" de esta ronda se hizo directo (Playwright, perfil iPhone 15,
contra producción, sesión real) en vez de delegarlo a un subagente aparte — el entorno de esta
sesión no tenía el Agent tool disponible para F12. Encontró 3 problemas reales (hallazgos 60-62 en
`findings.md`), los 3 se arreglaron y se volvieron a probar en vivo. Lo que un crítico independiente
sí agrega y acá falta: una mirada fresca sin el sesgo de quien escribió el código, y la prueba real
de audio/push en un iPhone físico (fuera del alcance de Playwright). La prueba final de Javier cubre
ambas cosas.
