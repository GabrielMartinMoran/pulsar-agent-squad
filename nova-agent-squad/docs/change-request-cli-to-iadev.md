# Change Request: Portar el CLI de gestión de agentes a IADEV

## 1. Resumen Ejecutivo

Se expandió el CLI `nas` (Nova Agent Squad) con herramientas para gestionar
modelos de agentes, configurar políticas de skills, y guardar/cargar perfiles
de modelos. Los comandos nuevos se dividen en dos grupos:

- **`nas agents`** — configurar qué modelo usa cada agente, y guardar/cargar
  perfiles de configuración de modelos.
- **`nas skills`** — gestionar reglas `permission.skill` (allow/deny/ask) por
  agente, con inyección automática en el frontmatter durante el build.

Este documento explica cada comando, su comportamiento interactivo (incluyendo
navegación con Escape, confirmaciones, loops), las dependencias involucradas, y
las decisiones de diseño que hay que tener presentes al portar esta funcionalidad
a otro proyecto de agentes (IADEV). Incluye una checklist de TODO ordenada por
dependencia para una implementación incremental.

---

## 2. Inventario de Comandos

### 2.1 `nas agents setup` — Wizard interactivo de modelos

```
┌─────────────────────────────────────────────────────────────────────┐
│                         agents setup flow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     Esc → sale limpio (exit 0)                    │
│  │ select agent │                                                  │
│  └──────┬───────┘                                                  │
│         │ agente elegido                                            │
│         ▼                                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │           choose action                   │                      │
│  │  · Change model                           │                      │
│  │  · Inherit default (quitar override)      │                      │
│  │  · Cancel (volver a select agent)         │                      │
│  └──────┬──────────┬──────────┬──────────────┘                      │
│         │          │          │                                      │
│    Change     Inherit    Cancel/Esc                                  │
│    model      default    ──► vuelve a select agent                  │
│         │          │                                                 │
│         │          └──► aplica removeAgentOverride,                 │
│         │               backup + write, vuelve a select agent        │
│         ▼                                                            │
│  ┌──────────────────┐     ← Esc → vuelve a choose action            │
│  │  search model    │                                               │
│  │  (filtra por id  │                                               │
│  │   o nombre)      │                                               │
│  └────────┬─────────┘                                               │
│           │ modelo elegido                                           │
│           ▼                                                          │
│     ¿tiene variantes?                                                │
│       ├─ NO ──► ┌────────────┐                                      │
│       │          │  confirm   │── Esc → vuelve a search model       │
│       │          └─────┬──────┘── No  → vuelve a choose action      │
│       │                │ Sí → aplica, backup, write,                │
│       │                │       vuelve a select agent                 │
│       │                                                              │
│       └─ SÍ ──► ┌───────────────┐  ← Esc → vuelve a search model   │
│                  │ choose variant│                                   │
│                  │ (default o     │                                   │
│                  │  high/max/etc) │                                   │
│                  └───────┬───────┘                                   │
│                          │ variant elegido                            │
│                          ▼                                            │
│                   ┌────────────┐                                     │
│                   │  confirm   │── Esc → vuelve a choose variant    │
│                   └─────┬──────┘── No  → vuelve a choose action     │
│                         │ Sí → aplica, backup, write,                │
│                         │       vuelve a select agent                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Comportamiento:**

- Al iniciar, lee `opencode.json` (falla rápido si el JSON está malformado).
- Muestra la lista canónica de agentes con `@inquirer/search`, cada uno con su
  modelo actual y guidance ("heavy model recommended" / "lighter model
  sufficient").
- Escape en la pantalla de selección de agente: sale limpio (exit 0, sin error).
- Escape en cualquier paso interno: retrocede exactamente un paso.
- Después de aplicar un cambio, vuelve a la selección de agente para configurar
  otro en la misma sesión.
- Los modelos se descubren ejecutando `opencode models` (cacheado en memoria por
  sesión).
- Las variantes efectivas se descubren con `opencode models --verbose`. Una
  máquina de estados asocia cada bloque JSON pretty-printed multilínea con el
  model-id inmediatamente anterior y cachea solo sus variantes.
- No existe fallback estático. Si `--verbose` falla o un modelo no expone
  variantes, el wizard omite la selección para no ofrecer opciones inválidas.
- "Inherit default" borra la entrada `agent.<name>` del config; si era la última,
  limpia la sección `agent` completa.
- Cada mutación crea un backup timestamped (`opencode.json.bak.YYYYMMDDHHmmss`)
  antes de escribir.

**Librerías usadas:** `@inquirer/search`, `@inquirer/select`, `@inquirer/confirm`.

---

### 2.2 `nas agents list` — Vista de modelos configurados (read-only)

Muestra una card por agente, en orden canónico:

```
● nas_researcher        · override
  Model:              openrouter/anthropic/claude-sonnet-4-5
  Variant:            high
  Guidance:           heavy model recommended

