/**
 * Cliente mínimo para el Admin GraphQL API de Shopify.
 *
 * Lee la configuración de las variables de entorno:
 *   SHOPIFY_STORE_DOMAIN        mi-tienda.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  shpat_...
 *   SHOPIFY_API_VERSION         2026-10 (opcional)
 *
 * Uso:
 *   import { shopify } from './shopify-client.js';
 *   const data = await shopify.graphql(`query { shop { name } }`);
 */

const DEFAULT_API_VERSION = '2026-10';
const MAX_RETRIES = 5;

export class ShopifyGraphQLError extends Error {
  constructor(message, { errors, userErrors, response } = {}) {
    super(message);
    this.name = 'ShopifyGraphQLError';
    this.errors = errors;
    this.userErrors = userErrors;
    this.response = response;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createShopifyClient({
  storeDomain = process.env.SHOPIFY_STORE_DOMAIN,
  accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  apiVersion = process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION,
} = {}) {
  if (!storeDomain || !accessToken) {
    throw new Error(
      'Faltan variables de entorno: SHOPIFY_STORE_DOMAIN y SHOPIFY_ADMIN_ACCESS_TOKEN. ' +
        'Copia .env.example a .env y complétalo.',
    );
  }

  const domain = storeDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const endpoint = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

  /**
   * Ejecuta una query/mutation. Reintenta automáticamente si Shopify
   * responde THROTTLED o 429/5xx.
   */
  async function graphql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ShopifyGraphQLError(`Respuesta no JSON (HTTP ${res.status}): ${text.slice(0, 500)}`);
      }

      if (!res.ok) {
        throw new ShopifyGraphQLError(
          `HTTP ${res.status}: ${JSON.stringify(body.errors ?? body)}`,
          { errors: body.errors, response: body },
        );
      }

      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyGraphQLError(
          body.errors.map((e) => e.message).join('\n'),
          { errors: body.errors, response: body },
        );
      }

      return body.data;
    }
  }

  /**
   * Igual que graphql(), pero además lanza error si el payload de la
   * mutation (data[rootField]) trae userErrors.
   */
  async function mutate(query, variables, rootField) {
    const data = await graphql(query, variables);
    const payload = data[rootField];
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length) {
      throw new ShopifyGraphQLError(
        `${rootField} userErrors:\n` +
          userErrors.map((e) => `  - [${(e.field ?? []).join('.')}] ${e.message}${e.code ? ` (${e.code})` : ''}`).join('\n'),
        { userErrors, response: data },
      );
    }
    return payload;
  }

  return { graphql, mutate, endpoint, apiVersion, storeDomain: domain };
}

let _client;
/** Cliente singleton construido desde process.env (se crea al primer uso). */
export const shopify = new Proxy(
  {},
  {
    get(_t, prop) {
      _client ??= createShopifyClient();
      return _client[prop];
    },
  },
);
