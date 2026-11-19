// Sube uno o varios archivos .woff/.woff2 a Shopify Files y muestra su GenericFile ID.
// Uso: npm run font:upload -- fonts/MiFuente-Regular.woff2 fonts/MiFuente-Bold.woff2
import { uploadFontFile } from '../src/lib/files.js';

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!paths.length) {
  console.error('Uso: npm run font:upload -- <archivo.woff2> [otro.woff2 ...]');
  process.exit(1);
}

for (const p of paths) {
  process.stdout.write(`Subiendo ${p} ... `);
  const file = await uploadFontFile(p);
  console.log('OK');
  console.log(`  genericFileId: ${file.id}`);
  console.log(`  url:           ${file.url}`);
}
