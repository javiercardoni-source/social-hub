// Da acceso a Content OS a un usuario que YA existe en OlivosSpeed (Supabase Auth).
//
// Uso:
//   node --env-file=.env.local scripts/add-member.mjs <email> <rol> [nombre]
//   roles: viewer · editor · approver · admin
//
// Si ya era miembro, le actualiza el rol. Queda registrado en cos_audit_log.
import pg from "pg"

const [email, role, ...nameParts] = process.argv.slice(2)
const ROLES = ["viewer", "editor", "approver", "admin"]

if (!email || !ROLES.includes(role)) {
  console.error("Uso: node --env-file=.env.local scripts/add-member.mjs <email> <viewer|editor|approver|admin> [nombre]")
  process.exit(1)
}
const url = process.env.SUPABASE_DB_URL
if (!url?.includes("jhftgcjiymjcamjikuwe")) {
  console.error("✗ SUPABASE_DB_URL falta o no apunta a OlivosSpeed.")
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const u = await client.query("select id from auth.users where lower(email) = lower($1)", [email])
  if (u.rowCount !== 1) {
    console.error(`✗ No hay un usuario con el email ${email} en OlivosSpeed. Primero tiene que existir en Supabase Auth.`)
    process.exit(1)
  }
  const userId = u.rows[0].id
  const displayName = nameParts.join(" ") || null
  await client.query("begin")
  await client.query(
    `insert into public.cos_members (user_id, role, display_name) values ($1, $2, $3)
     on conflict (user_id) do update set role = excluded.role,
       display_name = coalesce(excluded.display_name, public.cos_members.display_name)`,
    [userId, role, displayName],
  )
  await client.query(
    `insert into public.cos_audit_log (event, entity_type, entity_id, actor, details_json)
     values ('member.set', 'member', $1, 'script:add-member', jsonb_build_object('role', $2::text))`,
    [userId, role],
  )
  await client.query("commit")
  console.log(`✓ ${email} ahora es ${role} en Content OS.`)
} catch (e) {
  await client.query("rollback").catch(() => {})
  throw e
} finally {
  await client.end()
}
