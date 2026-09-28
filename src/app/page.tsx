import { redirect } from "next/navigation"

// Redirige permanentemente al dashboard — sin pasar por el cliente
export default function Home() {
  redirect("/inicio")
}

export const dynamic = "force-dynamic"
