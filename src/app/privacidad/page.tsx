export const metadata = { title: "Política de privacidad · Content OS" }

const ACTUALIZADA = "28 de septiembre de 2026"
const CONTACTO = "javiercardoni@gmail.com"

export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 leading-relaxed">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Kitchco · Content OS</p>
      <h1 className="mt-1 text-3xl font-extrabold">Política de privacidad</h1>
      <p className="mt-1 text-sm text-muted-foreground">Última actualización: {ACTUALIZADA}</p>

      <div className="mt-8 space-y-6 text-[15px]">
        <section>
          <h2 className="text-lg font-bold">Qué es Content OS</h2>
          <p className="mt-2">
            Content OS es una herramienta interna de Kitchco para organizar las fotos y videos que
            produce nuestro equipo de cocina y publicarlos en las cuentas de Instagram y Facebook
            de nuestras marcas (Sensaciones de Oriente, Bijutsukan y FasutoFudo). Solo la usa el
            equipo de Kitchco; no está abierta al público.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">Qué datos usamos</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <b>Material de las cocinas:</b> fotos, videos y la descripción que escribe el empleado
              que los envía.
            </li>
            <li>
              <b>Google Drive:</b> Content OS solo accede a los archivos y carpetas que crea él
              mismo (permiso <code>drive.file</code>). No lee ni modifica ningún otro archivo del
              Drive.
            </li>
            <li>
              <b>Meta (Instagram y Facebook):</b> usamos el acceso a nuestras propias páginas para
              publicar contenido, leer métricas y, cuando esté activado, responder comentarios y
              mensajes. De quien comenta o escribe guardamos solo lo necesario para responder:
              identificador, nombre de usuario y el texto del mensaje.
            </li>
            <li>
              <b>Enlaces cortos:</b> registramos que alguien hizo clic, sin guardar su dirección IP
              ni otros datos personales.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-bold">Para qué los usamos</h2>
          <p className="mt-2">
            Exclusivamente para publicar contenido de nuestras marcas, responder a quienes nos
            escriben y medir cómo funcionan las publicaciones. No vendemos ni compartimos datos con
            terceros, ni los usamos para publicidad fuera de nuestras propias cuentas.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">Dónde se guardan</h2>
          <p className="mt-2">
            En servidores propios de Kitchco, en una base de datos de Supabase y en Google Drive.
            El acceso está restringido al equipo autorizado y las credenciales se guardan fuera del
            código.
          </p>
        </section>

        <section id="eliminacion">
          <h2 className="text-lg font-bold">Cómo pedir que borremos tus datos</h2>
          <p className="mt-2">
            Si comentaste o nos escribiste y querés que borremos lo que guardamos de vos, mandá un
            mail a <a className="underline" href={`mailto:${CONTACTO}`}>{CONTACTO}</a> con tu
            nombre de usuario de Instagram o Facebook. Lo borramos dentro de los 30 días y te
            confirmamos por el mismo medio.
          </p>
          <p className="mt-2">
            También podés quitarle el acceso a Content OS en cualquier momento desde la
            configuración de apps de tu cuenta de Google o de Facebook.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">Contacto</h2>
          <p className="mt-2">
            Kitchco · <a className="underline" href={`mailto:${CONTACTO}`}>{CONTACTO}</a>
          </p>
        </section>
      </div>
    </main>
  )
}
