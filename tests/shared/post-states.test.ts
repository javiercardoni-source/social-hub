import { describe, it, expect } from "vitest"
import { POST_STATUSES, POST_TRANSITIONS, canTransition } from "../../shared/cos/post-states"
import { freshDb } from "../db/harness"

describe("estados de un post", () => {
  it("la copia en TypeScript es idéntica a la de la base (fuente de verdad)", async () => {
    const db = await freshDb()
    const r = await db.query<{ from_status: string; to_status: string }>(`select * from cos_post_transitions()`)
    const enBase = r.rows.map((t) => `${t.from_status}→${t.to_status}`).sort()
    const enTs = Object.entries(POST_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}→${to}`))
      .sort()
    expect(enTs).toEqual(enBase)
  })

  it("los estados de TypeScript son los mismos que acepta la tabla", async () => {
    const db = await freshDb()
    const r = await db.query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       where c.conrelid = 'cos_posts'::regclass and c.contype = 'c' and c.conname = 'cos_posts_status_check'`,
    )
    const enBase = [...r.rows[0].def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort()
    expect([...POST_STATUSES].sort()).toEqual(enBase)
  })

  it("publicado y cancelado son finales", () => {
    expect(POST_TRANSITIONS.PUBLISHED).toEqual([])
    expect(POST_TRANSITIONS.CANCELLED).toEqual([])
  })

  it("no hay atajo de borrador a publicado", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false)
    expect(canTransition("PENDING_APPROVAL", "PUBLISHING")).toBe(false)
  })
})
