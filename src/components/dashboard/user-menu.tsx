import { createClient } from "@/lib/supabase/server"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { LogOut, User as UserIcon } from "lucide-react"
import { logout } from "@/app/login/actions"

export async function UserMenu() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const email = user?.email ?? "Sin sesión"
  const initials = email.slice(0, 2).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">Mi cuenta</p>
            <p className="text-xs text-muted-foreground truncate">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserIcon className="h-4 w-4" />
          Perfil
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logout}>
          <button type="submit" className="w-full">
            <DropdownMenuItem className="cursor-pointer">
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
