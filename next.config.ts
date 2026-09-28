import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    // Miniaturas de cos-media: URLs firmadas del Supabase OlivosSpeed.
    remotePatterns: [
      { protocol: "https", hostname: "jhftgcjiymjcamjikuwe.supabase.co", pathname: "/storage/v1/object/sign/**" },
    ],
  },
}

export default nextConfig
