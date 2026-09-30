# F8 · Agenda automática: el sistema elige día y hora de cada publicación · SPEC

> Pedido de Javier (29-09-2026): "que el sistema, solo por el historial de Meta, sepa en qué
> horarios nos conviene publicar, y que un agente analice feriados y clima y lo cuadre todo con
> fechas y horarios en base a las métricas de Meta".
> Plan armado con Fable el 29-09; decisiones cerradas por Javier el 30-09.
> **Estado: CONSTRUIDA Y EN PRODUCCIÓN (30-09-2026, migración 0020).** Decisión final del aviso de lluvia: sale todos los días de lluvia; sol/frío/calor solo si cambió. Horarios: leídos de las webs por la IA y confirmados (editables en Marca → Agenda).

## Qué hay hoy (base)
- `shared/cos/timing.ts` (F1): modelo día×hora con contracción bayesiana, sugiere 3 franjas en
  Aprobaciones. **Sugiere, no decide.**
- F4: feriados (argentinadatos), fechas curadas, clima diario 7 días (Open-Meteo). "Feriado =
  domingo" es un supuesto, no algo aprendido. Clima solo para textos.
- Historias de feriado (`planFeriado`): día correcto, hora fija 11:30.
- `scheduled_at` entra en el hash de aprobación (`cos_posts_guard`, 0001/0008): mover algo
  aprobado lo devuelve a PENDING_APPROVAL.

## Historial real (consulta de solo lectura, 29-09)
| Marca | Qué hay | Consecuencia |
|---|---|---|
| Sensaciones | IG: 355 feed + 150 reels medidos, en 15–16 horas distintas | aprende bien |
| Bijutsukan | IG feed: 76 de 77 a las 20 h | hay que explorar |
| FasutoFudo | IG: 23 reels | se apoya en el patrón común |
| Historias | casi nada (Meta las borra a las 24 h) | se aprende de ahora en adelante |

## Decisiones de Javier (30-09)
1. **Aprobar = sale en el horario que eligió el motor.** "Publicar ya" y "Otro horario" quedan como botones aparte.
2. **Se aprueba contenido + ventana.** El motor puede mover la hora dentro de la ventana, nunca
   a menos de 3 h de salir; cada cambio queda registrado; lo fijado a mano (🔒) no se toca.
3. **Exploración:** ~1 de cada 6 piezas en una franja con poca historia, marcada 🧪.
4. **Límites por cuenta:** feed/reel/carrusel máx. 1 por día y ≥4 h entre sí; historias ≥90 min
   entre sí y máx. 5 por día; siempre de 9 a 22 h y solo los días que abre la marca.
5. **Horarios de apertura:** la IA los saca de las webs de cada marca → Javier confirma →
   se guardan estructurados (por día de la semana, desde/hasta).
6. **El motor es genérico**; después se prende por marca, cada una independiente (llave por marca).
7. **Historias de clima independientes** (ver bloque C).

## Bloques

### A · Aprender (Opus)
- **Clima de lo ya publicado:** a cada `cos_media` se le pega el clima que hizo ese día/hora
  (Open-Meteo *archive*, gratis) y si era feriado/puente/fecha especial. Solo sirve para que el
  modelo aprenda si la lluvia, el frío o un feriado cambian el rendimiento o el mejor horario.
- Modelo ampliado: día × hora + efecto feriado + efecto clima (lluvia/frío/calor/soleado) +
  formato, cada efecto con contracción (poca evidencia = no manda) y confianza.
- Si la data no muestra efecto, lo dice ("sin efecto claro") y no lo usa.
- **Pooling entre marcas** para las que tienen poca historia (FasutoFudo).
- Foto diaria del modelo por cuenta+formato (tabla nueva) → web, worker y agente usan lo mismo;
  cada decisión es explicable.

### B · Mirar adelante (Opus)
- Clima **por hora a 14 días** (Open-Meteo hourly) además del diario.
- Horarios de apertura estructurados por marca (decisión 5): job `brand:hours` lee la web de la
  marca → propuesta → Javier confirma en Marca → Datos vigentes.

### C · Historias de clima (independientes) (Sonnet; generador en el worker, Opus revisa)
Generador aparte, igual que las historias de feriado (campaña `clima:<día>`, una por marca y día):
- **Soleado / día lindo:** historia alegre, con buena onda.
- **Lluvia:** aviso honesto: "en días de lluvia la demora puede ser un poco mayor por la calzada
  mojada" (tono amable, sin dramatizar). Nunca promete rapidez (regla F4).
