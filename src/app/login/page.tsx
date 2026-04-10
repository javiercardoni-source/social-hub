import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Zap } from "lucide-react"
import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Social Hub</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  )
}