○ nas_developer_mini     · default
  Model:              default
  Variant:            default
  Guidance:           lighter model sufficient
```

- `●` verde = override activo. `○` gris = hereda el default.
- Nombres en cyan+bold. Guidance en dim.
- Soporta `--plain` para desactivar color. También respeta `NO_COLOR` y
  stdout no-TTY.
- `nas agents` sin subcomando equivale a `nas agents list` (read-only default).
- Nunca modifica `opencode.json`.

---

### 2.3 `nas agents profile` — CRUD de perfiles de modelos

Los perfiles son snapshots de los overrides de modelo+variant de los agentes
canónicos, guardados como archivos JSON sidecar en
`~/.config/opencode/nas/profiles/<name>.json`.

#### `save <name>`

```
Lee opencode.json → canonicalize (solo agentes canónicos, solo model+variant) → guarda en profile dir
```

- Rechaza nombres duplicados: NUNCA sobrescribe un perfil existente.
- Crea el directorio de perfiles automáticamente en el primer save.

#### `list`

Lista los nombres de todos los perfiles guardados, ordenados alfabéticamente.
Si no hay ninguno, imprime un aviso y sale con exit 0.

#### `load <name>`

Aplica un perfil guardado a `opencode.json`:

1. Lee el perfil y `opencode.json`.
2. Intersecta el perfil con la lista canónica de agentes.
3. Para cada agente canónico en el perfil: escribe su `model` + `variant`.
4. Para cada agente canónico AUSENTE del perfil: borra su override en el config
   vivo (hereda default).
5. Entradas no-canónicas/huérfanas en el perfil: ignoradas silenciosamente pero
   reportadas en el output.
6. Preserva campos no relacionados del config y overrides de agentes no-canónicos.
7. Backup antes del write.

#### `rename <old> <new>`

Renombra el archivo de perfil. Opera solo sobre el archivo sidecar, nunca toca
`opencode.json`. Rechaza fuentes inexistentes y destinos que ya existen.

#### `delete <name>`

Borra el archivo de perfil. Rechaza nombres inexistentes (nunca silencioso).

---

### 2.4 `nas skills setup` — Wizard interactivo de políticas de skills

```
┌──────────────────────────────────────────────────────────────────┐
│                       skills setup flow                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────┐                                         │
│  │     main menu        │── Esc/Cancel → sale limpio (exit 0)    │
│  │ · Add a rule         │                                        │
│  │ · Remove a rule      │                                        │
│  │ · Clear              │                                        │
│  │ · Cancel             │                                        │
│  └──┬───────┬──────┬────┘                                        │
│     │       │      │                                              │
│   Add    Remove  Clear                                            │
│     │       │      │                                              │
│     │       │      └──► confirmClear ──► aplica clearSkillPolicies│
│     │       │           (default: No)     (nunca toca top-level)  │
│     │       │           Esc → main menu                           │
│     │       │           No  → main menu                           │
│     │       │           Sí  → backup+write → main menu            │
│     │       │                                                     │
│     │       ▼                                                     │
│     │  ┌───────────┐  ← Esc → main menu                          │
│     │  │  scope?   │                                             │
│     │  │ all-nas   │                                             │
│     │  │ agent     │──► chooseAgent ──► Esc → scope              │
│     │  └─────┬─────┘                                              │
│     │        │                                                    │
│     │  ┌─────┴──────────────────────────────┐                     │
│     │  ▼         REMOVE                     ▼ ADD                 │
│     │  ┌───────────────────┐    ┌───────────────────────┐        │
│     │  │ search pattern    │    │ search/add pattern     │        │
│     │  │ (solo existentes) │    │ (sugerencias: skills   │        │
│     │  └───────┬───────────┘    │  disponibles + reglas  │        │
│     │          │                │  existentes + freeform)│        │
│     │     Esc → main menu       └───────┬───────────────┘        │
│     │          │                        │                          │
│     │          ▼                   Esc → scope                     │
│     │  ┌────────────┐                 │                            │
│     │  │ confirm    │                 ▼                            │
│     │  │ remove     │── Esc → search  ┌───────────────┐          │
│     │  └─────┬──────┘                 │ choose action │          │
│     │        │           No → main    │ allow/deny/ask│          │
│     │        │            menu        └───────┬───────┘          │
│     │        │ Sí → aplica                    │                    │
│     │        │   backup+write            Esc → search pattern     │
│     │        │   → main menu                  │                    │
│     │        │                                ▼                    │
│     │        │                         ┌────────────┐             │
│     │        │                         │ confirm    │             │
│     │        │                         │ add        │             │
│     │        │                         └─────┬──────┘             │
│     │        │                     Esc → choose action            │
│     │        │                     No  → main menu                │
│     │        │                     Sí  → aplica                   │
│     │        │                         backup+write               │
│     │        │                         → main menu                │
└──────────────────────────────────────────────────────────────────┘
```

**Comportamiento:**

- Al iniciar, lee `opencode.json` (falla rápido si el JSON está malformado)
  y construye la vista de políticas actual.
- Escape en el menú principal: sale limpio (exit 0, sin cambios).
- Escape en cualquier paso interno: retrocede exactamente un paso.
- Después de cada add/remove/clear exitoso, vuelve al menú principal.
- Las sugerencias de patrones en "Add" incluyen skills disponibles (via
  `opencode debug skill`) + patrones de reglas existentes + freeform (el
  usuario puede tipear cualquier patrón nuevo).
- El scope `all-nas` hace fan-out: la regla se escribe en el bloque
  `agent.<name>.permission.skill` de CADA agente canónico.
- NUNCA se escribe en `permission.skill` top-level (eso afectaría a agentes
  no-NAS/no-IADEV).
- Cada mutación crea backup timestamped antes del write.
- Después de aplicar, imprime un recordatorio: hay que correr `build && install`
  para que las reglas se propaguen a los archivos de agente instalados (esto es
  clave — ver sección 4.2).

**Librerías usadas:** `@inquirer/search`, `@inquirer/select`, `@inquirer/confirm`.

---

### 2.5 `nas skills list` — Vista de políticas de skills (read-only)

Muestra una card por agente canónico con sus reglas:

```
OpenCode `permission.skill` — NAS agents only (read-only)

