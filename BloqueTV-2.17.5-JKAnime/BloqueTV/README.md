# BloqueTV 2.17.5 · JKAnime

Integración del catálogo de JKAnime sobre **BloqueTV 2.17.5 · Seasons · Episodios Fix 2**, la versión elegida. Se conservan el logo, las hojas de estilo, la navegación, las descargas y los selectores existentes de idioma y temporada. TMDb sigue desconectado.

## Catálogo de Anime

- **Anime → Catálogo completo** permite recorrer todas las páginas del directorio. Sus totales se actualizan desde la fuente; no hay un límite fijo de títulos ni de páginas. Incluye series, películas, OVA y especiales.
- Las colecciones **Más populares** y **Últimos agregados** usan las tarjetas y los carruseles de BloqueTV.
- Puedes buscar desde el catálogo o desde el buscador general. Las búsquedas muestran las coincidencias que devuelve la fuente; si una búsqueda amplia devuelve muchos títulos, usa un nombre más específico.
- Las fichas muestran el nombre completo, portada, descripción, estado, formato, idioma y capítulos disponibles.
- Los episodios se consultan por anime y por página. El buscador de capítulos busca el número en la serie completa, incluso cuando está fuera de la página visible.
- Los botones « y » llevan a la primera y a la última página. Las flechas recorren las páginas intermedias.
- Al abrir un capítulo se comprueba que existe en la lista de ese anime antes de obtener sus servidores. Los enlaces de recomendaciones no se incorporan como episodios.
- Las temporadas publicadas como títulos propios conservan su nombre. No se asignan secuelas o especiales a una temporada por semejanza de nombre. Los menús de idioma y temporada de las fichas anteriores siguen funcionando.
- Si falla una consulta, la web muestra un mensaje y permite reintentar. Una ficha sin capítulos publicados se mantiene en el catálogo sin fabricar episodios.

La integración está activada por defecto y necesita conexión a Internet. Se puede desactivar con `JKANIME_ENABLED=false` en `.env`. El catálogo usa una caché temporal de diez minutos y solicita sus páginas al navegar; no descarga miles de videos ni requiere un proceso de importación inicial.

La revisión **Episodios Fix 2** permanece: los capítulos 54, 159 y 212 solo aparecen en las obras a las que pertenecen. Se conservan la configuración `.env` y los catálogos del ZIP original.

## Cómo abrirla en Windows

1. Detén la versión anterior con **Ctrl + C** en su terminal.
2. Extrae el ZIP completo en una carpeta. No ejecutes archivos desde dentro del ZIP.
3. Entra en **BloqueTV**, la carpeta que contiene `package.json` y `server.mjs`.
4. Abre PowerShell en esa carpeta y ejecuta:

```powershell
npm.cmd start
```

5. Comprueba que la terminal muestre **BloqueTV 2.17.5 · Seasons · Episodios Fix 2**. Abre **http://localhost:4173**. Mantén la terminal abierta mientras usas la web y mientras se descarga un archivo.
6. Si aparece el diseño anterior, recarga con **Ctrl + F5**.

Requiere Node.js 20.11 o superior y un navegador moderno. No necesita `npm install` para ejecutarse. El reproductor HLS viene incluido en `public/vendor` con su licencia.

Se conservan las claves de almacenamiento de la versión anterior: favoritos, historial, fuentes personales y descargas. Para recuperarlos, usa el mismo navegador y la misma dirección/puerto. La configuración `.env` y los catálogos del ZIP original se conservan.

## Mejoras de manejo

- Portada utilizable sin TMDb, con accesos a categorías, favoritos y reproducción pendiente.
- Menú móvil desplegable con todas las secciones y barra inferior de accesos rápidos.
- Atrás y Adelante, historial de navegación y recuperación de la ficha al recargar la pestaña.
- Buscador con cancelación de solicitudes anteriores para evitar resultados fuera de orden.
- Filtro de capítulos por número o nombre en listas largas.
- Tarjetas utilizables con teclado, foco visible, cierre con Escape y respeto a la preferencia de movimiento reducido.
- Guardado de la posición de reproducción en videos del reproductor nativo. Los reproductores externos incrustados controlan su propia posición.
- Navegación centrada en el catálogo y reproductor con selección de servidores dentro de BloqueTV.
- Encabezados y textos del catálogo sin menciones promocionales a páginas externas.
- Estado de conexión real con BloqueTV, sin presentar TMDb desactivado como una caída del servidor.

## Descargar un video

**Desde un episodio o película:** abre el reproductor, selecciona un servidor y pulsa **Descargar**. BloqueTV comprobará la fuente y mostrará el nombre, formato y tamaño cuando esté disponible. Pulsa **Iniciar descarga en el navegador**.

**Desde un enlace:** entra en **Descargas**, pega el enlace y pulsa **Preparar descarga**.

**Destino:** el archivo se envía al gestor de descargas del navegador que estés usando. La ubicación depende de sus ajustes. En Windows, **Ctrl + J** abre el panel de descargas de Chrome, Edge o Firefox. En móvil, usa la opción Descargas de su menú.

