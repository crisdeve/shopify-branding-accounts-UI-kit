/**
 * Subida de archivos a Shopify Files (stagedUploadsCreate -> upload -> fileCreate).
 * Pensado para fuentes .woff / .woff2, que Shopify guarda como GenericFile.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { shopify } from './shopify-client.js';

const MIME_TYPES = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = /* GraphQL */ `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on GenericFile { url mimeType }
      }
      userErrors { field message code }
    }
  }
`;

const FILE_STATUS = /* GraphQL */ `
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on GenericFile {
        id
        fileStatus
        url
        mimeType
        fileErrors { code message details }
      }
    }
  }
`;

const FIND_FILES = /* GraphQL */ `
  query FindFiles($query: String!) {
    files(first: 10, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        fileStatus
        createdAt
        ... on GenericFile { url mimeType }
      }
    }
  }
`;

/**
 * Sube un archivo de fuente local y devuelve el GenericFile listo (status READY).
 * @param {string} filePath ruta local a .woff o .woff2
 * @param {{ alt?: string }} [opts]
 * @returns {Promise<{ id: string, url: string, fileStatus: string }>}
 */
export async function uploadFontFile(filePath, { alt } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext];
  if (!mimeType) {
    throw new Error(`Formato no soportado "${ext}". Shopify solo acepta .woff y .woff2 para fuentes de checkout.`);
  }

  const filename = path.basename(filePath);
  const { size } = await stat(filePath);
  const buffer = await readFile(filePath);

  // 1. Pedir un destino de subida temporal
  const staged = await shopify.mutate(
    STAGED_UPLOADS_CREATE,
    {
      input: [
        {
          resource: 'FILE',
          filename,
          mimeType,
          httpMethod: 'POST',
          fileSize: String(size),
        },
      ],
    },
    'stagedUploadsCreate',
  );
  const target = staged.stagedTargets[0];

  // 2. Subir el binario al destino (multipart form, el archivo va al final)
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const uploadRes = await fetch(target.url, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    throw new Error(`Falló la subida a ${target.url} (HTTP ${uploadRes.status}): ${(await uploadRes.text()).slice(0, 500)}`);
  }

  // 3. Registrar el archivo en Shopify Files
  const created = await shopify.mutate(
    FILE_CREATE,
    {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: 'FILE',
          filename,
          alt: alt ?? filename,
        },
      ],
    },
    'fileCreate',
  );

  // 4. Esperar a que Shopify procese el archivo
  return waitForFileReady(created.files[0].id);
}

/** Hace polling hasta que el archivo esté READY (o falle). */
export async function waitForFileReady(id, { timeoutMs = 60_000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { node } = await shopify.graphql(FILE_STATUS, { id });
    if (!node) throw new Error(`No se encontró el archivo ${id}`);
    if (node.fileStatus === 'READY') return node;
    if (node.fileStatus === 'FAILED') {
      throw new Error(`Shopify no pudo procesar ${id}: ${JSON.stringify(node.fileErrors)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout esperando a que ${id} quede READY`);
}

/** Busca GenericFiles ya subidos por nombre (útil para no subir dos veces). */
export async function findFilesByName(filename) {
  const { files } = await shopify.graphql(FIND_FILES, { query: `filename:${JSON.stringify(filename)}` });
  return files.nodes.filter((n) => n.id?.includes('GenericFile'));
}
