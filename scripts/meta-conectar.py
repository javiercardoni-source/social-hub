#!/usr/bin/env python3
"""Convierte un token corto del Explorador de Graph API en tokens de página que no vencen.

Se vuelve a correr si cambia la contraseña de Facebook o se revocan permisos.
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

APP_ID = "1421040926022791"
GRAPH = "https://graph.facebook.com"
DESTINO = os.path.expanduser("~/Documents/Sistema Kitchco/.credentials/meta-social-hub.json")


def graph(path, **params):
    url = f"{GRAPH}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detalle = json.load(e).get("error", {})
        sys.exit(f"\n✗ Meta respondió error: {detalle.get('message', e)}")


def main():
    previo = {}
    if os.path.exists(DESTINO):
        with open(DESTINO) as f:
            previo = json.load(f)

    secret = previo.get("app_secret", "")
    if not secret or secret == "PEGAR_ACA":
        secret = getpass.getpass("Clave secreta de la app (no se ve al pegar): ").strip()
    corto = getpass.getpass("Token del Explorador, EAA... (no se ve al pegar): ").strip()
    if not secret or not corto.startswith("EAA"):
        sys.exit("✗ Falta la clave secreta o el token no empieza con EAA")

    print("\n→ Convirtiendo a token largo…")
    largo = graph(
        "oauth/access_token",
        grant_type="fb_exchange_token",
        client_id=APP_ID,
        client_secret=secret,
        fb_exchange_token=corto,
    )["access_token"]

    print("→ Buscando páginas e Instagram…")
    cuentas = graph(
        "me/accounts",
        access_token=largo,
        fields="id,name,access_token,instagram_business_account{id,username}",
        limit=50,
    ).get("data", [])
    if not cuentas:
        sys.exit("✗ El token no ve ninguna página. Regeneralo eligiendo las 4 páginas en la ventana de Facebook.")

    app_token = f"{APP_ID}|{secret}"
    paginas = []
    print()
    for c in cuentas:
        info = graph("debug_token", input_token=c["access_token"], access_token=app_token)["data"]
        vence = "nunca" if info.get("expires_at", 0) == 0 else datetime.fromtimestamp(info["expires_at"]).strftime("%d-%m-%Y")
        ig = c.get("instagram_business_account") or {}
        paginas.append({
            "name": c["name"],
            "page_id": c["id"],
            "page_token": c["access_token"],
            "ig_id": ig.get("id"),
            "ig_username": ig.get("username"),
            "scopes": info.get("scopes", []),
        })
        ig_txt = f"IG @{ig['username']}" if ig else "⚠ sin Instagram vinculado"
        print(f"  ✓ {c['name']:<32} FB {c['id']}  ·  {ig_txt}  ·  vence: {vence}")

    faltan = {"pages_manage_posts", "instagram_content_publish"} - set(paginas[0]["scopes"])
    if faltan:
        print(f"\n⚠ Faltan permisos para publicar: {', '.join(sorted(faltan))}")

    with open(DESTINO, "w") as f:
        json.dump({
            "app_id": APP_ID,
            "app_secret": secret,
            "long_user_token": largo,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pages": paginas,
        }, f, indent=2, ensure_ascii=False)
    os.chmod(DESTINO, 0o600)
    print(f"\n✓ Guardado en {DESTINO}\n  Avisale a Daniela que ya está.")


if __name__ == "__main__":
    main()
