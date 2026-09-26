import { logout } from "@/app/login/actions"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Sin acceso · Social Hub" }

/** Para quien tiene usuario en OlivosSpeed pero no está en cos_members. */
export default function SinAccesoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-background p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Tu usuario no tiene acceso</h1>
        <p className="text-sm text-muted-foreground">
          Content OS es solo para el equipo que arma y aprueba las publicaciones. Si
          tendrías que entrar, pedíselo a Javier.
        </p>
        <form action={logout}>
          <Button type="submit" variant="outline" className="w-full">
            Salir
          </Button>
        </form>
      </div>
    </main>
  )
}
