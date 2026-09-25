# HtzRoulette

Ruleta de sorteos que toma participantes automáticamente desde el chat de Twitch.

## Cómo funciona (MVP)

1. Abre la app.
2. Escribe el nombre del canal de Twitch (sin el `#`) y pulsa **Conectar**.
3. Los espectadores escriben `!join` en el chat para entrar al sorteo (el comando se puede cambiar en el campo "Comando para unirse").
4. Pulsa **Girar** para elegir un ganador al azar.
5. Pulsa **Reiniciar lista** para vaciar la lista de participantes y empezar de nuevo.

La conexión al chat es de solo lectura y anónima: no hace falta iniciar sesión ni token de Twitch para este MVP.

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