● nas_researcher    · override
  Pattern:     docs-*
  Action:      allow
  Pattern:     shell-*
  Action:      deny

○ nas_developer_mini · default
  Pattern:     (no rules)
```

- `●` verde = tiene reglas. `○` gris = sin reglas.
- Las reglas se muestran en orden de declaración (que es el orden en que
  OpenCode las evalúa con last-match-wins).
- Soporta `--plain` y `--skip-discovery` (omite la lista de skills disponibles
  que se muestra al final como referencia).
- `nas skills` sin subcomando equivale a `nas skills list`.
- NUNCA muestra el bloque `permission.skill` top-level — solo per-agent.
- Nunca modifica `opencode.json`.

---

### 2.6 `nas skills add <pattern> <action>` — Agregar regla (no interactivo)

```bash
nas skills add "docs-*" allow                           # scope=all-nas (default)
nas skills add "git-*" deny --scope agent --agent nas_developer
nas skills add "shell-*" ask --dry-run                  # preview sin escribir
```

- `pattern`: wildcard nativo de OpenCode (`*`, `?`).
- `action`: `allow | deny | ask`.
- `--scope all-nas|agent` (default: `all-nas`).
- `--agent <name>` requerido cuando `--scope agent`.
- `--dry-run`: imprime el JSON resultante sin tocar el archivo.
- Backup antes del write.

### 2.7 `nas skills remove <pattern>` — Quitar regla (no interactivo)

```bash
nas skills remove "docs-*"                              # scope=all-nas
nas skills remove "git-*" --scope agent --agent nas_developer
nas skills remove "shell-*" --dry-run
```

- Mismos flags que `add`. Borra la regla de todos los agentes canónicos
  (o de uno solo).
- Cuando se borra la última regla de un agente, el bloque `agent.<name>`
  se limpia automáticamente.

### 2.8 `nas skills clear` — Limpiar políticas (no interactivo)

```bash
nas skills clear                                        # scope=all (default)
nas skills clear --scope agent --agent nas_developer
nas skills clear --dry-run
```

- `--scope all-nas|agent|all` (default: `all`).
- `all` = borra `permission.skill` de todos los agentes canónicos.
- NUNCA toca `permission.skill` top-level.

---

## 3. Librerías y Dependencias

### Frameworks y packages

| Dependencia          | Uso                                                  |
| ---------------------| -----------------------------------------------------|
| `citty`              | Framework de CLI (defineCommand, runMain, subCommands, args posicionales y flags) |
| `@inquirer/search`   | Prompt de búsqueda interactiva con filtrado asíncrono |
| `@inquirer/select`   | Prompt de selección de lista                         |
| `@inquirer/confirm`  | Prompt de confirmación sí/no                         |
| `@inquirer/core`     | `AbortPromptError` — la excepción que tiran los prompts cuando se aborta la signal |

### Node.js built-ins

| Módulo               | Uso                                                  |
| ----------------------| -----------------------------------------------------|
| `node:readline`       | `emitKeypressEvents` + listener de `keypress` para detectar Escape |
| `node:child_process`  | `spawnSync` para ejecutar `opencode models` y `opencode debug skill` |
| `node:fs`             | `readFileSync`, `writeFileSync`, `copyFileSync`, `existsSync`, `mkdirSync`, `readdirSync`, `renameSync`, `rmSync` |

### Runtime

El proyecto usa **Bun** (`bun.lock`, `Bun.spawnSync`) pero el código del CLI
usa `spawnSync` de `child_process` en los módulos de discovery. Para portar a
Node.js basta con cambiar `Bun.spawnSync` → `spawnSync` de `child_process` (el
módulo `skill-discovery.ts` ya lo hace así para ser portable).

En `package.json`:

```json
{
  "dependencies": {
    "citty": "...",
    "@inquirer/search": "...",
    "@inquirer/select": "...",
    "@inquirer/confirm": "...",
    "@inquirer/core": "..."
  },
  "devDependencies": {
    "@types/node": "..."
  }
}
```

### Comandos externos requeridos

- `opencode models` — lista los modelos disponibles (una línea por modelo).
- `opencode models --verbose` — emite cada model-id seguido por su objeto JSON
  pretty-printed; es la única fuente de variantes efectivas por modelo.
- `opencode debug skill` — devuelve JSON array con las skills disponibles
  (`[{ "name": "...", "description": "...", "location": "..." }]`).

---

## 4. Decisiones de Diseño Críticas

### 4.1 Modelos de agentes: se gestionan en `opencode.json` global

Los modelos de cada agente se leen y escriben directamente en
`~/.config/opencode/opencode.json`, en el bloque:

```json
{
  "agent": {
    "nas_researcher": {
      "model": "openrouter/anthropic/claude-sonnet-4-5",
      "variant": "high"
    },
    "nas_qa": {
      "model": "openrouter/anthropic/claude-haiku-4-5"
    }
  }
}
```

Esto es manejado por `config-safety.ts` con las funciones `setAgentModel` y
`removeAgentOverride`. El config se lee con `JSON.parse`, se modifica en
memoria, y se escribe con `JSON.stringify` + 2-space indent. Nunca se hace
manipulación de strings sobre el archivo.

### 4.2 Skills: se gestionan en `opencode.json` pero se inyectan en el frontmatter en build-time

**Este es el punto más importante del diseño.**

Las reglas de skills se escriben en `opencode.json` como:

```json
{
  "agent": {
    "nas_researcher": {
      "permission": {
        "skill": {
          "docs-*": "allow",
          "shell-*": "deny"
        }
      }
    }
  }
}
```

**Pero OpenCode tiene un bug de precedencia**: el agente tiene en su frontmatter
un `*`: allow dentro del bloque `permission:`, que en runtime se mergea DESPUÉS
de las reglas del usuario en `opencode.json`. Como OpenCode resuelve
"last matching rule wins", el `*`: allow del frontmatter sombrea las reglas
específicas del usuario y nunca se aplican.

**La solución**: durante `nas build`, el paso de build lee el
`permission.skill` del `opencode.json` del usuario y lo INYECTA en el frontmatter
del agente de dist, COMO HERMANO del `*`: allow y COLOCADO DESPUÉS de esa línea:

```yaml
permission:
  "*": allow
  skill:                    # ← inyectado en build
    "docs-*": allow
    "shell-*": deny
