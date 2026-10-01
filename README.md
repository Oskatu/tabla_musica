# Tabla Música 🎼

Estudio de composición que funciona **entero en el navegador**: crea canciones, simula pistas de
instrumentos, mézclalas, mira la partitura y **convierte un tarareo en notas**.

No hay servidor, ni cuentas, ni samples: todo el audio se sintetiza con la Web Audio API.

![pestañas](https://img.shields.io/badge/pestañas-Componer%20·%20Mezclar%20·%20Partitura%20·%20Tarareo-5b8cff)

---

## Qué puedes hacer

### 🎹 Componer (editor de piano roll)
- Editor de rejilla con eje vertical = altura y horizontal = tiempo; zoom, rejilla de cuantización y
  duraciones de figura (redonda → semicorchea).
- Herramientas: **dibujar**, **seleccionar** (con marco múltiple) y **borrar**. Arrastra para mover,
  tira del borde derecho para alargar, clic derecho para borrar.
- **Batería** con una fila por pieza (bombo, caja, charles, toms, platos) en lugar de un teclado.
- **Teclado tocable** (ratón o teclas `A S D F G H J K` / `W E T Y U`), con opción de escribir lo que
  tocas directamente en la pista.
- **Generador musical**: progresiones de acordes, acompañamientos (bloque, arpegio, síncopa…),
  líneas de bajo (fundamentales, corcheas, caminante, octavas), grooves de batería (rock, pop, funk,
  balada, shuffle, dance, latino), melodías y **«generar canción completa»** de 4 pistas.
- 13 instrumentos simulados: piano, piano eléctrico, órgano, marimba, guitarra, cuerdas, bajo, pad,
  sintetizador, metales, flauta, campanas y batería.

### 🎚️ Mezclar
- Fader de volumen, paneo y **EQ de 3 bandas** por pista, con medidores de nivel reales.
- Canal **Master** con reverberación (convolución con impulso sintetizado), eco con realimentación y
  compresor.
- Silenciar (M) / solo (S) y cambios audibles al instante mientras suena.

### 🎼 Partitura
- Notación estándar dibujada con **VexFlow**: claves, armadura, compás, figuras, puntillos, silencios,
  barras de corcheas y ligaduras.
- Las duraciones irregulares se reparten en figuras estándar y se ligan cuando es necesario.
- Exporta **MusicXML** (MuseScore, Finale, Sibelius, Dorico…), **SVG**, **PNG** e **imprimir**.

### 🎤 Tarareo → partitura
- Graba con el micrófono o **sube un archivo de audio** (por si el navegador bloquea el micro).
- Detección de altura por **autocorrelación (MDF/YIN)** con corrección de octava, filtro de mediana y
  segmentación por semitono con histéresis.
- Estimación de **tempo** (peineta rítmica) y de **tonalidad** (perfil de Krumhansl-Schmuckler).
- Cuantización a negra/corchea/semicorchea/fusa, ajuste opcional a la escala, transporte de octava y
  escritura directa en una pista (nueva, añadiendo o reemplazando).

### Además
- Guardado automático en el navegador (varias canciones), `Guardar como…`, export/import
  `.tabla.json`, deshacer/rehacer con historial, bucle, metrónomo, afinador en vivo y **exportación a
  WAV** (render offline, con o sin metrónomo).
- Atajos: `Espacio` play/pausa, `Ctrl+Z` / `Ctrl+Y`, `1`/`2`/`3` herramientas, `Ctrl+A` seleccionar
  todo, `Supr` borrar, `L` bucle, `Ctrl+rueda` zoom.

---

## Cómo se usa

```bash
npm install
npm run dev        # servidor de desarrollo (http://localhost:5173)
npm run build      # compila a dist/
npm run preview    # sirve la versión compilada
```

Abre la URL, pulsa ☰ **Proyecto → Cargar canción de ejemplo** y dale a reproducir. Para el tarareo,
concede permiso al micrófono (o sube un archivo de audio).

## Estructura

```
src/
  audio/
    instruments.ts   # síntesis de cada instrumento (osciladores, ruido, filtros, envolventes)
    engine.ts        # grafo maestro, mezcla, reproducción, render offline y export WAV
    playback.ts      # transporte (reloj compartido con la interfaz)
    transcribe.ts    # detección de altura, segmentación, tempo y tonalidad
  lib/
    theory.ts        # notas, escalas, acordes diatónicos, detección de tonalidad
    durations.ts     # ticks ⇄ figuras musicales
    score.ts         # notas del editor → eventos de partitura (con silencios y ligaduras)
    renderScore.ts   # dibujo con VexFlow
    musicxml.ts      # exportación MusicXML
    generate.ts      # generador de progresiones, bajos, baterías y melodías
  state/
    store.ts         # estado global (Zustand) + persistencia local
  components/        # TopBar, PianoRoll, Mixer, ScoreView, RecorderPanel, GeneratorPanel…
```

## Notas técnicas

- **Tiempo musical en *ticks***: 480 por negra (PPQ). Toda la app usa la misma unidad.
- **Instrumentos sintetizados**: modelado aditivo del piano, FM tipo Rhodes, Karplus-Strong para la
  guitarra, restas con filtro resonante para el sintetizador, parciales inarmónicos para campanas y
  ruido filtrado para la batería. Sin ficheros de audio.
- **Latencia y precisión**: la reproducción programa las notas por adelantado (look-ahead) y el
  playhead visual se calcula con un reloj compartido (`performance.now()`), no con el audio.
- **Reverb** por convolución con una respuesta de impulso generada por síntesis.
- **Sin servidor**: la partitura se dibuja en el cliente y el WAV se renderiza con
  `OfflineAudioContext` (más rápido que el tiempo real).
- **Privacidad**: nada sale del navegador. Las grabaciones se procesan en memoria y no se suben.

### Limitaciones conocidas
- La transcripción es **monofónica**: funciona con una voz, un silbido o un instrumento de una sola
  nota. Con acordes o ruido de fondo la detección empeora.
- En condiciones normales la transcripción acierta las notas pero no siempre el tempo exacto: si no
  cuadra, prueba otro tempo de la lista o cuantiza a otra rejilla.
- Cada pista es **una sola voz** en la partitura: si dos notas se solapan, la primera se acorta al
  inicio de la siguiente (la notación polifónica queda fuera del alcance de esta versión).

## Pruebas

```bash
npm test          # 123 comprobaciones en Node (no hace falta navegador)
npm run test:types  # comprobación de tipos de src y tests
```

Usa `jsdom` y dobles de las APIs de audio, así que se prueba el motor, la transcripción, la notación
y la interfaz sin abrir un navegador:

- **Duraciones y notación**: `splitDuration` reconstruye exactamente cualquier duración; cada compás
  queda cubierto al 100 % sin solapes, con ligaduras donde toca.
- **Teoría**: acordes, grados diatónicos (la séptima del V grado de Do mayor es Fa, no Fa#) y
  detección de tonalidad.
- **Generador**: los 6 estilos de acompañamiento, los 5 de bajo y los 8 de batería; todo dentro de la
  escala y de los registros reales de cada instrumento; mismo resultado con la misma semilla.
- **Transcripción**: melodías sintéticas con vibrato, armónicos y ruido — veloces, cromáticas, con
  saltos de octava, registro grave, silbido agudo y a 48 kHz; con silencio no inventa notas.
- **Partitura**: SVG válido con varias pistas y casos límite (proyecto vacío, sin pistas, ancho
  insuficiente).
- **Audio**: render offline con los 13 instrumentos y cabecera WAV correcta (PCM 16 bits estéreo
  44,1 kHz).
- **Interfaz**: se monta la aplicación en jsdom y se recorren las cuatro pestañas, se dibuja una nota
  con el ratón, se arranca el transporte, se genera una canción, se deshace y se rehace y se guardan
  proyectos.

---

Hecho con [Vite](https://vitejs.dev), [React](https://react.dev), [VexFlow](https://www.vexflow.com)
y [Zustand](https://zustand-demo.pmnd.rs). Sin dependencias de audio: solo Web Audio API.
