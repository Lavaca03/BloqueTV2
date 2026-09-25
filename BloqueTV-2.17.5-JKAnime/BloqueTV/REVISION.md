# Revisión de BloqueTV 2.17.5 · JKAnime

Fecha: 23 de septiembre de 2026. Base: ZIP `221145ad-bc03-4bd5-8d06-b8073d97830b.zip`, BloqueTV 2.17.5 · Seasons · Episodios Fix 2.

## Cambios de esta entrega

- Nuevo catálogo de Anime con paginación completa, búsqueda, colecciones, fichas, favoritos y episodios por título.
- La navegación reutiliza las tarjetas, carruseles, buscadores y estilos actuales. Las tres hojas CSS y todos los archivos de marca son idénticos a la base elegida.
- Las fichas conservan el nombre completo. Las secuelas publicadas como obras separadas no se mezclan automáticamente.
- Los capítulos proceden exclusivamente del índice del anime seleccionado. Se comprueba la pertenencia y disponibilidad antes de extraer sus servidores.
- La consulta de episodios utiliza la sesión anónima y el token público del formulario de la fuente. Estos datos permanecen en el servidor y no se envían al navegador ni se guardan en el ZIP.
- El lector acepta solicitudes POST manteniendo la validación de destinos públicos y DNS de cada conexión. Las redirecciones del proveedor se restringen a su origen; se conservan correctamente las cabeceras de cookies independientes.
- Los datos JSON de los scripts se leen sin ejecutar JavaScript remoto. Las URLs temporales de reproducción se obtienen de nuevo al abrir el capítulo.
- Se cancelan solicitudes obsoletas al buscar, cambiar de página o abandonar una ficha. Se mantienen las descargas del navegador y las correcciones de Episodios Fix 2.

## Verificación

- **67 pruebas de Node.js**: servidor, episodios, catálogos, conexiones remotas y descargas. Incluyen las 45 pruebas previas, la integración nueva y las redirecciones POST.
- **51 comprobaciones de interfaz en DOM simulado**: las 38 anteriores y 13 nuevas de catálogo, paginación, reintentos, fichas, favoritos, capítulos y cancelación de solicitudes.
- **9 comprobaciones HTTP** con el servidor real y un transporte controlado alimentado por las páginas capturadas de la fuente.
- Comprobación de sintaxis con `npm run check`.

Las capturas públicas consultadas mostraron **5.006 títulos en 167 páginas**. Se comprobó la extracción de las páginas 1 y 2 (30 títulos cada una) y 167 (26), la colección por popularidad y los 23 resultados de «Naruto». Las cantidades son una instantánea; el programa no las fija como límites.

Se consultó en vivo el formulario anónimo de episodios de Naruto: primera página (1–16), última página (209–220) y búsqueda del capítulo 212. Las mismas respuestas se procesaron por los lectores y por las rutas HTTP de BloqueTV. También se extrajeron 12 opciones de servidor de la página del capítulo 1.

**Alcance de las comprobaciones:** el servidor de BloqueTV no pudo conectarse directamente a la fuente en este entorno porque su resolución de red fue rechazada por la validación de destinos públicos. Esa validación se conserva. Las páginas y respuestas públicas se consultaron por separado; las rutas completas se probaron con transporte controlado. No se verificó la reproducción de todos los videos externos ni el aspecto visual en un navegador real. Las descargas siguen dependiendo de que el servidor de video exponga un archivo compatible.

Las comprobaciones anteriores se conservan a continuación como historial de la base.

---

# Revisión de BloqueTV 2.17 Plus · Experience

Fecha: 22 de septiembre de 2026. Base: 2.17.5 Seasons. Revisión: identidad BloqueTV sobre Episodios Fix 2.

## Identidad BloqueTV

- Se utiliza el nombre **BloqueTV** en la web, la pestaña, el reproductor, las descargas, la instalación y la consola de inicio.
- El logo aportado se incluye sin modificar sus píxeles. La web ajusta su encuadre para el menú y la portada; el icono usa el símbolo de esa misma imagen.
- Los tonos violeta y azul del logo se aplican a botones y navegación.
- La base sigue siendo 2.17.5 Seasons · Episodios Fix 2. Se conservan sus validaciones de episodios y los selectores de idioma y temporada.
- Se mantienen las claves internas del almacenamiento y de configuración para conservar favoritos, historial, progreso y descargas en el mismo navegador y origen.