```

Esto invierte la precedencia: ahora las reglas específicas de skill están
después del catch-all y ganan por "last match wins".

**Implicaciones para el port a IADEV**:

- Las skills permitidas/bloqueadas se gestionan con el CLI de skills (add/remove/setup).
- Pero HAY QUE CORRER BUILD + INSTALL después para que tomen efecto.
- El build step debe inyectar las reglas del `opencode.json` en el frontmatter
  de cada agente.
- Si los agentes IADEV no usan frontmatter YAML sino otro formato, hay que
  adaptar el mecanismo de inyección.

### 4.3 Perfiles: sidecar files, solo model+variant

Los perfiles son archivos JSON guardados en `~/.config/opencode/nas/profiles/`
(o `iadev/profiles/` en el nuevo proyecto). Cada perfil solo contiene `model`
y opcionalmente `variant` para cada agente canónico que tenga override. No
guardan `mode`, `permission`, ni ningún otro campo.

Esto es intencional: los perfiles son snapshots de "qué modelos usar", no de
la configuración completa del agente. Al hacer `load`, el perfil se intersecta
con la lista canónica de agentes y solo modifica `model`/`variant`; el resto
del config se preserva.

### 4.4 Lista canónica de agentes: single source of truth

Hay una constante `NAS_AGENTS` (en el presenter) que define el orden canónico:

```ts
export const NAS_AGENTS: readonly string[] = [
  'nas_researcher',
  'nas_planner',
  'nas_developer',
  'nas_developer_mini',
  'nas_qa',
  'Nova Agent Squad',
];
```

Absolutamente todo — presenters, wizards, skill policies, profile store,
build injection — referencia esta misma lista. Para IADEV hay que definir
su propia constante (`IADEV_AGENTS`) con el orden canónico de los agentes
IADEV y usarla consistentemente en todos lados.

### 4.5 Backup-before-write

TODA mutación de `opencode.json` (setup, add, remove, clear, load) crea un
backup timestamped antes del write: `opencode.json.bak.YYYYMMDDHHmmss`. Esto
es no-negociable. Los comandos readonly (list, profile list) nunca tocan el
archivo.

### 4.6 Top-level permission.skill: NUNCA se toca

Los comandos de skills solo escriben en `agent.<name>.permission.skill`. El
bloque `permission.skill` a nivel raíz del config (que afecta a TODOS los
agentes, no solo los NAS/IADEV) nunca es leído ni escrito por el CLI. Si el
usuario tiene reglas manuales ahí, se preservan intactas.

### 4.7 Escape key handling

Los prompts de `@inquirer` no manejan Escape nativamente. Para lograr la
navegación con Escape, se usa `node:readline.emitKeypressEvents` para
activar eventos de keypress en stdin, y un listener que aborta un
`AbortController` cuando detecta `key.name === 'escape'`. El `AbortSignal`
se pasa a cada prompt via el parámetro `context`. Cuando el prompt se aborta,
lanza `AbortPromptError` (de `@inquirer/core`), que el wizard atrapa para
decidir si salir (outer escape) o retroceder un paso (inner escape).

Cada prompt usa su propio `AbortController` + listener; al terminar el prompt
(éxito, escape, o error), el listener se desregistra con `dispose()` en un
bloque `finally`. Esto evita leaks de listeners entre prompts consecutivos.

### 4.8 Caché de modelos en memoria

La salida de `opencode models` y el registro de variantes obtenido con
`opencode models --verbose` se cachean en memoria durante la sesión del wizard.
Los cachés NO se persisten: cada nueva ejecución vuelve a consultar OpenCode.
`resetModelsCache()` limpia ambos seams en tests. Si el comando plano falla o
no produce modelos, no se cachea el vacío. Si `--verbose` falla o no produce
bloques parseables, `discoverVariants()` devuelve `[]` y el wizard omite el paso
sin usar un mapa estático.

### 4.9 Color output

El CLI usa códigos ANSI para colorear la salida de los comandos `list`:

- `●` verde (ANSI 32) = override activo
- `○` gris (ANSI 90) = default
- Nombres de agentes en cyan+bold (ANSI 36;1)
- Guidance en dim (ANSI 2)

La política de color respeta:

1. `--plain` flag: desactiva TODO el color (prioridad máxima).
2. `NO_COLOR` env var: si está seteada a cualquier valor no-vacío, desactiva color.
3. stdout no-TTY: desactiva color.
4. En TTY, sin `NO_COLOR`, sin `--plain`: color activado por default.

No se usa ninguna librería externa de color (chalk, kleur, etc.) — solo
secuencias ANSI inline y una función helper `colorize(text, code, enabled)`.

---

## 5. TODO Checklist

Los items están ordenados por dependencia. Cada capa depende de las anteriores.

### Fase 1: Infraestructura base

- [ ] **1.1** Crear skeleton del CLI con `citty` (`defineCommand`, `runMain`).
  Definir el binario y los subcomandos `agents` y `skills`.
- [ ] **1.2** Implementar `config-safety.ts`:
  - `readConfig(path?)` — leer y parsear `opencode.json` (o equivalente de
    IADEV). Debe fallar con error claro si el JSON está malformado.
  - `createBackup(path?)` — copiar el archivo a `.bak.YYYYMMDDHHmmss` antes
    de cualquier write.
  - `setAgentModel(config, agentName, modelId, variant?)` — agregar/actualizar
    override de modelo en `agent.<name>`. Si `variant === 'default'`, borra
    el campo variant. Retorna nuevo objeto (no muta).
  - `removeAgentOverride(config, agentName)` — borrar la entrada del agente.
    Si era la última, limpia la sección `agent` completa. Retorna nuevo objeto.
  - `writeConfig(config, path?)` — serializar con `JSON.stringify` + 2-space
    indent + `\n` final.
  - Tipos `OpenCodeConfig`, `PermissionAction`, `PermissionConfig`.
- [ ] **1.3** Implementar `prompt-escape.ts`:
  - `createEscapeController()` → `{ signal: AbortSignal, dispose: () => void }`.
  - Usa `readline.emitKeypressEvents(process.stdin)` y listener de `'keypress'`
    que aborta en `key.name === 'escape'`.
  - `dispose()` desregistra el listener (idempotente).
- [ ] **1.4** Wire los subcomandos con lazy imports en el CLI principal.

### Fase 2: Model discovery

- [ ] **2.1** Implementar `model-discovery.ts`:
  - `discoverModels()` — ejecutar `opencode models`, parsear output (formato
    `provider/model-id` por línea), cachear en memoria. Si falla, no cachear.
  - `populateVariantsFromVerbose()` — ejecutar `opencode models --verbose`,
    parsear bloques JSON multilínea con una máquina `IDLE`/`IN_JSON` y cachear
    variantes exactas por model-id. Si falla, degradar a `[]` sin fallback.
  - `discoverVariants(modelId)` — devolver una copia de las variantes cacheadas.
  - `resetModelsCache()` — limpiar ambos cachés para tests.

### Fase 3: Agent commands

- [ ] **3.1** Definir `IADEV_AGENTS` constante con la lista canónica de agentes
  en orden. Esta es la single source of truth para TODO el sistema.
- [ ] **3.2** Implementar `agents/presenter.ts`:
  - `formatAgentCard({ name, model, variant, guidance, colorize })`
    → string con indicador ●/○, nombre, modelo, una sola línea Variant y guidance.
  - `buildAgentSummary(config, options)` → cards de todos los agentes.
  - `shouldColorize(opts, env)` → respeta `--plain`, `NO_COLOR`, non-TTY.
  - `getModelGuidance(agentName)` → `'light' | 'heavy'`.
  - `getModelGuidanceLabel(agentName)` → texto human-friendly.
- [ ] **3.3** Implementar `agents/list.ts` como comando read-only. Soporta
  `--plain`. Usa `readConfig` + `buildAgentSummary`.
- [ ] **3.4** Implementar `agents/setup-core.ts` (lógica pura, sin I/O):
  - `runSetupWizard(initialConfig, deps)` → `WizardResult`.
  - El wizard acepta dependencias inyectables: prompts, discoverModels,
    populateVariantsFromVerbose, discoverVariants, setAgentModel,
    removeAgentOverride, createBackup, writeConfig, formatOutput,
    createPromptSignal.
  - Implementa los loops anidados: outer (select agent) → action → search model
    → (variant) → confirm. Escape outer = exit, Escape inner = back one step.
  - Confirma antes de aplicar; después de aplicar, vuelve a select agent.
- [ ] **3.5** Implementar `agents/setup.ts` (I/O shell):
  - Wirea los prompts reales de `@inquirer/*` al wizard core.
  - `selectAgent` usa `@inquirer/search` con la lista canónica, mostrando
    modelo actual y guidance en la descripción.
  - `chooseAction` usa `@inquirer/select` con opciones Change/Inherit/Cancel.
  - `searchModel` usa `@inquirer/search` filtrando por id o nombre.
  - `chooseVariant` usa `@inquirer/select`.
  - `confirmApply` usa `@inquirer/confirm`.
  - Cada prompt recibe `signal` (del EscapeController) y `clearPromptOnDone: true`.
  - `onEscapeExit` es no-op (salida limpia, sin error).

### Fase 4: Profile store y commands

- [ ] **4.1** Implementar `profile-store.ts`:
  - `canonicalizeProfile(config)` — extraer solo agentes canónicos, solo
    `model` y `variant`.
  - `saveProfile(home, name, config)` — crea dir si no existe, rechaza
    duplicados, escribe JSON 2-space indent.
  - `listProfiles(home)` — listar `.json` en el dir de perfiles, ordenado.
  - `readProfile(home, name)` — parsear, falla si no existe.
  - `renameProfile(home, oldName, newName)` — rechaza fuente inexistente
    y destino existente.
  - `deleteProfile(home, name)` — rechaza fuente inexistente.
  - `applyProfileToConfig(config, profile)` — intersecta con agentes
    canónicos, escribe overrides presentes, borra ausentes, ignora
    huérfanos, preserva resto del config.
- [ ] **4.2** Implementar comandos de perfil (`agents/profile/`):
  - `save.ts` — `nas agents profile save <name>`.
  - `list.ts` — `nas agents profile list`.
  - `load.ts` — `nas agents profile load <name>`. Backup antes del write.
  - `rename.ts` — `nas agents profile rename <old> <new>`.
  - `delete.ts` — `nas agents profile delete <name>`.

### Fase 5: Skill discovery

- [ ] **5.1** Implementar `skill-discovery.ts`:
  - `listAvailableSkills()` — ejecutar `opencode debug skill`, parsear JSON
    array, extraer `name` de cada entry, deduplicar.
  - `parseOpencodeDebugSkill(payload)` — parsear + validar.
  - `SkillDiscoveryError` — error tipado con stderr y exitCode.

### Fase 6: Skill policies (lógica pura)

- [ ] **6.1** Implementar `skill-policies.ts`:
  - `readSkillPolicies(config)` → `SkillPolicyView` (global + perAgent).
  - `addSkillPolicy(config, scope, pattern, action, agentName?)` — fan-out
    a todos los canónicos o a uno solo. NUNCA escribe top-level.
  - `removeSkillPolicy(config, scope, pattern, agentName?)` — borra el
    pattern de los bloques per-agent. Limpia bloques vacíos.
  - `clearSkillPolicies(config, scope, agentName?)` — borra todos los
    `permission.skill` per-agent. Scope `all` = mismo comportamiento que
    `all-nas`. NUNCA toca top-level.
  - Validaciones: `isValidAction`, patterns no vacíos, scope+agent requerido.
- [ ] **6.2** Tests unitarios para todas las funciones puras de skill-policies.

### Fase 7: Skill commands

- [ ] **7.1** Implementar `skills/presenter.ts`:
  - `formatSkillScopeCard({ scopeLabel, rules, colorize })` — card con ●/○,
    nombre del agente, reglas pattern→action.
  - `buildSkillSummary(view, options)` — una card por agente canónico.
    NUNCA muestra `view.global`.
- [ ] **7.2** Implementar `skills/list.ts` como comando read-only. Soporta
  `--plain` y `--skip-discovery`. Muestra la lista de skills disponibles al
  final como referencia (opcional).
- [ ] **7.3** Implementar `skills/setup-core.ts` (lógica pura, sin I/O):
  - `runSkillsSetupWizard(deps)` → `SkillsWizardResult`.
  - Menú principal (Add/Remove/Clear/Cancel) → sub-flujos.
  - Add: scope → (agent) → pattern → action → confirm → apply → main menu.
  - Remove: scope → (agent) → pick existing pattern → confirm → apply → main menu.
  - Clear: confirm → apply → main menu.
  - Escape outer = exit, Escape inner = back one step.
- [ ] **7.4** Implementar `skills/setup.ts` (I/O shell):
  - Wirea prompts reales de `@inquirer/*` al wizard core.
  - `chooseAction` → `@inquirer/select`.
  - `chooseScope` → `@inquirer/select` (all-nas / agent).
  - `chooseAgent` → `@inquirer/select` con agentes canónicos.
  - `searchAddPattern` → `@inquirer/search` con sugerencias (skills disponibles
    + reglas existentes) y freeform (el usuario puede tipear lo que quiera).
  - `chooseRuleAction` → `@inquirer/select` (allow/deny/ask).
  - `confirmAdd`, `confirmRemove`, `confirmClear` → `@inquirer/confirm`.
  - Cada prompt recibe `signal` y `clearPromptOnDone: true`.
  - `discoverSkills` llama a `listAvailableSkills()` con fallback a `[]`.
- [ ] **7.5** Implementar `skills/add.ts` (no interactivo):
  - `nas skills add <pattern> <action> [--scope] [--agent] [--dry-run]`.
  - Validar pattern no vacío, acción válida, scope+agent requerido.
- [ ] **7.6** Implementar `skills/remove.ts` (no interactivo):
  - `nas skills remove <pattern> [--scope] [--agent] [--dry-run]`.
- [ ] **7.7** Implementar `skills/clear.ts` (no interactivo):
  - `nas skills clear [--scope] [--agent] [--dry-run]`.
  - Default scope = `all`.

### Fase 8: Skill injection en build

- [ ] **8.1** Implementar `skill-injection.ts`:
  - `readAgentSkillBlock(config, agentName)` — extraer `permission.skill` del
    agente en el config.
  - `findPermissionBlock(content)` — locate `permission:` y bounds de sus
    hijos indentados en el frontmatter.
  - `findStarAllowLine(content, block)` — locate `"*": allow` dentro del bloque.
  - `injectSkillBlock(content, rules)` — insertar o reemplazar el bloque
    `skill:` DESPUÉS de `"*": allow`. Si no hay `"*": allow`, al final del
    bloque `permission:`. Si `rules` está vacío, no inyecta nada.
  - `injectSkillPoliciesFromConfig(agentName, content, configPathOverride?)` —
    entry point para el build step: lee config, extrae reglas del agente,
    inyecta en el contenido.
- [ ] **8.2** Integrar en el build step:
  - Durante `nas build`, para cada agente, llamar a
    `injectSkillPoliciesFromConfig` con el contenido del agente.
  - El config path por defecto es `~/.config/opencode/opencode.json`,
    overridable con `NAS_OPENCODE_CONFIG_PATH` (para tests/CI).
  - Si el config no se puede leer o el agente no tiene reglas, el contenido
    se devuelve sin cambios.

### Fase 9: Integración final

- [ ] **9.1** Wire todos los subcomandos en el CLI principal (`index.ts`):
  - `agents` → `setup`, `list`, `profile` → `save|list|load|rename|delete`.
  - `skills` → `setup`, `list`, `add`, `remove`, `clear`.
  - Lazy imports para todos.
  - `default: 'list'` en `agents` y `skills` para que sin subcomando muestren
    la vista read-only.
- [ ] **9.2** Agregar tests unitarios para cada módulo puro (presenter,
  setup-core, skill-policies, config-safety, model-discovery, skill-discovery,
  profile-store, skill-injection).
- [ ] **9.3** Agregar tests de integración para los flujos completos (setup
  wizard, profile CRUD, skills mutate, build con skill injection).
- [ ] **9.4** Documentar en el README/AGENTS.md los comandos nuevos y su uso.
