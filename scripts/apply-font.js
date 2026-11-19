// Sube las fuentes definidas en config/font.config.json (si hace falta) y las
// aplica a la configuración de Checkout y Accounts indicada.
//
// Uso:
//   npm run font:apply                       aplica config/font.config.json
//   npm run font:apply -- --config otra.json usa otro archivo
//   npm run font:apply -- --dry-run          muestra el input sin subir ni aplicar nada
//   npm run font:apply -- --force-upload     vuelve a subir aunque ya exista un archivo con ese nombre
//   npm run font:apply -- --allow-published  permite modificar una configuración PUBLICADA (en vivo)
//
// Modo branding de Customer Accounts (secciones sin borde y con sombra, SMALL_100 o --shadow; el checkout no cambia):
//   npm run font:apply -- --mode portal-branding --id <configId> [--shadow NIVEL] [--only-shadow] [--dry-run] [--allow-published]
//   npm run font:apply -- --mode portal-branding --id <configId> --revert config/backups/<archivo>.json
// Para ver los ids: npm run configs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadFontFile, findFilesByName } from '../src/lib/files.js';
import {
  getConfiguration,
  updateConfiguration,
  customFontGroupInput,
  describeTypography,
  toConfigGid,
  getPortalBranding,
  portalBrandingValues,
  portalBrandingInput,
  updatePortalBranding,
} from '../src/lib/checkout-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY_RUN = flag('--dry-run');
const FORCE_UPLOAD = flag('--force-upload');
const ALLOW_PUBLISHED = flag('--allow-published');
const configPath = path.resolve(ROOT, opt('--config') ?? 'config/font.config.json');
const MODE = opt('--mode') ?? 'font';

if (MODE === 'portal-branding') {
  process.exit(await runPortalBranding());
} else if (MODE !== 'font') {
  console.error(`--mode desconocido "${MODE}". Usa "font" (por defecto) o "portal-branding".`);
  process.exit(1);
}

const LOADING_STRATEGIES = ['AUTO', 'BLOCK', 'FALLBACK', 'OPTIONAL', 'SWAP'];

const cfg = JSON.parse(await readFile(configPath, 'utf8'));
if (!cfg.configurationId) {
  throw new Error(`"configurationId" vacío en ${configPath}. Ejecuta "npm run configs" para ver los IDs disponibles.`);
}
if (!cfg.primary && !cfg.secondary && !cfg.size) {
  throw new Error('Define al menos "primary", "secondary" o "size" en el archivo de configuración.');
}

// Cache para no subir dos veces el mismo archivo (p.ej. mismo .woff2 en primary y secondary)
const uploaded = new Map();

/** Resuelve { file | genericFileId, weight } -> { genericFileId, weight } */
async function resolveFont(font, label) {
  if (!font) throw new Error(`Falta "${label}"`);
  const weight = Number(font.weight);
  if (!Number.isInteger(weight) || weight < 100 || weight > 900) {
    throw new Error(`${label}.weight debe ser un entero entre 100 y 900 (recibido: ${font.weight})`);
  }
  if (font.genericFileId) return { genericFileId: font.genericFileId, weight };
  if (!font.file) throw new Error(`${label} necesita "file" (ruta .woff/.woff2) o "genericFileId"`);

  const filePath = path.resolve(ROOT, font.file);
  if (!existsSync(filePath)) throw new Error(`${label}: no existe el archivo ${font.file}`);
  if (uploaded.has(filePath)) return { genericFileId: uploaded.get(filePath), weight };

  if (DRY_RUN) {
    uploaded.set(filePath, `<se subirá ${font.file}>`);
    return { genericFileId: uploaded.get(filePath), weight };
  }

  let id;
  if (!FORCE_UPLOAD) {
    const [existing] = (await findFilesByName(path.basename(filePath))).filter((f) => f.fileStatus === 'READY');
    if (existing) {
      id = existing.id;
      console.log(`  ${label}: reutilizando ${path.basename(filePath)} -> ${id}`);
    }
  }
  if (!id) {
    process.stdout.write(`  ${label}: subiendo ${font.file} ... `);
    id = (await uploadFontFile(filePath)).id;
    console.log(id);
  }
  uploaded.set(filePath, id);
  return { genericFileId: id, weight };
}

async function resolveGroup(group, label) {
  if (!group) return undefined;
  if (group.loadingStrategy && !LOADING_STRATEGIES.includes(group.loadingStrategy)) {
    throw new Error(`${label}.loadingStrategy inválido. Usa uno de: ${LOADING_STRATEGIES.join(', ')}`);
  }
  // Shopify exige base y bold en cada grupo.
  for (const variant of ['base', 'bold']) {
    if (!group[variant]) {
      throw new Error(
        `Falta "${label}.${variant}". Shopify exige las variantes base y bold, por ejemplo:\n` +
          `  "${variant}": { "file": "fonts/MiFuente-${variant === 'bold' ? 'Bold' : 'Regular'}.woff2", "weight": ${variant === 'bold' ? 700 : 400} }`,
      );
    }
  }
  return customFontGroupInput({
    base: await resolveFont(group.base, `${label}.base`),
    bold: await resolveFont(group.bold, `${label}.bold`),
    loadingStrategy: group.loadingStrategy,
  });
}

// 1. Validar la configuración destino
const current = await getConfiguration(cfg.configurationId);
console.log('Configuración destino (estado actual):');
console.log(describeTypography(current));
console.log();