## Resultado de la revisión

Se ejecutaron **45 pruebas automatizadas del servidor, descargador y catálogo**, todas aprobadas, y **38 comprobaciones de comportamiento de la interfaz en un DOM simulado**, sin errores no controlados. La comprobación de sintaxis también pasó.

El ZIP conserva la configuración `.env`, los catálogos y los ejemplos del proyecto recibido. TMDb continúa desconectado.

## Corrección del reporte de capítulos 54, 159 y 212

Se localizaron los tres enlaces en el bloque «Más vistos» del HTML actual: 54 de DouPo Cangqiong, 159 de El inmortal renegado y 212 de Lingwu Dalu. Son recomendaciones repetidas en fichas de otras obras.

La extracción de la revisión anterior ya descartaba estos enlaces en el HTML consultado de Mad Demon Lord, pero la interfaz seguía mostrando cualquier episodio recibido. Se reprodujo esta ruta con una respuesta contaminada: la interfaz anterior mostró 1–20, 54, 159 y 212. La versión corregida muestra solo 1–20.

- Exclusión explícita de los bloques «Más vistos» y recomendaciones, incluso si aparecen anidados dentro del contenido principal.
- La misma validación de URL y número de episodio se aplica en el lector, la interfaz y la petición de reproducción.
- Los contadores, listas y pestañas se recalculan a partir de capítulos válidos. Una lista que solo contiene recomendaciones queda vacía.
- Un enlace ajeno no puede reemplazar un capítulo válido con el mismo número. El botón reproduce el episodio validado, sin volver a tomar su URL de atributos modificados de la página.
- Se conserva la relación explícita de las temporadas y especiales con su serie, incluyendo temporadas con un nombre alternativo.
- Una respuesta o redirección que corresponde a otra ficha no sustituye la selección.

**Verificación:** 45 pruebas de Node.js aprobadas; las 27 comprobaciones previas de interfaz y 11 nuevas comprobaciones con listas contaminadas también pasaron. Las nuevas pruebas de interfaz cubren Mad Demon Lord, una segunda obra corta, tres obras con capítulos legítimos de números altos y una obra sin episodios. Verifican listas, contadores y las URLs enviadas al reproductor.

Sobre HTML descargado de las páginas reales se verificaron Mad Demon Lord (1–20), DouPo Cangqiong temporada 8 (dos páginas: 1–54), El inmortal renegado (primera página: 110–159) y Lingwu Dalu (primera página: 168–217). No se eliminaron globalmente números de capítulos.

La petición completa del servidor a la fuente en vivo no pudo validarse en este entorno: la resolución de red fue rechazada por el control de destinos públicos. Ese control se conserva. La extracción se verificó con HTML descargado, y las rutas HTTP y la interfaz con respuestas controladas; esto no confirma la reproducción de todos los videos externos.

## Revisión anterior de catálogo sobre 2.17.5 Seasons

Esta revisión parte del ZIP subido en esta solicitud. Conserva el agrupamiento de anime, los selectores de temporadas e idiomas, las descargas nativas y TMDb desconectado.

| Hallazgo | Corrección |
| --- | --- |
| Un encabezado de sección como «Temporadas» o «Episodios» podía sustituir el nombre de la obra. | Se prioriza el título de la ficha y se rechazan encabezados genéricos. La interfaz conserva el nombre de referencia si lo necesita. |
| La extracción leía enlaces de recomendaciones y de la barra lateral. | Solo se admiten episodios del bloque principal y cuya URL pertenezca a la temporada seleccionada. |
| Una temporada que fallaba podía sustituirse con enlaces ajenos encontrados en la página. | Se presenta una lista vacía; no se utiliza esa sustitución. |
| Los identificadores truncados coincidían entre distintas series. | Se usa la URL completa para la identidad, y los favoritos existentes se reconocen por su URL. |
| Los especiales recibían números de temporada por su posición en una lista. | Conservan su nombre y se distinguen de las temporadas numeradas. |
| Una búsqueda de video pendiente podía abrir un episodio anterior tras cambiar de idioma o temporada. | Se cancela la solicitud anterior y se bloquea temporalmente la lista durante el cambio de variante. |

La paginación se limita a la ficha y al listado de episodios actual, incluyendo sus enlaces de navegación. Se eliminan duplicados dentro de cada temporada, conservando capítulos del mismo número en temporadas diferentes. Los datos de una ficha abierta actualizan su nombre guardado en favoritos y en el historial de navegación.

