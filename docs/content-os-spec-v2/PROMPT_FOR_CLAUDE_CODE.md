# PROMPT PARA CLAUDE CODE / VS CODE AGENT

Estás dentro del repositorio de Content OS.

Tu trabajo es construir el MVP local-first completo.

Antes de tocar código:
1. leé todos los archivos Markdown;
2. generá IMPLEMENTATION_PLAN.md;
3. generá TASKS.md;
4. generá ARCHITECTURE_DECISIONS.md;
5. proponé stack;
6. documentá riesgos.

Decisión central:
GOOGLE DRIVE ES EL MEDIA MASTER.

La app local NO debe depender de almacenar permanentemente fotos/videos.

Implementá primero:
- Storage abstraction
- Drive adapter
- SQLite schema
- cache manager
- sync engine

Después:
- UI
- AI
- media pipeline
- campaigns
- approvals
- scheduler
- social adapters
- backup
- aviso 90 días

No hardcodees comportamientos cambiantes de APIs sociales.
No guardes secretos en repo.
No sobrescribas versiones.
No publiques sin aprobación en SAFE_MODE.
No dupliques posts.
No declares terminado hasta demostrar el flujo end-to-end.