if (current.isPublished && !ALLOW_PUBLISHED && !DRY_RUN) {
  console.error(
    'La configuración está PUBLICADA: los cambios se verán en vivo en el checkout.\n' +
      'Usa una configuración sin publicar para probar, o vuelve a ejecutar con --allow-published.',
  );
  process.exit(1);
}

// 2. Resolver/subir fuentes
console.log(DRY_RUN ? 'Fuentes (dry-run):' : 'Fuentes:');
const typography = {};
const primary = await resolveGroup(cfg.primary, 'primary');
const secondary = await resolveGroup(cfg.secondary, 'secondary');
if (primary) typography.primary = primary;
if (secondary) typography.secondary = secondary;
if (cfg.size) typography.size = { base: Number(cfg.size.base), ratio: Number(cfg.size.ratio) };

const input = { branding: { designTokens: { typography } } };

if (DRY_RUN) {
  console.log('\nInput que se enviaría a checkoutAndAccountsConfigurationUpdate:');
  console.log(JSON.stringify({ id: current.id, configuration: input }, null, 2));
  process.exit(0);
}

// 3. Backup del estado anterior
const backupDir = path.join(ROOT, 'config', 'backups');
await mkdir(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `${current.id.split('/').pop()}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(backupFile, JSON.stringify(current, null, 2));
console.log(`\nBackup del estado anterior: ${path.relative(ROOT, backupFile)}`);

// 4. Aplicar
const updated = await updateConfiguration(current.id, input);
console.log('\nConfiguración actualizada:');
console.log(describeTypography(updated));
console.log('\nRevisa el resultado en Admin > Configuración > Checkout > Personalizar (vista previa).');

// ---------------------------------------------------------------------------
// Modo --mode portal-branding
// ---------------------------------------------------------------------------
async function runPortalBranding() {
  const SHADOWS = ['SMALL_200', 'SMALL_100', 'BASE', 'LARGE_100', 'LARGE_200'];
  const shadow = opt('--shadow') ?? 'SMALL_100';
  if (!SHADOWS.includes(shadow)) {
    console.error(`--shadow inválido "${shadow}". Usa uno de: ${SHADOWS.join(', ')}`);
    return 1;
  }
  // Secciones sin borde (section.border: NONE) y con sombra.
  const TARGET = { mainBorder: '#000000', sectionShadow: shadow, sectionBorder: '#000000', sectionBorderMode: 'NONE' };
  const id = opt('--id');
  const revertPath = opt('--revert');
  if (!id || id.startsWith('--')) {
    console.error('Falta --id <configId>. Ejecuta "npm run configs" para ver los IDs disponibles.');
    return 1;
  }

  // 1. Leer valores actuales
  const current = await getPortalBranding(id);
  const before = portalBrandingValues(current);
  console.log(`Configuración: ${current.name}  (${current.id})${current.isPublished ? '  [PUBLICADA]' : ''}`);
  console.log('Valores actuales de Customer Accounts > main:');
  console.log(JSON.stringify(before, null, 2));

  // 2. Valores a aplicar: destino o los del backup indicado con --revert
  let values = TARGET;
  if (revertPath) {
    const backup = JSON.parse(await readFile(path.resolve(ROOT, revertPath), 'utf8'));
    if (backup.id !== toConfigGid(id)) {
      console.error(`El backup es de ${backup.id}, no de ${toConfigGid(id)}.`);
      return 1;
    }
    values = portalBrandingValues(backup);
    console.log(`\nRevirtiendo a los valores de ${revertPath}.`);
  }
  // --only-shadow: envía solo section.shadow; bordes y colores quedan como estén.
  const input = flag('--only-shadow')
    ? { branding: { surfaces: { customerAccounts: { components: { main: { section: { shadow: values.sectionShadow } } } } } } }
    : portalBrandingInput(values);

  if (current.isPublished && !ALLOW_PUBLISHED && !DRY_RUN) {
    console.error(
      '\nLa configuración está PUBLICADA: los cambios se verán en vivo en Customer Accounts.\n' +
        'Usa una copia sin publicar, o vuelve a ejecutar con --allow-published.',
    );
    return 1;
  }

  if (DRY_RUN) {
    console.log('\nInput que se enviaría a checkoutAndAccountsConfigurationUpdate:');
    console.log(JSON.stringify({ id: current.id, configuration: input }, null, 2));
    return 0;
  }

  // 3. Backup del estado anterior (sirve para --revert)
  const backupDir = path.join(ROOT, 'config', 'backups');
  await mkdir(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `${current.id.split('/').pop()}-portal-branding-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(backupFile, JSON.stringify(current, null, 2));
  console.log(`\nBackup del estado anterior: ${path.relative(ROOT, backupFile)}`);

  // 4. Aplicar
  const payload = await updatePortalBranding(current.id, input);
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length) {
    console.error('\nuserErrors:');
    for (const e of userErrors) {
      console.error(`  - [${(e.field ?? []).join('.')}] ${e.message}${e.code ? ` (${e.code})` : ''}`);
    }
    return 1;
  }

  const after = portalBrandingValues(await getPortalBranding(current.id));
  console.log(`\nConfiguración actualizada: ${payload.configuration.name} (${payload.configuration.id})`);
  console.log(JSON.stringify(after, null, 2));
  console.log(`\nPara revertir: npm run font:apply -- --mode portal-branding --id ${current.id} --revert ${path.relative(ROOT, backupFile)}`);
  console.log('Revisa el resultado en Admin > Configuración > Checkout > Personalizar (vista previa de Customer Accounts).');
  return 0;
}