### Comprobación con HTML de las páginas consultadas

- **Mad Demon Lord:** nombre correcto y capítulos **1–20**. Los enlaces ajenos numerados 27 y 54 no se incorporan a esa lista.
- **DouPo Cangqiong, temporada 8:** lectura de las dos páginas del listado, **50 + 4 = 54 capítulos**, del 1 al 54. El capítulo 54 se conserva cuando pertenece a esta temporada.
- Sus especiales mantienen las etiquetas **Especial**, **The Origin**, **Song of Desert** y **El acuerdo de 3 años**.

Son resultados de la extracción sobre el HTML descargado durante esta revisión, no una confirmación de reproducción de todos esos videos.

### Pruebas nuevas del catálogo: 13 aprobadas

Se cubren títulos genéricos, títulos con entidades HTML, enlaces ajenos, números de episodio repetidos, temporadas diferentes, HTML anidado, enlaces en scripts, temporadas de recomendaciones, paginación, fallos de carga, listas directas, redirecciones, identidades y nombres de especiales.

### Interfaz comprobada en esta revisión

Las 27 comprobaciones del DOM incluyen el agrupamiento de anime, la separación de obras distintas, cambios de idioma y temporada, actualización de URLs y listas, cancelación de una reproducción pendiente, nombres de especiales, favoritos, búsqueda, descargas y navegación móvil. Se ejecutaron con respuestas controladas para reproducir los casos de forma determinista.

## Ajustes de la versión 2.17.3

- Eliminada la sección Abrir un enlace, sus accesos de inicio y menú, y las invitaciones a utilizarla en catálogos vacíos. Una visita guardada a esa sección vuelve a Inicio.
- Sustituidos los encabezados y mensajes promocionales por textos del catálogo de BloqueTV. La limpieza también se aplica a títulos, fichas, episodios, favoritos y descargas guardados anteriormente.
- Retirado el enlace externo Fuente del reproductor y de los mensajes de descarga fallida. La elección de servidor y las descargas siguen dentro de BloqueTV.

## Correcciones principales

| Problema encontrado | Corrección |
| --- | --- |
| Una búsqueda lenta podía reemplazar una pantalla o consulta posterior. | Cancelación de solicitudes al navegar y al cambiar de búsqueda. |
| Pulsar capítulos seguidos podía abrir el capítulo anterior. | Se invalida la resolución anterior y solo se abre la selección vigente. |
| El botón Volver enviaba siempre a Buscar. | Historial de navegación con Atrás/Adelante y datos de la ficha. |
| En móvil se ocultaban los nombres y no había acceso cómodo a todas las secciones. | Menú completo y barra de accesos rápidos. |
| El historial decía que una descarga se había iniciado sin conocer su transferencia. | Sesiones con estados, bytes, velocidad, cancelación y errores. |
| Se perdía el referer de la fuente al repetir una descarga. | El historial conserva los datos necesarios para prepararla otra vez. |
| Se podían confundir servidores del mismo proveedor. | Se distinguen las URLs y el selector mantiene la opción elegida. |
| Nombres con apóstrofos podían romper los atributos de una tarjeta. | Escape adecuado de los datos de las tarjetas. |
| Una URL terminada en MP4 podía devolver HTML. | Se valida el tipo de contenido y se rechazan páginas de error. |
| HLS no compatible podía generar descargas incompletas, sin audio o mal nombradas. | Validación previa de las listas y extensión TS/MP4 según su estructura. |
| Las transferencias podían seguir leyendo datos después de cancelar el navegador. | Cancelación del origen remoto y del control de flujo al cerrar la conexión. |
| Una respuesta tardía de temporada podía reemplazar la temporada elegida después. | Identificación de cada solicitud de temporada. |
| Inicio y el indicador de conexión dependían de TMDb desactivado. | Portada de fuentes y estado del servidor de BloqueTV. |
| HLS dependía de cargar una biblioteca externa. | Biblioteca HLS 1.7.3 y licencia incluidas en el proyecto. |

## Servidor y descargas: 18 pruebas aprobadas

