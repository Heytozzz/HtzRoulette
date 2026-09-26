# HtzRoulette

Ruleta de sorteos que toma participantes automáticamente desde el chat de Twitch.

## Cómo funciona (MVP)

1. Abre la app.
2. Escribe el nombre del canal de Twitch (sin el `#`) y pulsa **Conectar**.
3. Pulsa **Aceptar ingresos** para permitir que la gente entre con `!join` (o el comando que configures). Pulsa **Detener ingresos** para cerrar el sorteo y que ya nadie más pueda entrar.
4. Pulsa **Girar** para elegir un ganador al azar.
5. Pulsa **Reiniciar lista** para vaciar la lista de participantes y empezar de nuevo.

La conexión al chat es de solo lectura y anónima: no hace falta iniciar sesión ni token de Twitch para este MVP.

## Temas e imágenes personalizadas

Junto al `.exe` portable encontrarás una carpeta `themes/` (con un tema `ejemplo` ya creado). Puedes agregar tus propios temas así:

```
themes/
  mi_tema/
    bg/         <- imágenes de fondo para la app (se elige una al azar)
    roulette/   <- imágenes para la ruleta (se eligen al azar)
```

Formatos soportados: png, jpg, jpeg, gif, webp.

**Tamaños sugeridos:**
- Fondo (`bg/`): 1920x1080 (16:9), o al menos 1280x800.
- Ruleta en modo "Imagen por jugador" (`roulette/`): 256x256 o 512x512, cuadrada, PNG con transparencia si quieres que se recorte bien.
- Ruleta en modo "Imagen completa" (`roulette/`): 1000x1000 o 1200x1200, cuadrada (se recorta a círculo).

Selecciona el tema y el modo de imagen de la ruleta desde el botón de engranaje (⚙) → Aspecto.

## Versión web (sin descargar nada)

Además del `.exe` de escritorio, el repo incluye una versión 100% web en la carpeta `web/` — corre en cualquier navegador, sin instalar nada, y se conecta al chat de Twitch directo desde el navegador (usando `tmi.js` vía WebSocket).

**Configuración única (una sola vez):** en GitHub, ve a `Settings` → `Pages` → en "Build and deployment" → "Source" elige **GitHub Actions**. Después de eso, cada push a `main` que toque la carpeta `web/` la publica automáticamente en `https://heytozzz.github.io/HtzRoulette/`.

Diferencias con la versión de escritorio:
- No hay carpeta `themes/` en disco: los temas (fondo + imágenes de la ruleta) se crean y se guardan directamente desde la app, en el propio navegador (IndexedDB). No se suben a ningún servidor y solo están disponibles en ese navegador/dispositivo.
- Todo lo demás (modos de ruleta, sub bonus, exportar/importar, paletas, aceptar/detener ingresos) funciona igual que en la app de escritorio.

## Descargar la app

No hace falta instalar Node.js ni Electron en tu PC. Cada vez que se sube un cambio a la rama `main`, GitHub Actions compila automáticamente un `.exe` portable para Windows.

1. Ve a la pestaña **Actions** del repositorio.
2. Entra al workflow más reciente ("Build portable exe") que haya terminado en verde.
3. Descarga el artifact `HtzRoulette-portable`, descomprímelo y ejecuta el `.exe`. No requiere instalación.

## Desarrollo (opcional, solo si quieres correrlo localmente)

```
npm install
npm start
```

## Próximas funcionalidades (roadmap)

- Selección de idioma en ajustes.
- Historial de ganadores.
- Exclusión automática de ganadores anteriores.
- Personalización de colores/sonidos de la ruleta.
- Comandos adicionales (ej. salir del sorteo con `!leave`).
