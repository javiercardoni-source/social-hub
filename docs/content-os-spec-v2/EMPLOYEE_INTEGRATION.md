# SISTEMA DE CONTEO DE HORAS Y TURNOS

Cuando se mencione "app de empleados", se refiere al sistema existente:
**Sistema de Conteo de Horas y Turnos**

## Nuevo módulo
Enviar contenido

## Campos
- Foto o video: obligatorio
- Descripción: obligatoria
- Marca/unidad: si aplica
- Prioridad: opcional
- Fecha/hora: automática
- employee_id: automático

## Flujo
Empleado envía
-> archivo se guarda en Google Drive
-> metadata asociada
-> Content OS sincroniza
-> asset queda NEW
-> validación
-> READY

## Regla
Sin descripción:
- no READY;
- no IA;
- no planificación;
- no publicación.
