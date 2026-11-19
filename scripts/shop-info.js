// Verifica la conexión y muestra datos básicos de la tienda.
import { shopify } from '../src/lib/shopify-client.js';

const data = await shopify.graphql(/* GraphQL */ `
  query { shop { name myshopifyDomain plan { displayName shopifyPlus } } }
`);
console.log(`Conectado a ${shopify.endpoint}`);
console.table(data.shop);
if (!data.shop.plan?.shopifyPlus) {
  console.warn('Aviso: la personalización de checkout requiere Shopify Plus (o una tienda de desarrollo con acceso).');
}
