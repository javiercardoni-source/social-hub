// Gauntlet contra producción: recorre Social Hub como un usuario real, SIN modificar nada.
//   npm run gauntlet:prod
// Chequea: salud, login, cada pantalla con cada marca, en compu y en iPhone:
// sin errores de JavaScript, sin páginas de error, sin desborde lateral, con su contenido clave.
import { webkit, devices } from "playwright"

const BASE = process.env.GAUNTLET_BASE_URL ?? "https://social.kitchcocenter.com"
const EMAIL = process.env.GAUNTLET_EMAIL
const PASSWORD = process.env.GAUNTLET_PASSWORD
if (!EMAIL || !PASSWORD) {
  console.error("✗ Faltan GAUNTLET_EMAIL / GAUNTLET_PASSWORD en .env.local")
  process.exit(1)
}

// Pantalla → texto que tiene que aparecer (prueba que cargó de verdad, no una página vacía).
const PAGES = {
  "/inicio": /Buen(os|as) (días|tardes|noches)/,
  "/media": /Biblioteca/,
  "/media/subir": /Subir contenido/,
  "/aprobaciones": /Aprobaciones/,
  "/feed": /Feed/,
  "/calendar": /Calendario/,
  "/accounts": /Cuentas conectadas/,
  "/marca": /Marca/,
  "/analytics": /Métricas|Analytics/,
}
const BRANDS = ["", "fasutofudo", "bijutsukan", "sensaciones"]
const ERROR_TEXT = /No se pudo|Application error|This page couldn|Something went wrong|Error: /

const fallas = []
const ok = (m) => console.log(`  ✓ ${m}`)
const mal = (m) => {
  fallas.push(m)
  console.log(`  ✗ ${m}`)
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0)
health === 200 ? ok("salud 200") : mal(`salud ${health}`)

const browser = await webkit.launch()
for (const [nombre, device] of [
  ["compu", { viewport: { width: 1366, height: 860 } }],
  ["iPhone", devices["iPhone 14"]],
]) {
  console.log(`\n── ${nombre}`)
  const ctx = await browser.newContext(device)
  const page = await ctx.newPage()
  const jsErrors = []
  page.on("pageerror", (e) => jsErrors.push(e.message))

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" })
  await page.fill("#email", EMAIL)
  await page.fill("#password", PASSWORD)
  await page.click("button[type=submit]")
  await page.waitForURL(/inicio/, { timeout: 30000 }).then(() => ok("login"), () => mal("login no llegó a /inicio"))

  for (const brand of BRANDS) {
    // La marca se elige con la cookie (misma que setea el selector); vacía = todas.
    await ctx.clearCookies({ name: "cos_marca" })
    if (brand) await ctx.addCookies([{ name: "cos_marca", value: brand, url: BASE }])
    for (const [path, must] of Object.entries(PAGES)) {
      const tag = `${nombre} ${brand || "todas"} ${path}`
      jsErrors.length = 0
      // No se espera "red quieta": Aprobaciones tiene videos en bucle y se actualiza sola, así que la
      // red nunca se calma. Se espera a que cargue y a que aparezca el contenido que tiene que estar.
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 45000 }).catch(() => null)
      await page.getByText(must).first().waitFor({ timeout: 20000 }).catch(() => {})
      const status = res?.status() ?? 0
      const body = await page.locator("body").innerText().catch(() => "")
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0)
      // Los avisos de prefetch que el navegador cancela no son errores de la página.
      const errs = jsErrors.filter((e) => !/access control checks|_rsc=/.test(e))
      const problems = [
        status >= 400 ? `HTTP ${status}` : "",
        !must.test(body) ? `no aparece ${must}` : "",
        ERROR_TEXT.test(body) ? `texto de error: "${body.match(ERROR_TEXT)?.[0]}"` : "",
        overflow > 2 ? `desborde lateral ${overflow}px` : "",
        errs.length ? `JS: ${errs[0].slice(0, 120)}` : "",
      ].filter(Boolean)
      problems.length ? mal(`${tag}: ${problems.join(" · ")}`) : ok(tag)
    }
  }
  await ctx.close()
}
await browser.close()

console.log(fallas.length ? `\n✗ GAUNTLET PROD: ${fallas.length} fallas` : "\n✓ GAUNTLET PROD verde")
process.exit(fallas.length ? 1 : 0)
