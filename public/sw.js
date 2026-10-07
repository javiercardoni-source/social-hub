// Service worker de la app de aprobación (F12). No cachea nada — lo que se aprueba es siempre lo
// del servidor — solo existe para poder mostrar avisos push aunque la app esté cerrada.

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let datos = { title: "Social Hub", body: "Hay piezas nuevas para aprobar", url: "/app" }
  try {
    if (event.data) datos = { ...datos, ...event.data.json() }
  } catch {
    // Si el payload no es JSON, se usa el aviso genérico de arriba.
  }
  event.waitUntil(
    self.registration.showNotification(datos.title, {
      body: datos.body,
      icon: "/icon",
      badge: "/icon",
      data: { url: datos.url || "/app" },
      tag: "cos-aprobar", // un solo aviso visible a la vez: el nuevo reemplaza al anterior
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/app"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes("/app") && "focus" in c) return c.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
