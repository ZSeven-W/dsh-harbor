<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md"><b>Español</b></a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

Un espejo de solo lectura de los plugins de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) que tienes instalados: qué **puede hacer** cada uno, dónde **entran en conflicto** y qué ha **cambiado** desde el último análisis, con pruebas verificables de cada capacidad detectada.

Tú decides si quieres limpiar algo. harbor expone los hechos; no juzga, no controla las instalaciones ni intercepta nada.

## Qué es y qué no es

harbor hace una sola cosa: mantiene un registro continuo y respaldado por pruebas de los plugins que tienes instalados. El registro consta de tres columnas: el inventario propiamente dicho (cada plugin de terceros instalado, con la ubicación de su código fuente cuando el detector dispone de ella), la conciliación entre lo que declara cada plugin y lo que hace realmente su código, y la cronología de lo que ha cambiado entre análisis.

Lo que harbor decide no hacer también forma parte de su diseño. No examina ni filtra plugins antes de su instalación; el control de admisión corresponde a las herramientas del marketplace de plugins. No profundiza en la supervisión de dependencias upstream; la comprobación upstream cubre las versiones de los plugins y termina ahí. No realiza auditorías generales de código ni intercepta, bloquea o aísla el comportamiento de los plugins.

Esto último no es una decisión de alcance, sino una realidad del host. El runtime Cordis de DSH no tiene un sandbox de capacidades: cada plugin se ejecuta dentro del realm principal de Node del host, con sus mismos privilegios. harbor puede hacer que las capacidades sean **visibles**, **detectarlas** y **conciliarlas** con las declaraciones, pero no puede desactivarlas. Para contener el comportamiento de los plugins se necesita soporte en el propio cargador de DSH, y el flujo de declaración que aparece a continuación permite que ese estándar se construya con datos, en lugar de discutirse en abstracto.

Por último, harbor informa de hechos, no de puntuaciones. Su salida siempre indica «qué se ha detectado y dónde están las pruebas»; nunca asigna un nivel de riesgo ni una nota de calidad. El significado de un hallazgo lo decides tú, no harbor.

> **Estado: `0.1.0-rc.2`, consolidación de la versión candidata.** Están disponibles la CLI, las rutas del hub limitadas al loopback, el panel de ajustes de DSH, las divergencias entre perfiles y la comprobación upstream opcional. Un host activo aporta herramientas, providers y rutas de runtime; fuera de uno, las pruebas de runtime pasan explícitamente a `available: false`. Los detectores siguen siendo heurísticos y se están calibrando con el ecosistema más amplio, así que revisa sus pruebas en vez de tratar una ausencia de detección como prueba de inexistencia.

## Qué examina

```
~/.dsh/profiles/*                → bundles de terceros instalados (npm y link: por igual)
  ├─ declared    package.json / cordis.patch.yml — lo que el plugin declara sobre sí mismo
  ├─ runtime     tools / routes / providers registrados realmente en el host
  ├─ static      subprocesos, salida de red, escrituras en config externa — con file:line
  ├─ versions    divergencia (local, siempre) + upstream (con red, opcional)
  └─ snapshot    diff respecto al análisis anterior: versiones nuevas, capacidades nuevas
        └─ conciliación: dsh.capabilities declaradas frente a las detectadas
```

Las capacidades forman un conjunto fijo de trece elementos: inyección en el cliente, riesgos del realm, copias del realm, hooks globales, adaptadores LLM, subprocesos, salida de red, rutas web, registro de herramientas, servidores MCP, escritura en configuraciones externas, gestión de credenciales y lectura del entorno. Es un conjunto fijo para que los informes sigan siendo comparables y se puedan calcular sus diferencias entre análisis. La lista oficial se encuentra en la sección 2 de [SPEC.md](./SPEC.md); la fuente de verdad legible por máquina es `src/scan/detectors.mjs`.

La terminología es deliberadamente neutral: **capacidad**, no riesgo. Crear subprocesos es precisamente la razón de ser de algunos plugins. El informe responde «qué puede hacer» y deja «si debería hacerlo» en tus manos.

## Versiones

harbor responde a dos preguntas sobre versiones y las mantiene separadas.

La **divergencia entre perfiles** es completamente local. Que un mismo plugin tenga versiones diferentes en distintos perfiles es un hecho de esta máquina, por lo que se calcula gratis en cada análisis. Una instalación `link:` o `file:` no se toma como referencia de la versión «más reciente»: que un árbol de trabajo vaya por delante de su versión publicada es normal, no una divergencia.

