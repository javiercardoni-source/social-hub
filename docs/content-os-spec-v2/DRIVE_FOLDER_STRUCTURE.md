# ESTRUCTURA DE GOOGLE DRIVE

Carpeta raíz sugerida:

Content OS/
├── 00_INBOX/
│   ├── EMPLOYEES/
│   ├── MANUAL_UPLOADS/
│   └── IMPORTED/
├── 10_ORIGINALS/
│   ├── photos/
│   └── videos/
├── 20_GENERATED/
│   ├── instagram/
│   ├── facebook/
│   └── tiktok/
├── 30_PREVIEWS/
├── 40_APPROVED/
├── 50_PUBLISHED_EXPORTS/
├── 90_ARCHIVE/
└── metadata/

## Reglas
- No usar carpetas como sustituto de estados DB.
- Los estados viven en SQLite.
- Las carpetas solo organizan storage.
- Un asset puede cambiar de estado sin moverse.
- Mantener drive_file_id y parent folder id.
