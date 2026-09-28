import { ImageResponse } from "next/og"

export const size = { width: 512, height: 512 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ef4444", color: "#fff", fontSize: 250, fontWeight: 800, letterSpacing: -12 }}>
        SH
      </div>
    ),
    size,
  )
}