El centro de BloqueTV muestra bytes transferidos, velocidad media, progreso cuando se conoce el tamaño, fragmentos HLS, cancelación, reintento y registro local. Puedes cambiar de sección sin cancelar la transferencia. Limpiar el historial de BloqueTV no borra los archivos del dispositivo.

**“Transferido al navegador”** significa que el servidor entregó los datos. Confirma el guardado final en el panel de tu navegador. Una web normal no puede leer ese panel, elegir silenciosamente una carpeta ni controlar las descargas de otras pestañas.

Si el navegador no inicia la descarga, revisa sus permisos de descarga para esta página y pulsa Reintentar. Para cancelar desde BloqueTV, mantén una pestaña de BloqueTV abierta. La pausa y reanudación, si la fuente las admite, se manejan desde el navegador.

## Compatibilidad y límites

- Videos y audio directos identificados por su tipo de contenido; MP4, WebM y otros contenedores compatibles con la fuente.
- HLS de video completo y sin cifrado: segmentos MPEG-TS (`.ts`) o fMP4 con una cabecera de inicialización (`.mp4`). BloqueTV elige la variante con mayor ancho de banda anunciado. No recodifica el video.
- Se rechazan antes de iniciar: HLS en directo, cifrado, audio separado, discontinuidades o fragmentos por rangos. Esas variantes requieren conversión adicional. Usa otro servidor o un MP4 directo.
- Una página de error o desafío HTML no se entrega como un supuesto video.
- Algunos proveedores necesitan cookies, inicio de sesión, JavaScript o enlaces temporales. El análisis no garantiza extraer todos sus videos. Usa otro servidor si el seleccionado no ofrece descarga directa.
- No se descarga contenido DRM ni se incorporan mecanismos para saltar restricciones del proveedor.
- Los favoritos e historiales pertenecen a cada navegador. Las sesiones de transferencia duran hasta 24 horas en memoria y terminan al apagar/reiniciar el servidor. Reintentar prepara una sesión nueva.
- Hasta cuatro transferencias simultáneas. La velocidad depende del proveedor y de tu conexión.
- Anime dispone de su nuevo catálogo independiente de TMDb. Las colecciones generales de Series y Películas siguen dependiendo de su configuración anterior.

## Comprobaciones incluidas

```powershell
npm.cmd run check
npm.cmd test
```

Las pruebas incluidas usan respuestas controladas y videos de prueba, sin depender de páginas externas. Ver `REVISION.md` para el alcance y las limitaciones de la verificación.

## Estructura

- `server.mjs`: servidor, catálogos y análisis de fuentes.
- `lib/jkanime.mjs`: catálogo, búsqueda, fichas, episodios y servidores de la nueva integración.
- `lib/remote.mjs`: conexiones públicas, validación de destinos y redirecciones.
- `lib/downloads.mjs`: preparación, transferencia, progreso y cancelación.
- `lib/donghua-pages.mjs`: lectura de fichas, temporadas y episodios del catálogo.
- `public/app.js`: navegación, búsqueda, fichas y reproducción.
- `public/downloads.js`: centro y diálogo de descargas.
- `public/display-text.js`: limpieza del texto visible del catálogo.
- `public/episode-identity.js`: validación compartida de series, temporadas, episodios y contadores.
- `public/experience.css`: estilos de esta edición.
- `tests/`: pruebas reproducibles con Node.js.

## Selector de idiomas en episodios (2.17.3 Experience)

En las fichas de anime compatibles, BloqueTV detecta las variantes disponibles del mismo título por idioma y muestra un botón **Idiomas** junto al buscador de capítulos. Solo aparecen variantes que realmente tienen episodios: Español latino, Castellano y/o Sub español. Al cambiar de idioma se sustituye la lista de capítulos y su contador sin mezclar servidores entre variantes. Si solo existe un idioma, el menú muestra únicamente ese idioma.



## Vistas unificadas de anime (2.17.4 Experience)

- Las variantes por idioma ya no aparecen como fichas separadas en los resultados de Anime.
- `Naruto Latino`, `Naruto Castellano` y `Naruto Sub Español` se agrupan en una sola ficha: `Naruto`.
- `Naruto Shippuden` permanece como una obra independiente de `Naruto`.
- La ficha abre una variante disponible y el botón **Idiomas** cambia la lista de capítulos sin crear otra vista.
- Si una búsqueda especifica un idioma (`Naruto castellano`, por ejemplo), BloqueTV abre esa variante cuando está disponible, pero sigue mostrando una sola ficha titulada `Naruto`.
- Favoritos antiguos con variantes repetidas se muestran como una sola obra.


## Temporadas unificadas de anime (2.17.5 Experience)

- Las fichas que representan temporadas de la misma obra se agrupan en una sola vista.
- Junto al botón **Idiomas** aparece **Temporadas**.
- El menú de temporadas muestra únicamente temporadas detectadas para esa obra y, cuando se conoce, su cantidad de capítulos.
- Al cambiar de temporada se conserva el idioma actual cuando esa temporada lo ofrece; si no, BloqueTV prioriza Español latino y después la primera variante disponible.
- El menú **Idiomas** se actualiza según la temporada seleccionada, evitando mezclar capítulos de temporadas o audios distintos.
- Obras distintas, por ejemplo `Naruto` y `Naruto Shippuden`, siguen siendo fichas separadas.
