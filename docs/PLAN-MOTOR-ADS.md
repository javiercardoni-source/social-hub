# F10 · Motor de ADS — plan (01-10-2026)

## Qué hace

Una vez por semana, para **cada marca** (las de hoy y las que se sumen), el motor propone una
tanda de anuncios **armados a partir de lo que ya funcionó**: las publicaciones y los anuncios que
ya salieron, con sus números. Javier aprueba en Content OS y el motor los **crea en Meta, pausados**.
Javier los prende desde Meta (o desde el Scheduler). El motor nunca prende ni gasta.

## Decisiones de Javier (01-10)

1. **Materia prima:** lo ya publicado (posts orgánicos de IG/FB y anuncios de Meta) con sus
   estadísticas, no el Archivo. Se elige lo mejor y se reusa tal cual o se arma un modelo nuevo
   con ese mismo diseño.
2. **Fuente de números:** todo lo acumulado en el Scheduler (`kitchco-gestion`, `/opt/meta-ads-scheduler/logs`)
   más la API de Meta para el detalle por anuncio.
3. **Alcance:** todas las marcas. Una marca nueva entra sola cuando tiene cuenta publicitaria cargada.
4. **Hasta dónde llega:** crea en Meta **pausado**; prender es de Javier.
5. **Frecuencia:** una tanda por semana.

## Lo que ya existe y se reusa

| Pieza | Dónde | Para qué |
|---|---|---|
| Resumen diario por marca (784 días, dic-2025 → hoy, 5 marcas) | Scheduler `daily-snapshots.json` | Costo por mensaje y gasto por día/marca: la vara para decir "esto rindió" |
| Catálogo de anuncios (379) con formato, objetivo, presupuesto, estado e insights | Scheduler `ads-snapshot.json` | Qué anuncios hubo y cómo se configuraron |
| Insights por anuncio, creativo (video/imagen, título, texto, CTA) | API de Meta (`ads_read`, token sin vencimiento) | El detalle para rankear y para copiar el diseño |
| Publicaciones orgánicas con métricas, rasgos y miniaturas | Content OS `cos_media` (+ `cos_media_metrics`) | Candidatas orgánicas: un post que la rompió se puede pautar |
| Motor de gustos, datos vigentes, brandbook | Content OS | Qué estilo rinde, precios/promos vigentes (van en el texto, nunca en la pieza), reglas de marca |
| Armado de video 9:16 + 4:5 con placa final y checklist | `~/Dev/ff-creativos` | Re-editar un ganador: otra apertura, placa final nueva, sacar precios quemados |
| Creación de campañas | `meta-ads-mcp` / Marketing API (`ads_management`) | Subir lo aprobado, pausado |

## Etapas

### E1 · Ingesta (solo lectura)
- Tablas nuevas: `cos_ad_accounts` (marca ↔ cuenta publicitaria), `cos_ads` (cada anuncio con su
  creativo: tipo, video/imagen guardada, título, texto, CTA, destino, adset, público y presupuesto),
  `cos_ad_daily` (insights por anuncio y día: gasto, impresiones, clics, CTR, conversaciones,
  costo por conversación **de la API**, nunca calculado a mano).
- Import único de lo que juntó el Scheduler + backfill desde dic-2025 por la API (`level=ad`,
  `time_increment=1`, una llamada paginada por cuenta). Después, sync diario.
- Las miniaturas y los videos de los creativos se guardan en `cos-media` (los links de Meta vencen).

### E2 · Ranking de ganadores
- Por marca, dos listas: **anuncios** (costo por conversación y CTR, con un gasto mínimo para que
  cuente) y **orgánicos** (alcance, guardados, compartidos y mensajes respecto del promedio de la cuenta).
- **Filtro de seguridad obligatorio:** la IA mira cada pieza y descarta las que tienen **precio
  quemado**, «sin TACC / gluten free / apto celíacos», promos vencidas o productos que ya no están.
  Lo descartado se puede rescatar re-editándolo (E3).
- Pantalla «Anuncios» en Content OS: el ranking con miniatura, números y por qué está arriba.

### E3 · Tanda semanal
Por marca, de 3 a 5 propuestas, mezclando:
- **Reusar tal cual** un ganador limpio, con texto nuevo armado con los datos vigentes.
- **Re-editar** un ganador: otra apertura, placa final actual («Pedí por WhatsApp…»), sin precio
  en pantalla (usa el armado de video).
- **Pautar un orgánico** que rindió y nunca se pautó.
- **Variante del mismo diseño** (mismo esquema de texto y toma, otro producto o sabor).

Cada propuesta lleva: pieza 9:16 y 4:5, título, texto, CTA, objetivo, público y presupuesto
sugerido (copiados del conjunto que mejor rindió en esa marca) y una línea de **por qué**.

### E4 · Aprobación → Meta pausado
- Las propuestas entran a Aprobaciones (pestaña Anuncios). Se puede editar texto, título y presupuesto.
- Al aprobar: sube la pieza, crea anuncio (y conjunto/campaña si hace falta) **en estado PAUSED**,
  guarda los ids. Nunca `ACTIVE`. Reintentos idempotentes.
- Aviso a Javier: «Tanda lista en Meta, pausada».

### E5 · Aprendizaje
- El sync diario mide cómo rinde cada anuncio creado por el motor contra su ganador de origen.
- La tanda siguiente prioriza los tipos de propuesta y los diseños que ganaron.

## Reglas que no se negocian
- Nunca prender ni subir presupuesto en Meta. Todo se crea pausado.
- Precio solo en el texto del anuncio, nunca en la pieza. Nada de «sin TACC / sin gluten / apto celíacos».
- Producto real. Si una pieza viene de IA, se marca y no se propone sin aviso.
- Números de Meta siempre de `cost_per_action_type`; insights por `level=ad` paginado (ver reglas del Meta Ads Center).
- Lecturas sin pausa; escrituras con 10 s entre llamadas (anti-baneo).
