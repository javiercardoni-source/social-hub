"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { prepararSubida, registrarSubida } from "@/lib/cos/upload-actions"
import { CheckCircle2, ImagePlus, Loader2 } from "lucide-react"

type Brand = { slug: string; name: string; color: string }
const MIN = 15

export function SubirClient({ brands, defaultSlug }: { brands: Brand[]; defaultSlug: string }) {
  const [brand, setBrand] = useState(brands.find((b) => b.slug === defaultSlug)?.slug ?? brands[0]?.slug ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [description, setDescription] = useState("")
  const [step, setStep] = useState<"idle" | "subiendo" | "listo">("idle")
  const [error, setError] = useState<string | null>(null)

  const ready = !!file && !!brand && description.trim().length >= MIN && step === "idle"

  function pick(f: File | null) {
    setFile(f)
    setError(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function enviar() {
    if (!file) return
    setStep("subiendo")
    setError(null)
    try {
      // Algunos celulares no informan el tipo (fotos HEIC del iPhone, por ejemplo): se deduce de la extensión.
      const EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic", mp4: "video/mp4", mov: "video/quicktime" }
      const mime = file.type || EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream"
      const prep = await prepararSubida({ brandSlug: brand, mime, size: file.size })
      if ("error" in prep) throw new Error(prep.error)

      const { error: upErr } = await createClient().storage.from("cos-media").uploadToSignedUrl(prep.key, prep.token, file, {
        contentType: mime,
      })
      if (upErr) throw new Error(`No se pudo subir el archivo: ${upErr.message}`)

      const reg = await registrarSubida({ brandSlug: brand, key: prep.key, mime, size: file.size, description })
      if ("error" in reg) throw new Error(reg.error)
      setStep("listo")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep("idle")
    }
  }

  if (step === "listo") {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <h2 className="text-xl font-bold">¡Recibido!</h2>
          <p className="text-sm text-muted-foreground">
            Ahora se procesa, se guarda en Drive y la IA escribe el post. En uno o dos minutos te aparece en
            Aprobaciones.
          </p>
          <div className="mt-2 flex gap-2">
            <Button asChild variant="outline">
              <Link href="/media">Ver biblioteca</Link>
            </Button>
            <Button asChild>
              <Link href="/aprobaciones">Ir a Aprobaciones</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const left = MIN - description.trim().length
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="space-y-5 p-6">
        <label className="relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed bg-muted/40 text-muted-foreground transition-colors hover:border-primary/60">
          {preview && file?.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : preview ? (
            <video src={preview} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
          ) : (
            <>
              <ImagePlus className="h-10 w-10" />
              <span className="text-sm font-medium">Sacá una foto o elegí de la galería</span>
              <span className="text-xs">Fotos o videos, hasta 500 MB</span>
            </>
          )}
          <input
            type="file"
            accept="image/*,video/mp4,video/quicktime"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="space-y-2">
          <Label htmlFor="desc">
            ¿Qué es? <span className="text-primary">*</span>
          </Label>
          <textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Ej: Caja con los 3 onigiris recién armados, salieron impecables los de salmón"
            className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <p className="text-xs text-muted-foreground">
            {left > 0 ? `Faltan ${left} caracteres. Contá qué es, de qué marca y si hay algo especial hoy.` : "✓ Con esto la IA ya puede escribir el post"}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Marca</Label>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <button
                key={b.slug}
                type="button"
                onClick={() => setBrand(b.slug)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  brand === b.slug ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <Button className="w-full py-6 text-base font-bold" disabled={!ready} onClick={enviar}>
          {step === "subiendo" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Subiendo…
            </>
          ) : (
            "Enviar"
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
