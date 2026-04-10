"use client"

import { Bell, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"

export function Topbar() {
  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar posts, cuentas…"
          className="pl-9"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon">
          <Bell className="h-4 w-4" />
        </Button>
        <Button asChild size="sm">
          <Link href="/composer">
            <Plus className="h-4 w-4" />
            Nuevo post
          </Link>
        </Button>
      </div>
    </header>
  )
}
