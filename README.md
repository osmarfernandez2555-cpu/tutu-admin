# Tutu Admin — Panel de Adrián

Panel con acceso a todas las apps de Tutu Automotores y un asistente de texto y voz.

## Subirlo a Railway

1. Creá el repo `tutu-admin` en GitHub y subí todo (menos `node_modules`).
2. Railway → **New Project** → **Deploy from GitHub repo** → `tutu-admin`.
3. **Variables** del servicio:
   - `ADMIN_PASS` → la contraseña que va a usar Adrián (obligatoria)
   - `ANTHROPIC_API_KEY` → la key de Anthropic (para el asistente)
   - `REFERIDOS_PANEL_PASS` → la misma contraseña del panel de referidos (para que el asistente lea los referidos)
   - Opcional: `ANTHROPIC_MODEL` (por defecto `claude-sonnet-5-5`)
4. **Settings → Networking → Generate Domain**.
5. Revisá `https://<dominio>/salud`: tiene que dar `"admin_pass":true,"ia":true,"referidos":true`.

## Cargar los links que faltan

Las apps sin link aparecen punteadas con el nombre de la variable. Agregala en Railway → Variables y redeploy:

- Por ahora todas las apps tienen link.

También se puede cambiar cualquier link existente igual (ej. `URL_RUTHINA`), o editar `apps.json` para sumar apps nuevas.

## Si algo falla

- **"Falta configurar ADMIN_PASS"** al entrar → falta la variable del paso 3.
- **El asistente dice "Falta ANTHROPIC_API_KEY"** → falta la key.
- **"El club de referidos respondió 401"** → `REFERIDOS_PANEL_PASS` no coincide con la del panel de referidos.
- **El micrófono no anda** → usar Chrome o Edge y permitir el micrófono (el sitio tiene que estar en https, Railway ya lo da).
- **La app no se abre sola** → el navegador bloqueó la ventana emergente; aparece un botón en el chat para abrirla, o permití ventanas emergentes para el dominio.