- Integridad de bytes en una transferencia de archivo directo y nombre Unicode.
- Reanudación HTTP 206 con rangos y validadores.
- Reinicio HTTP 200 cuando el proveedor ignora Range.
- Error HTTP 416 para rangos no disponibles.
- Selección de variante y ensamblado de segmentos HLS en orden.
- HLS fMP4 con segmento de inicialización y extensión adecuada.
- Rechazo previo de HLS cifrado, en directo o con audio separado.
- Interrupción y error cuando falta un fragmento HLS.
- Rechazo de HTML presentado bajo una URL MP4.
- Resolución de un reproductor de prueba que expone video directo.
- Cancelación y cierre del origen remoto.
- Desconexión del cliente sin informar falsamente una transferencia completa.
- Rechazo de cancelaciones desde otro origen y métodos incorrectos.
- Rechazo de destinos privados y variantes IPv6 de direcciones locales.
- Nombres de archivo y listas HLS no compatibles.
- Arranque del servidor y disponibilidad de todos los recursos del HTML.
- Portada vacía utilizable con los proveedores desactivados.
- Errores explícitos para rutas malformadas, recursos ausentes y destinos no válidos.

Ejecutar en la carpeta BloqueTV:

```powershell
npm.cmd run check
npm.cmd test
```

## Interfaz: comprobaciones en DOM simulado

Se comprobaron arranque, portada sin TMDb, preparación de descarga, entrega mediante enlace nativo, actualización de estados, historial, ayuda del navegador, errores sin enlaces externos, tarjetas con apóstrofos, filtro de capítulos, selecciones rápidas, búsquedas fuera de orden y menú móvil. También se verificaron el cambio de servidor, la eliminación de la sección de enlaces, la recuperación de visitas antiguas, los catálogos vacíos y la ausencia de menciones promocionales en fichas de series y películas, episodios, favoritos y descargas anteriores.

Estas comprobaciones ejercitan eventos y contenido HTML, **no el motor de diseño ni el guardado nativo de Chrome/Edge/Firefox**. El simulador y sus dependencias solo se utilizaron en el entorno de revisión; no son necesarios para ejecutar BloqueTV.

## Límites de la verificación

- No se completó la revisión visual en un navegador gráfico: el navegador disponible bloqueó el acceso al servidor local.
- No se confirmó una descarga completa mediante la interfaz de un navegador real. Se verificaron el flujo DOM y las transferencias HTTP del descargador por separado.
- No se verificó la reproducción o descarga de cada proveedor externo en vivo. Las pruebas usan fuentes controladas; su disponibilidad real, cookies y enlaces temporales dependen del proveedor.
- El soporte HLS se limita a las estructuras descritas en README.md. No es un conversor multimedia general.

## Referencias de implementación

- Descarga mediante enlace HTML: https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download
- Formato HLS: https://www.rfc-editor.org/rfc/rfc8216.html
- Reproductor HLS incluido: https://github.com/video-dev/hls.js (versión 1.7.3; licencia en `public/vendor/hls.LICENSE`).

## Selector de idiomas de episodios

- Se añadió el botón **Idiomas** junto al buscador de capítulos en fichas de anime compatibles.
- Las variantes se agrupan por el mismo título base y se validan antes de mostrarse.
- Solo se ofrecen idiomas realmente disponibles: Español latino, Castellano y/o Sub español.
- El cambio de idioma sustituye la lista, contador y URLs de episodios, evitando mezclar capítulos/servidores entre variantes.
- Si existe una sola variante, el menú conserva únicamente esa opción.


## Ajustes de la versión 2.17.4

- Unificación de las fichas de Anime por obra, independientemente del idioma.
- Las variantes Latino, Castellano y Sub español se gestionan desde el selector de idiomas de la misma ficha.
- Se conservan separadas obras distintas como Naruto y Naruto Shippuden.
- Favoritos y resultados usan una identidad canónica por título para evitar duplicados visuales.


## Ajustes de la versión 2.17.5

- Se añadió el selector **Temporadas** al lado de **Idiomas** en las fichas de anime compatibles.
- La identidad canónica de Anime ahora elimina marcadores explícitos de temporada (`Temporada 2`, `Season 2`, `T2`, `S2`) además de los marcadores de idioma.
- Resultados y favoritos pueden representar una obra una sola vez aunque la fuente publique fichas separadas por temporada e idioma.
- El backend agrupa variantes por obra → temporada → idioma y valida que cada variante tenga episodios antes de mostrarla.
- Cambiar de temporada sustituye la lista de capítulos y mantiene el idioma activo cuando es posible.
