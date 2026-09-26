# PagaDios

Controlador de gastos familiares. Cuando alguien compra algo, el total se
reparte en partes iguales entre los participantes y el resto le "debe" su parte
al comprador. Incluye historial, balance por persona, saldar deudas y la
funcionalidad **Pagadios/Estafar** (perdonar deudas con notificaciones).

Es una SPA en HTML/CSS/JS vanilla (sin framework ni build step), pensada para
ser una **PWA** sobre **Firebase (Firestore + Google Auth)**.

> Estado actual: corre 100% con un **store en memoria** y datos mock, sin
> Firebase. Toda la lógica de negocio es pura y testeable offline.

## Funcionalidades

- Alta de compras: el total se reparte en partes iguales y se actualizan los saldos.
- Historial de compras con filtro por participante y paginación ("Cargar más").
- Lista de participantes de la sesión.
- Balance por persona: quién te debe y a quién le debés.
- **Saldar**: pago total o parcial de una deuda.
- **Pagadios / Estafar**:
  - El deudor puede pedir que le perdonen la deuda (botón *Estafar*); el acreedor acepta o rechaza y ambos reciben notificación.
  - El acreedor puede perdonar una deuda en cualquier momento (botón *Pagadios*); el perdonado recibe notificación.
  - Se acumulan los contadores por sesión `dinero_estafado` y `pagadios`.
- **Leaderboards** por sesión: Pagadios, El Estafado, El Gastador, El Peya (más compras) y El Ratatouille (el que más debe).
- Notificaciones in-app en tiempo real: **cada compra avisa a todos menos al comprador**.

## Cómo correr

No hay que instalar dependencias.

```bash
python3 -m http.server
```

Luego abrir `http://localhost:8000/index.html`. No funciona desde `file://`
porque usa módulos ES y, cuando se conecte Firebase, SDK importado por CDN.

Al abrir aparece un login mock para elegir con qué usuario entrar. Usá "Salir"
para cambiar de usuario y ver la deuda y las notificaciones desde cada lado.

## Tests

Tests offline con el runner nativo de Node (`node --test`), sin dependencias:

```bash
npm test          # o: node --test
```

En WSL, si `node` no está en el PATH, usar el binario de Windows:

```bash
"/mnt/c/Program Files/nodejs/node.exe" --test
```

Los tests viven en `test/*.test.js` y solo importan módulos puros de `src/`
(nunca APIs del navegador ni Firebase). Los helpers compartidos están en
`support/` para que el runner no los tome como tests.

## Estructura

```
index.html            Markup + routing de vistas (globals toggleSidebar/switchView)
styles.css            Todos los estilos (variables de tema en :root)
app.js                Entry del navegador: render desde la caché y eventos (datos mock)
src/sessionCache.js   Caché reactiva por (usuario, sesión): una suscripción por colección
src/model.js          Lógica de negocio pura (gastos, saldos, estafar, pagadios, leaderboards)
src/store.js          Store en memoria con la interfaz de Firestore
src/firestoreStore.js Adaptador de Firestore (misma interfaz, SDK por CDN)
src/money.js          Dinero en centavos: splitAmount / round2 / formatMoney
src/mockData.js       Usuarios, sesión y compras de demo
firestore.js          Init de Firebase (persistentLocalCache + multi-pestaña)
test/                 Suite de tests
support/              Helpers de test
```

## Arquitectura

La UI (`app.js`) **nunca consulta el store al renderizar**: lee del estado de
`src/sessionCache.js`, que abre una sola suscripción por colección y lo mantiene
en memoria. `src/model.js` no sabe de DOM ni de Firebase: opera sobre la
interfaz de `src/store.js`. Para pasar a Firestore alcanza con usar
`src/firestoreStore.js` en `app.js`; la lógica de negocio no se toca.

- `store.get/set/update/add/delete` + `query(collection, { where, orderBy, limit, startAfter })` — CRUD y consultas.
- `store.queryGroup(group, opts)` — collection groups (sesiones de un usuario).
- `store.batch()` + `increment()` / `serverTimestamp()` — escrituras sin lecturas.
- `store.runTransaction(fn)` — transacción optimista con reintento por conflicto.
- `store.subscribe/subscribeQuery/subscribeGroup` — listeners tipo `onSnapshot`.

### Tráfico (Firestore)

Diseñado para consumir lo mínimo:

- Render sin lecturas: la UI sale de la caché, no del servidor.
- `addExpense` escribe con `batch` + `increment` (0 lecturas) y actualiza los
  agregados `total_gastado` / `compras_count` de la sesión y del miembro.
- Historial y notificaciones con `limit`/`startAfter` (paginado); el badge de no
  leídas sale del contador `usuarios/{uid}.notif_no_leidas`.
- Persistencia offline multi-pestaña (`persistentLocalCache`) para no
  re-descargar documentos sin cambios.

## Modelo de datos (Firestore-ready)

- `usuarios/{uid}` — perfil + contador `notif_no_leidas`.
- `sesiones/{sesionId}` — sesión + agregados `total_gastado` / `compras_count`.
- `sesiones/{sid}/miembros/{uid}` — membresía con contadores `dinero_estafado` / `pagadios` y agregados `total_gastado` / `compras_count`.
- `sesiones/{sid}/compras/{id}` — compra.
- `sesiones/{sid}/saldos/{idA_idB}` — balance entre dos personas.
- `sesiones/{sid}/pagos/{id}` — pagos (saldar).
- `sesiones/{sid}/solicitudes/{id}` — pedidos de estafa / perdones aplicados.
- `usuarios/{uid}/notificaciones/{id}` — notificaciones in-app.
- `codigos/{codigo}` → `{ sesionId }` — invitación / unirse.

## Convención de saldos (importante)

- El id del saldo es `${sortedIds[0]}_${sortedIds[1]}` con los ids ordenados
  alfabéticamente, para que A→B y B→A impacten el mismo documento.
- `balance_neto_A_vs_B > 0` significa que **B le debe a A**; `< 0` que **A le debe a B**.
- Para derivar direcciones usar los helpers `netOwedTo`, `owedBy` y `forgivenessEffect`
  de `src/model.js`, no calcular signos a mano.
- El dinero se maneja en centavos (`src/money.js`) para evitar errores de punto
  flotante; `splitAmount` reparte el resto para que la suma sea exacta.

## Próximo paso: Firebase

1. Cargar la config real en `firestore.js`.
2. En `app.js`, crear el store con `createFirestoreStore()` en vez de
   `createMemoryStore()` (y quitar el seed de mock).
3. Google Auth + refrescar la caché al iniciar/cerrar sesión.
4. PWA: `manifest.json`, service worker e íconos.
5. Reglas de seguridad e índices. Tener en cuenta que la compra y los perdones
   escriben notificaciones/contadores de otros miembros de la sesión. Índices
   compuestos necesarios: `compras(pagado_por, fecha desc)` y
   `solicitudes(para, estado)`.

## Notas

- Textos y comentarios en español (Argentina).
- Los archivos están en CRLF en disco mientras git guarda LF, así que los
  diffs de archivo completo son normales; evitar reformateos masivos.
- SDK de Firebase fijado en `10.8.0` (mantener versiones sincronizadas).
