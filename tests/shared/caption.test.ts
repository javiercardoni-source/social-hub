import { describe, expect, it } from "vitest"
import { fullCaption, sameCaption } from "../../shared/cos/caption"

describe("fullCaption", () => {
  it("separa caption y hashtags con una línea en blanco", () => {
    expect(fullCaption("Tres onigiris 🍙", "#fasutofudo #onigiri")).toBe("Tres onigiris 🍙\n\n#fasutofudo #onigiri")
  })
  it("sin hashtags queda solo el caption", () => {
    expect(fullCaption("  Hola  \r\n", "   ")).toBe("Hola")
  })
  it("normaliza espacios entre hashtags", () => {
    expect(fullCaption("x", " #a   #b\n#c ")).toBe("x\n\n#a #b #c")
  })
})

describe("sameCaption", () => {
  it("ignora diferencias de espacios y saltos que mete Meta", () => {
    expect(sameCaption("Hola\n\n#a #b", "Hola #a  #b ")).toBe(true)
  })
  it("distingue textos distintos", () => {
    expect(sameCaption("Hola #a", "Hola #b")).toBe(false)
    expect(sameCaption(null, "Hola")).toBe(false)
  })
})
