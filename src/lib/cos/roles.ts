/**
 * Roles de Content OS (tabla cos_members). Cada rol incluye los permisos del anterior:
 *   viewer   → mira
 *   editor   → arma posts y sube material
 *   approver → además aprueba y rechaza
 *   admin    → además configura cuentas, miembros y pausas
 */
export const COS_ROLES = ["viewer", "editor", "approver", "admin"] as const
export type CosRole = (typeof COS_ROLES)[number]

export function isCosRole(value: unknown): value is CosRole {
  return typeof value === "string" && (COS_ROLES as readonly string[]).includes(value)
}

/** ¿El rol `have` alcanza para lo que pide `need`? */
export function roleAtLeast(have: CosRole, need: CosRole): boolean {
  return COS_ROLES.indexOf(have) >= COS_ROLES.indexOf(need)
}
