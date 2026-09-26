"use client"

import { useTransition, useState } from "react"
import Image from "next/image"
import { crearPost } from "@/lib/cos/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Send, Loader2, Image as ImageIcon, Wand2 } from "lucide-react"
import { PlatformIcon } from "@/components/ui/platform-icon"

type Account = {
  id: string
  platform: string
  display_name: string
  status: string
}

type Asset = {
  id: string
  description: string | null
  media_type: string | null
  quality_score: number | null
  thumbUrl: string | null
  brand: { name: string; color: string } | null
  ai_json: {
    summary?: string
    category?: string
    mood?: string
    suggested_formats?: string[]
    missing_context?: string
  } | null
}

export function ComposerClient({
  asset,
  accounts,
}: {
  asset: Asset
  accounts: Account[]
}) {
  const [pending, startTransition] = useTransition()
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(
    accounts.find((a) => a.status === "connected") ?? accounts[0] ?? null
  )
  const [postType, setPostType] = useState("feed")
  const [caption, setCaption] = useState("")
  const [hashtags, setHashtags] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")

  const aiSuggestion = asset.ai_json?.summary ?? ""

  function handleUseSuggestion() {
    if (aiSuggestion) setCaption(aiSuggestion)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) return
    const fd = new FormData()
    fd.append("asset_id", asset.id)
    fd.append("account_id", selectedAccount.id)
    fd.append("platform", selectedAccount.platform)
    fd.append("post_type", postType)
    fd.append("caption", caption)
    fd.append("hashtags", hashtags)
    fd.append("scheduled_at", scheduledAt || "")
    startTransition(() => crearPost(fd))
  }

  const postTypes =
    selectedAccount?.platform === "instagram"
      ? ["feed", "reel", "story", "carousel"]
      : ["feed", "story", "carousel"]

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_380px]">
        {/* Columna principal */}
        <div className="space-y-5">
          {/* Preview del asset */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Archivo seleccionado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {asset.thumbUrl ? (
                    <Image src={asset.thumbUrl} alt="asset" fill className="object-cover" sizes="96px" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {asset.brand && (
                    <div className="mb-1 flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: asset.brand.color }} />
                      <span className="text-xs text-muted-foreground">{asset.brand.name}</span>
                    </div>
                  )}
                  <p className="text-sm leading-relaxed text-foreground line-clamp-3">
                    {asset.description ?? <span className="italic text-muted-foreground">Sin descripción</span>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {asset.ai_json?.category && (
                      <Badge variant="secondary" className="text-xs">{asset.ai_json.category}</Badge>
                    )}
                    {asset.ai_json?.mood && (
                      <Badge variant="outline" className="text-xs">{asset.ai_json.mood}</Badge>
                    )}
                    {asset.quality_score != null && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${asset.quality_score >= 70 ? "border-emerald-300 text-emerald-700" : asset.quality_score >= 45 ? "border-amber-300 text-amber-700" : "border-red-300 text-red-600"}`}
                      >
                        Calidad {asset.quality_score}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Caption */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Caption</CardTitle>
                {aiSuggestion && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={handleUseSuggestion}
                  >
                    <Wand2 className="h-3 w-3" />
                    Usar sugerencia de IA
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {aiSuggestion && (
                <div className="rounded-md bg-violet-50 p-3 text-xs text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                  <p className="mb-1 font-medium">Sugerencia de Claude:</p>
                  <p className="leading-relaxed">{aiSuggestion}</p>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="caption" className="text-xs text-muted-foreground">
                  Texto del post
                </Label>
                <textarea
                  id="caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escribí el texto del post…"
                  className="min-h-[120px] w-full resize-none rounded-md border bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  required
                />
                <p className="text-right text-xs text-muted-foreground">{caption.length} / 2200</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="hashtags" className="text-xs text-muted-foreground">
                  Hashtags (opcional)
                </Label>
                <Input
                  id="hashtags"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="#onigiri #japonés #delivery"
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna lateral */}
        <div className="space-y-4">
          {/* Cuenta */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Publicar en</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay cuentas conectadas para esta marca.</p>
              ) : (
                accounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setSelectedAccount(account)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedAccount?.id === account.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-muted-foreground/20 hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white ${
                        account.platform === "instagram" ? "bg-pink-500" : "bg-blue-600"
                      }`}
                    >
                      <PlatformIcon platform={account.platform} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.display_name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{account.platform}</p>
                    </div>
                    {account.status !== "connected" && (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600">
                        {account.status}
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Tipo */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Tipo de post</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {postTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPostType(type)}
                    className={`rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                      postType === type
                        ? "border-primary bg-primary/5 font-medium text-primary"
                        : "hover:border-muted-foreground/20 hover:bg-muted/50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Programar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Programar</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="text-sm"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Si no ponés fecha, el post queda sin programar y podés hacerlo después.
              </p>
            </CardContent>
          </Card>

          <Separator />

          <Button
            type="submit"
            className="w-full gap-2"
            disabled={pending || !selectedAccount || caption.trim().length === 0}
            size="lg"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Enviar a revisión
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Va a la cola de aprobaciones. Vos lo aprobás antes de publicar.
          </p>
        </div>
      </div>
    </form>
  )
}
