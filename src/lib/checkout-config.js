/**
 * Helpers para el Checkout and Accounts Configuration API.
 * https://shopify.dev/docs/apps/build/checkout/styling/checkout-and-accounts-configuration
 *
 * Una "configuración" agrupa el branding de Checkout + Customer Accounts + Sign in.
 * Shopify no expone una mutation para crearlas: se crean/duplican desde el editor
 * (Configuración > Checkout > Personalizar) y aquí se modifican por API.
 */
import { shopify } from './shopify-client.js';

const FONT_GROUP_FIELDS = /* GraphQL */ `
  __typename
  ... on CheckoutAndAccountsConfigurationBrandingCustomFontGroup {
    loadingStrategy
    base { genericFileId weight sources }
    bold { genericFileId weight sources }
  }
  ... on CheckoutAndAccountsConfigurationBrandingShopifyFontGroup {
    name
    loadingStrategy
  }
`;

const TYPOGRAPHY_FIELDS = /* GraphQL */ `
  typography {
    primary { ${FONT_GROUP_FIELDS} }
    secondary { ${FONT_GROUP_FIELDS} }
    size { base ratio }
  }
`;

const LIST_CONFIGURATIONS = /* GraphQL */ `
  query ListConfigurations($first: Int!, $after: String) {
    checkoutAndAccountsConfigurations(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        isPublished
        createdAt
        updatedAt
      }
    }
  }
`;

const GET_CONFIGURATION = /* GraphQL */ `
  query GetConfiguration($id: ID!) {
    checkoutAndAccountsConfiguration(id: $id) {
      id
      name
      isPublished
      updatedAt
      branding {
        designTokens {
          ${TYPOGRAPHY_FIELDS}
        }
      }
    }
  }
`;

const UPDATE_CONFIGURATION = /* GraphQL */ `
  mutation UpdateConfiguration($id: ID!, $configuration: CheckoutAndAccountsConfigurationInput!) {
    checkoutAndAccountsConfigurationUpdate(id: $id, configuration: $configuration) {
      configuration {
        id
        name
        isPublished
        branding {
          designTokens {
            ${TYPOGRAPHY_FIELDS}
          }
        }
      }
      userErrors { field message code }
    }
  }
`;

export async function listConfigurations() {
  const all = [];
  let after = null;
  do {
    const { checkoutAndAccountsConfigurations: page } = await shopify.graphql(LIST_CONFIGURATIONS, { first: 50, after });
    all.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return all;
}

export async function getConfiguration(id) {
  const { checkoutAndAccountsConfiguration } = await shopify.graphql(GET_CONFIGURATION, { id: toConfigGid(id) });
  if (!checkoutAndAccountsConfiguration) throw new Error(`No existe la configuración ${id}`);
  return checkoutAndAccountsConfiguration;
}

/** Aplica un CheckoutAndAccountsConfigurationInput (merge parcial). */
export async function updateConfiguration(id, configuration) {
  const payload = await shopify.mutate(
    UPDATE_CONFIGURATION,
    { id: toConfigGid(id), configuration },
    'checkoutAndAccountsConfigurationUpdate',
  );
  return payload.configuration;
}

// ---------------------------------------------------------------------------
// Branding de Customer Accounts (bordes y sombra de secciones). Solo toca
// surfaces.customerAccounts: el checkout no cambia.
// ---------------------------------------------------------------------------

const PORTAL_BRANDING_READ = /* GraphQL */ `
  query GuawPortalBrandingRead($id: ID!) {
    checkoutAndAccountsConfiguration(id: $id) {
      id name isPublished
      branding { surfaces { customerAccounts { components { main {
        colors { base { border } }
        section { shadow border colors { base { border } } }
      } } } } }
    }
  }
`;

const PORTAL_BRANDING_UPDATE = /* GraphQL */ `
  mutation GuawPortalBranding($id: ID!, $configuration: CheckoutAndAccountsConfigurationInput!) {
    checkoutAndAccountsConfigurationUpdate(id: $id, configuration: $configuration) {
      configuration { id name isPublished }
      userErrors { field message code }
    }
  }
`;

/** Lee id, name, isPublished y los valores de borde/sombra de Customer Accounts. */
export async function getPortalBranding(id) {
  const { checkoutAndAccountsConfiguration: c } = await shopify.graphql(PORTAL_BRANDING_READ, { id: toConfigGid(id) });
  if (!c) throw new Error(`No existe la configuración ${id}`);
  return c;
}

/** Extrae { mainBorder, sectionShadow, sectionBorder } de la respuesta de getPortalBranding (null si no hay valor). */
export function portalBrandingValues(config) {
  const main = config?.branding?.surfaces?.customerAccounts?.components?.main;
  return {
    mainBorder: main?.colors?.base?.border ?? null,
    sectionShadow: main?.section?.shadow ?? null,
    sectionBorder: main?.section?.colors?.base?.border ?? null,
    sectionBorderMode: main?.section?.border ?? null,
  };
}

/** Construye el CheckoutAndAccountsConfigurationInput para Customer Accounts > main. */
export function portalBrandingInput({ mainBorder, sectionShadow, sectionBorder, sectionBorderMode }) {
  return {
    branding: { surfaces: { customerAccounts: { components: { main: {
      colors: { base: { border: mainBorder } },
      section: { shadow: sectionShadow, border: sectionBorderMode, colors: { base: { border: sectionBorder } } },
    } } } } },
  };
}

/** Ejecuta la mutation y devuelve el payload completo (configuration + userErrors) sin lanzar por userErrors. */
export async function updatePortalBranding(id, configuration) {
  const data = await shopify.graphql(PORTAL_BRANDING_UPDATE, { id: toConfigGid(id), configuration });
  return data.checkoutAndAccountsConfigurationUpdate;
}

/** Acepta "123" o el GID completo. */
export function toConfigGid(id) {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/CheckoutAndAccountsConfiguration/${s}`;
}

/**
 * Construye el input de un customFontGroup.
 * @param {{ base: {genericFileId:string, weight:number}, bold: {genericFileId:string, weight:number}, loadingStrategy?: string }} group
 */
export function customFontGroupInput({ base, bold, loadingStrategy }) {
  return {
    customFontGroup: {
      base: { genericFileId: base.genericFileId, weight: Number(base.weight) },
      bold: { genericFileId: bold.genericFileId, weight: Number(bold.weight) },
      ...(loadingStrategy ? { loadingStrategy } : {}),
    },
  };
}

/** Imprime la tipografía de una configuración de forma legible. */
export function describeTypography(config) {
  const t = config?.branding?.designTokens?.typography;
  const lines = [`${config.name}  (${config.id})${config.isPublished ? '  [PUBLICADA]' : ''}`];
  if (!t) return [...lines, '  (sin tipografía personalizada; usa los valores por defecto)'].join('\n');
  for (const key of ['primary', 'secondary']) {
    const g = t[key];
    if (!g) {
      lines.push(`  ${key}: (por defecto)`);
    } else if (g.__typename.endsWith('CustomFontGroup')) {
      lines.push(
        `  ${key}: fuente personalizada (${g.loadingStrategy ?? 'AUTO'})`,
        `    base: ${g.base?.genericFileId} peso ${g.base?.weight}`,
        `    bold: ${g.bold?.genericFileId} peso ${g.bold?.weight}`,
      );
    } else {
      lines.push(`  ${key}: fuente Shopify "${g.name}" (${g.loadingStrategy ?? 'AUTO'})`);
    }
  }
  if (t.size) lines.push(`  size: base ${t.size.base}px, ratio ${t.size.ratio}`);
  return lines.join('\n');
}
