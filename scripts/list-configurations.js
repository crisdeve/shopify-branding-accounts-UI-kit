// Lista las configuraciones de Checkout y Accounts de la tienda.
import { listConfigurations } from '../src/lib/checkout-config.js';

const configs = await listConfigurations();
if (!configs.length) {
  console.log('No hay configuraciones. Crea una desde Admin > Configuración > Checkout > Personalizar.');
} else {
  console.table(configs.map((c) => ({ id: c.id, name: c.name, publicada: c.isPublished, actualizada: c.updatedAt })));
}
