#!/usr/bin/env python3
"""Autoriza Content OS en Google Drive (una sola vez) y arma su carpeta propia.

Permisos: drive.file (escribe solo en lo suyo) + drive.readonly (lee la "base de fotos" de
cada marca, aunque la hayas subido a mano). Nunca mueve ni borra nada tuyo.
Se vuelve a correr si se revoca el acceso desde myaccount.google.com.
"""
import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone

CRED_DIR = os.path.expanduser("~/Documents/Sistema Kitchco/.credentials")
CLIENTE = os.path.join(CRED_DIR, "google-drive-oauth-client.json")
DESTINO = os.path.join(CRED_DIR, "google-drive-content-os.json")
CUENTA = "javiercardonibetti@gmail.com"
COMPARTIR_CON = "javiercardoni@gmail.com"
SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly"
PUERTO = 8765
MARCAS = ["fasutofudo", "bijutsukan", "sensaciones"]
ESTRUCTURA = ["00_BASE", "10_ORIGINALS", "20_GENERATED", "50_PUBLISHED_EXPORTS", "90_ARCHIVE", "_backups"]


def post(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"\n✗ Google respondió error: {e.read().decode()}")


def drive(method, path, token, body=None, **params):
    url = f"https://www.googleapis.com/drive/v3/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    if body is not None:
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"\n✗ Drive respondió error: {e.read().decode()}")


def carpeta(token, nombre, padre=None):
    q = f"name = '{nombre}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    q += f" and '{padre}' in parents" if padre else " and 'root' in parents"
    hay = drive("GET", "files", token, q=q, fields="files(id)").get("files", [])
    if hay:
        return hay[0]["id"]
    body = {"name": nombre, "mimeType": "application/vnd.google-apps.folder"}
    if padre:
        body["parents"] = [padre]
    return drive("POST", "files", token, body=body, fields="id")["id"]


def pedir_codigo(client_id):
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    estado = secrets.token_urlsafe(16)
    redirect = f"http://127.0.0.1:{PUERTO}"
    resultado = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == estado:
                resultado.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            ok = "code" in resultado
            self.wfile.write(("<h2>✓ Listo, ya podés cerrar esta pestaña.</h2>" if ok
                              else "<h2>✗ No se autorizó. Volvé a la terminal.</h2>").encode())

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", PUERTO), Handler)

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
        "login_hint": CUENTA, "state": estado,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    print(f"\n→ Se abre el navegador. Entrá con {CUENTA} y tocá Permitir.")
    print(f"  (Si no se abre, copiá este link en Chrome:)\n  {url}\n")
    webbrowser.open(url)
    server.timeout = 300
    while "code" not in resultado and "error" not in resultado:
        server.handle_request()
    if "error" in resultado:
        sys.exit(f"✗ Google devolvió: {resultado['error']}")
    return resultado["code"], verifier, redirect


def main():
    if not os.path.exists(CLIENTE):
        sys.exit(f"✗ Falta {CLIENTE}\n  Descargá el JSON del cliente OAuth y guardalo con ese nombre.")
    with open(CLIENTE) as f:
        c = json.load(f)
    c = c.get("installed") or c.get("web")

    code, verifier, redirect = pedir_codigo(c["client_id"])
    tok = post("https://oauth2.googleapis.com/token", {
        "client_id": c["client_id"], "client_secret": c["client_secret"], "code": code,
        "code_verifier": verifier, "grant_type": "authorization_code", "redirect_uri": redirect,
    })
    if "refresh_token" not in tok:
        sys.exit("✗ Google no devolvió la llave permanente. Revocá el acceso en myaccount.google.com y volvé a correrlo.")
    access = tok["access_token"]
    if "drive.readonly" not in tok.get("scope", ""):
        sys.exit("✗ Falta el permiso de ver los archivos de Drive (quedó destildado). Volvé a correrlo y dejá tildadas todas las casillas.")

    about = drive("GET", "about", access, fields="user(emailAddress),storageQuota")
    email = about["user"]["emailAddress"]
    if email != CUENTA:
        sys.exit(f"✗ Entraste con {email}, no con {CUENTA}. Volvé a correrlo con la cuenta correcta.")

    print("→ Armando la carpeta Content OS…")
    raiz = carpeta(access, "Content OS")
    ids = {"root": raiz}
    for sub in ESTRUCTURA:
        ids[sub] = carpeta(access, sub, raiz)
        if sub in ("00_BASE", "10_ORIGINALS", "20_GENERATED", "50_PUBLISHED_EXPORTS"):
            for m in MARCAS:
                ids[f"{sub}/{m}"] = carpeta(access, m, ids[sub])

    drive("POST", f"files/{raiz}/permissions", access,
          body={"type": "user", "role": "writer", "emailAddress": COMPARTIR_CON},
          sendNotificationEmail="false")

    with open(DESTINO, "w") as f:
        json.dump({
            "account": email,
            "client_id": c["client_id"],
            "client_secret": c["client_secret"],
            "refresh_token": tok["refresh_token"],
            "scope": SCOPE,
            "folders": ids,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }, f, indent=2)
    os.chmod(DESTINO, 0o600)

    q = about["storageQuota"]
    gb = lambda b: f"{int(b) / 1e9:.1f} GB"
    total = gb(q["limit"]) if "limit" in q else "ilimitado"
    print(f"\n✓ Conectado: {email}")
    print(f"  Espacio: {gb(q['usage'])} usados de {total}")
    print(f"  Carpeta: https://drive.google.com/drive/folders/{raiz}")
    print(f"  Marcas: {', '.join(MARCAS)}")
    print(f"  Compartida con {COMPARTIR_CON} (editor): la ves en «Compartido conmigo»")
    print(f"  Base de fotos por marca: Content OS/00_BASE/<marca> (o compartí tu carpeta con {CUENTA})")
    print(f"\n✓ Guardado en {DESTINO}\n  Avisale a Daniela que ya está.")


if __name__ == "__main__":
    main()
