// Muestra la tipografía actual de una configuración.
// Uso: npm run config:show -- <configurationId>   (si se omite, usa config/font.config.json)
import { readFile } from 'node:fs/promises';
import { getConfiguration, describeTypography } from '../src/lib/checkout-config.js';

let id = process.argv[2];
if (!id) {
  const cfg = JSON.parse(await readFile(new URL('../config/font.config.json', import.meta.url), 'utf8'));
  id = cfg.configurationId;
}
if (!id) throw new Error('Indica un configurationId: npm run config:show -- <id>');

const config = await getConfiguration(id);
console.log(describeTypography(config));
if (process.argv.includes('--json')) console.log(JSON.stringify(config, null, 2));