- Frío / calor fuerte / tormenta: consigna propia (a definir con el brandbook).
- Hora: la elige el motor, pero **siempre antes del servicio** (la lluvia avisada antes de la
  cena, no durante). Si el pronóstico cambia y la historia ya no corresponde, se vence sola.
- Respeta la regla vigente del clima: solo si cambió de categoría vs ayer y como mucho 1 por día
  por marca (pendiente: ¿el aviso de lluvia sale igual todos los días de lluvia? ver abajo).
- Solo días que abre la marca. Pasa por Aprobaciones como todo.

### D · Agente estratega (Sonnet la consigna, Opus el validador)
- Corre 1 vez por día + cuando cambia el pronóstico o entra algo aprobado.
- Recibe: el modelo (números reales), próximos 14 días (feriados, fechas especiales, clima por
  hora), cola de piezas, Datos vigentes, grilla del Feed (F6).
- Devuelve el **plan de la semana**: cada pieza con día, hora y el porqué en una línea
  ("Jue 19:30 · reel · +28 % · llueve desde las 18: día de delivery"). Puede proponer piezas
  (historia de clima, fecha especial).
- **Propone, no decide:** un validador en código aplica apertura, límites, nada en el pasado,
  orden de la grilla. Si la IA falla, el asignador arma el plan solo.

### E · Asignador (Opus)
- Ventanas: fija (feriados), "antes de" (fecha especial, promo que vence), "cuando convenga"
  (próximos 7 días).
- Aplica límites (decisión 4), exploración (decisión 3), orden de grilla F6.
- Historias de feriado: día fijo, hora del motor (chau 11:30 fijo).
- Guarda la predicción de cada pieza → a las 24–48 h se compara con lo real.

### F · Pantallas (Sonnet)
- Aprobaciones: horario + porqué; aprobar = sale ahí; "Publicar ya" / "Otro horario".
- Calendario: semana armada con 🔒 fijado · ⚙️ motor · 🧪 prueba + tarjeta "Plan de la semana".
- Métricas: "Qué aprendió" (franjas, efecto feriado/clima) y "¿Acierta?" (predicho vs real).
- Marca: llave "Agenda automática" y horarios de apertura.

## Orden y modelos
| Etapa | Bloques | Modelo |
|---|---|---|
| 1 | A + B | Opus |
| 2 | E + ventanas de aprobación (toca el hash/guard) | Opus |
| 3 | C + D | Sonnet (consignas) / Opus (validador y generador) |
| 4 | F | Sonnet |
| — | Check antes de prender | Fable |

## Pendientes antes de arrancar
- [ ] Javier suma lo que falta (dijo que viene más).
- [ ] ¿El aviso de lluvia sale **todos** los días de lluvia (es info operativa) o respeta
      "solo si cambió vs ayer"? Recomendación: todos los días de lluvia, pero la historia
      *alegre* de sol solo cuando cambia.
- [ ] Qué webs leer para los horarios (hoy: sensaciones, bijutsukan, fasutofudo).

## Más adelante (fuera de alcance)
Optimizar por **pedidos** y no solo por alcance: cruzar hora de publicación con ventas del
MAESTRO (atribución, Fase 3).

## Aceptación
- Tests: efectos con contracción, "sin efecto claro", asignador respeta límites/apertura/ventanas,
  exploración 1/6, historias de clima (sol/lluvia, vencimiento si cambia el pronóstico), validador
  descarta propuestas inválidas del agente.
- Nada aprobado se publica fuera de su ventana; lo 🔒 no se mueve.
- gauntlet verde + críticos sin P0/P1 + gauntlet:prod verde.

## Cruces con F7 «Motor de gustos» (anotado el 30-09 al arrancar F7 M0)
- **Migraciones:** F7 usa la 0018. F8 arranca en la 0019 (o la que siga libre).
- **Motor de horarios compartido:** F7 mide el contenido *descontando la franja* con `slotModel`
  (`shared/cos/timing.ts`). F8 le suma efectos de feriado y clima a ese mismo modelo. F7 tiene que
  consumirlo por su API (no copiar la cuenta): cuando llegue F8, el residuo de F7 mejora solo.
- **Un solo "plan de la semana":** F7 M3 (`taste:suggest`) y el agente estratega de F8 arman los
  dos un plan semanal. Tiene que ser UNO: el agente de F8 recibe las sugerencias de contenido de F7
  (qué hacer) y decide cuándo. Definirlo antes de construir F7 M3 o F8 bloque D, lo que llegue primero.
- **Clima de lo ya publicado** (bloque A): F7 también lo necesita (spec F7 «La realidad que manda» 5).
  Se construye una sola vez, en el bloque A de F8, y lo usan los dos.