La **comprobación upstream** sale de la máquina, por lo que nunca forma parte del análisis predeterminado. La CLI requiere `harbor scan --check-updates`; en el panel hay que pulsar explícitamente un botón y el texto a su lado lo indica: es la única acción de esa página que sale de tu máquina. Cada resultado tiene uno de estos cinco estados:

- **behind** — el registro contiene una versión más reciente
- **current** — la versión instalada coincide con la del registro
- **ahead** — la versión instalada es más reciente que la del registro (un estado real en la máquina de un mantenedor)
- **local** — una instalación `link:` / `file:`, que no tiene upstream con el que compararse y nunca se muestra como «actualizada»
- **unknown** — la consulta ha fallado

El registro se lee desde tu propio `.npmrc` (incluidas las redefiniciones `@scope:registry`) y nunca está fijado a npmjs. Los resultados se almacenan en caché en el disco durante seis horas.

## Instalación

Para desarrollo local, instálalo desde un checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` reenvía el resto de sus argumentos a pnpm dentro del directorio del perfil, y `link:` crea un enlace simbólico entre la dependencia del perfil y este checkout para que las recompilaciones aparezcan directamente. Para instalar desde el registro, usa el tag candidato `next`:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Después, reinicia DSH para que se cargue la nueva capa del perfil.

El panel aparece en la interfaz web de DSH, dentro de **Settings**, como la sección **DSH Harbor**: el mismo espejo que la CLI, con un inventario respaldado por pruebas, conflictos, versiones y las diferencias desde el último análisis. Su botón **Check for updates** es la única acción de esa página que sale de tu máquina. El panel forma parte de la mitad hub del plugin, que solo se monta en perfiles que tengan un servidor web.

El ejecutable del plugin se instala dentro del perfil seleccionado; añadirlo a `web` no coloca `harbor` en el `PATH` global de tu shell. Ejecútalo a través de ese perfil:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Para un checkout o una ejecución puntual desde el registro, usa una de estas opciones:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Uso

En los ejemplos siguientes, `harbor` es una abreviatura de cualquiera de las formas de ejecución anteriores.

```bash
harbor scan                 # inventario, conflictos y cambios desde el último análisis
harbor scan --check-updates # + comprobación upstream opcional en el registro (usa la red)
harbor manifest ./my-plugin # prepara un bloque dsh.capabilities para tu propio plugin
```

Añade `--evidence` para imprimir las pruebas de código `file:line` disponibles, `--json` para obtener el informe completo legible por máquina y `--no-snapshot` para omitir la escritura de la referencia para las diferencias. Los hechos derivados del manifiesto, el sistema de archivos o el runtime pueden no tener una línea de código fuente y se etiquetan como tales.

El analizador no tiene dependencias y no necesita que DSH esté instalado, por lo que también funciona en CI.

## Para autores de plugins

`harbor manifest` lee tu plugin de la misma forma que lee todos los demás y prepara el miembro `capabilities` para combinarlo con el objeto `dsh` existente en tu `package.json`; nunca te pide que sustituyas ese objeto y pierdas la configuración `bundle` o `client`. Una vez declarado, la comprobación de harbor se convierte en una conciliación entre **declarado y detectado**: las capacidades que declaras pero nunca utilizas son ruido que puedes eliminar, y las que se detectan pero no has declarado son las que merece la pena explicar. harbor también declara sus propias `dsh.capabilities`, de modo que el flujo se puede reproducir en la propia herramienta: ejecuta `harbor manifest .` en este repositorio.

La convención está documentada en [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). En una frase: `dsh.capabilities` es una lista sencilla dentro de `package.json` que indica lo que hace realmente el código de tu plugin. Declararla cuesta poco y aporta dos ventajas: las herramientas de auditoría como harbor pueden conciliar tus palabras con tu código, y quienes ejecutan tu plugin pueden ver que no ocultas nada. Puedes verificar tu propia declaración en cualquier momento con `harbor manifest <dir>`.

## Límites, explicados claramente

harbor lee el código fuente de todos los plugins, lo que lo convierte en el elemento con más privilegios de la sala. Aparece en su propio informe.

Cuando se activa la comprobación upstream, harbor pasa a tener capacidad de salida de red, y su declaración `dsh.capabilities` ya la incluye.

## Licencia

MIT
