/**
 * Estados de un post (PLAN §5) — copia para la interfaz y el worker.
 *
 * La fuente de verdad es la función SQL `cos_post_transitions()` (migración 0001):
 * la base rechaza cualquier transición que no esté ahí. El test `post-states.test.ts`
 * compara esta lista con la de la base, así nunca se desincronizan.
 *
 * Sin dependencias y sin sintaxis exclusiva de TypeScript: el worker la corre
 * directo con Node 24.
 */

export const POST_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "PAUSED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "RETRY_SCHEDULED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "MISSED",
] as const

export type PostStatus = (typeof POST_STATUSES)[number]

export const POST_TRANSITIONS: Readonly<Record<PostStatus, readonly PostStatus[]>> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED", "EXPIRED"],
  APPROVED: ["SCHEDULED", "PENDING_APPROVAL", "CANCELLED"],
  SCHEDULED: ["PUBLISHING", "PAUSED", "CANCELLED", "PENDING_APPROVAL", "MISSED"],
  PAUSED: ["SCHEDULED", "CANCELLED", "PENDING_APPROVAL"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["RETRY_SCHEDULED", "CANCELLED", "PENDING_APPROVAL"],
  RETRY_SCHEDULED: ["PUBLISHING", "PAUSED", "CANCELLED", "PENDING_APPROVAL"],
  REJECTED: ["DRAFT"],
  CANCELLED: [],
  EXPIRED: ["DRAFT", "PENDING_APPROVAL"],
  MISSED: ["PENDING_APPROVAL", "CANCELLED"],
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to)
}

/** Etiquetas en castellano para la interfaz (PLAN §5). */
export const POST_STATUS_LABEL: Readonly<Record<PostStatus, string>> = {
  DRAFT: "Borrador",
  PENDING_APPROVAL: "Esperando aprobación",
  APPROVED: "Aprobado",
  SCHEDULED: "Programado",
  PAUSED: "Pausado",
  PUBLISHING: "Publicando",
  PUBLISHED: "Publicado",
  FAILED: "Falló",
  RETRY_SCHEDULED: "Reintentando",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  EXPIRED: "Vencido",
  MISSED: "Perdido",
}
