# shopify-checkout-kit

Cliente ligero para el **Admin GraphQL API** de Shopify y scripts para cargar fuentes propias en **Checkout y Customer Accounts** con el [Checkout and Accounts Configuration API](https://shopify.dev/docs/apps/build/checkout/styling/checkout-and-accounts-configuration).

No tiene dependencias. Funciona con Node.js 20.6 o superior, que ya trae `fetch` y `--env-file`.

## Requisitos

- Tienda **Shopify Plus**, o tienda de desarrollo con acceso al editor de checkout y cuentas.
- Una app instalada con token del Admin API (`shpat_...`) y estos scopes:
  - `read_checkout_and_accounts_configurations` y `write_checkout_and_accounts_configurations` (o `read_checkout_settings` y `write_checkout_settings`)
  - `read_files` y `write_files`
- Fuentes en formato **.woff** o **.woff2**. Shopify no acepta otros formatos.

## Instalación

```bash
cp .env.example .env   # rellenar SHOPIFY_STORE_DOMAIN y SHOPIFY_ADMIN_ACCESS_TOKEN
npm run shop           # comprueba la conexión
```

## Cargar una fuente nueva en el checkout

1. **Crear una configuración para pruebas.** El API no tiene mutation de creación. Ve a *Admin > Configuración > Checkout > Personalizar* y duplica la configuración actual o crea una nueva **sin publicarla**.
2. **Obtener su ID:**
   ```bash
   npm run configs
   ```
3. **Copiar las fuentes** a `fonts/`, por ejemplo `fonts/MiFuente-Regular.woff2` y `fonts/MiFuente-Bold.woff2`.
4. **Editar `config/font.config.json`:**
   ```json
   {
     "configurationId": "gid://shopify/CheckoutAndAccountsConfiguration/123",
     "primary": {
       "loadingStrategy": "SWAP",
       "base": { "file": "fonts/MiFuente-Regular.woff2", "weight": 400 },
       "bold": { "file": "fonts/MiFuente-Bold.woff2", "weight": 700 }
     },
     "secondary": {
       "loadingStrategy": "SWAP",
       "base": { "file": "fonts/MiFuente-Regular.woff2", "weight": 400 },
       "bold": { "file": "fonts/MiFuente-Bold.woff2", "weight": 700 }
     },
     "size": { "base": 16, "ratio": 1.2 }
   }
   ```
   - `primary` se aplica al texto, los botones y los campos. `secondary` se aplica a los títulos.
   - Los dos grupos son opcionales. Si un grupo falta, no se modifica. `size` también es opcional.
   - Shopify exige `base` y `bold` en cada grupo. Si falta alguna variante, el script se detiene sin hacer cambios.
   - En lugar de `"file"` puedes usar `"genericFileId"` si la fuente ya está subida.
   - `weight` va de 100 a 900. `loadingStrategy` acepta `AUTO`, `BLOCK`, `FALLBACK`, `OPTIONAL` o `SWAP`.
5. **Revisar y aplicar:**
   ```bash
   npm run font:apply -- --dry-run   # muestra el input sin subir ni cambiar nada
   npm run font:apply                # sube las fuentes y actualiza la configuración
   npm run config:show               # comprueba el resultado
   ```
6. Revisa la vista previa en el editor de checkout y **publica la configuración desde el admin**.

### Seguridad

- `font:apply` **no modifica una configuración publicada**, porque el cambio se vería en vivo. Para hacerlo a propósito, añade `--allow-published`.
- Antes de cada cambio se guarda una copia del estado anterior en `config/backups/`.
- Si un archivo con el mismo nombre ya está en Shopify Files, se reutiliza. Para subirlo de nuevo, usa `--force-upload`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run shop` | Comprueba el token y muestra el plan de la tienda |
| `npm run configs` | Lista las configuraciones de Checkout y Accounts |
| `npm run config:show -- [id] [--json]` | Muestra la tipografía de una configuración |
| `npm run font:upload -- <archivo.woff2> ...` | Sube fuentes a Files y devuelve su `genericFileId` |
| `npm run font:apply -- [--dry-run] [--config ruta] [--force-upload] [--allow-published]` | Sube las fuentes y las aplica |
| `npm run font:apply -- --mode portal-branding --id <configId> [--shadow SMALL_200\|SMALL_100\|BASE\|LARGE_100\|LARGE_200] [--only-shadow] [--dry-run] [--allow-published] [--revert backup.json]` | Customer Accounts: secciones sin borde (`border: NONE`) y con sombra (`SMALL_100` por defecto); color de borde `#000000`. Con `--only-shadow` solo envía la sombra. No toca el checkout |
| `npm run gql -- '<query>' ['<vars JSON>']` | Ejecuta cualquier query o mutation (también acepta un archivo `.graphql`) |

## Usar el cliente en tu propio código

```js
import { shopify } from './src/lib/shopify-client.js';

const { shop } = await shopify.graphql(`query { shop { name } }`);

// mutate() lanza un error si la respuesta trae userErrors
await shopify.mutate(MUTATION, variables, 'nombreDelRootField');
```

El cliente reintenta solo cuando Shopify devuelve `THROTTLED`, 429 o 5xx.

## Estructura

```
src/lib/shopify-client.js   cliente GraphQL (auth, reintentos, userErrors)
src/lib/files.js            stagedUploadsCreate -> subida -> fileCreate -> espera a READY
src/lib/checkout-config.js  consulta y actualización de checkoutAndAccountsConfiguration
scripts/                    comandos de npm
config/font.config.json     qué fuente aplicar y en qué configuración
fonts/                      archivos .woff/.woff2 (ignorados por git)
```
