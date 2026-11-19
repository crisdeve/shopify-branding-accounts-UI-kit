// Ejecuta cualquier query/mutation contra el Admin API.
// Uso:
//   npm run gql -- 'query { shop { name } }'
//   npm run gql -- ./queries/mi-query.graphql '{"first": 5}'
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { shopify } from '../src/lib/shopify-client.js';

const [input, vars = '{}'] = process.argv.slice(2);
if (!input) {
  console.error("Uso: npm run gql -- '<query>' | <archivo.graphql> ['<variables JSON>']");
  process.exit(1);
}
const query = existsSync(input) ? await readFile(input, 'utf8') : input;
const data = await shopify.graphql(query, JSON.parse(vars));
console.log(JSON.stringify(data, null, 2));
