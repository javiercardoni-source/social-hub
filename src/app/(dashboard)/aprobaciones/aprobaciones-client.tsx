"use client"

import { useTransition, useState } from "react"
import Image from "next/image"
import { aprobarPost, rechazarPost } from "@/lib/cos/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle, XCircle, Clock, User, Loader2 } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"

type Post = {
  id: string
  caption: string
  hashtags: string
  platform: string
  post_type: string
  scheduled_at: string | null
  created_at: string
  brand: { name: string; color: string } | null
  thumbUrl: string | null
  submittedBy: string | null
}


function PostCard({ post }: { post: Post }) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<"approved" | "rejected" | null>(null)

  function handleAprobar() {
    startTransition(async () => {
      await aprobarPost(post.id)
      setDone("approved")
    })
  }

  function handleRechazar() {
    startTransition(async () => {
      await rechazarPost(post.id, "Rechazado desde la UI")
      setDone("rejected")
    })
  }

  if (done === "approved") {
    return (
      <Card className="opacity-60">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-emerald-600">
          <CheckCircle className="h-4 w-4" />
          Post aprobado y programado
        </CardContent>
      </Card>
    )
  }
  if (done === "rejected") {
    return (
      <Card className="opacity-60">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-red-500">
          <XCircle className="h-4 w-4" />
          Post rechazado
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-0 md:flex-row">
        {/* Miniatura */}
        <div className="relative w-full shrink-0 bg-muted md:w-48">
          {post.thumbUrl ? (
            <Image
              src={post.thumbUrl}
              alt="preview"
              fill
              className="object-cover"
              sizes="192px"
            />
          ) : (
            <div className="flex h-48 items-center justify-center md:h-full">
              <span className="text-xs text-muted-foreground">Sin miniatura</span>
            </div>
          )}
          {/* Marca de agua de marca */}
          {post.brand && (
            <div
              className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: post.brand.color + "cc" }}
            >
              {post.brand.name}
            </div>
          )}
        </div>

        {/* Contenido */}
        <div className="flex flex-1 flex-col p-4">
          {/* Meta */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1 text-xs">
              <PlatformIcon platform={post.platform} />
              {post.platform === "instagram" ? "Instagram" : "Facebook"}
            </Badge>
            <Badge variant="secondary" className="text-xs capitalize">{post.post_type}</Badge>
            {post.scheduled_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(post.scheduled_at).toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {post.submittedBy && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {post.submittedBy}
              </span>
            )}
          </div>

          {/* Caption */}
          <p className="flex-1 whitespace-pre-wrap text-sm leading-relaxed">{post.caption}</p>
          {post.hashtags && (
            <p className="mt-1 text-xs text-muted-foreground">{post.hashtags}</p>
          )}

          {/* Acciones */}
          <div className="mt-4 flex items-center gap-2 border-t pt-3">
            <Button
              size="sm"
              className="gap-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={handleAprobar}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Aprobar y programar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-red-500 hover:bg-red-50 hover:text-red-600"
              onClick={handleRechazar}
              disabled={pending}
            >
              <XCircle className="h-3.5 w-3.5" />
              Rechazar
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(post.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function ListaAprobaciones({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center">
        <CheckCircle className="h-10 w-10 text-emerald-500/40" />
        <div>
          <p className="font-medium text-muted-foreground">Todo al día</p>
          <p className="mt-1 text-sm text-muted-foreground">No hay posts esperando aprobación.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  )
}
