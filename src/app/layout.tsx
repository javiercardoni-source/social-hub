import type { Metadata } from "next"
import { Bricolage_Grotesque, Figtree } from "next/font/google"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ErrorReportButton } from "@/components/error-report-button"
import "./globals.css"

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
})

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Social Hub",
  description: "Gestor de publicaciones para redes sociales",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      className={`${bricolage.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <ErrorReportButton />
      </body>
    </html>
  )
}
