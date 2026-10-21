import { randomUUID } from "node:crypto";

/**
 * Storage object keys are SERVER-GENERATED: {documentId}/v{n}/{uuid}.{ext}.
 * The original filename never touches the path, so traversal, unicode
 * trickery or collisions in Storage are impossible by construction.
 * (document_versions has a CHECK that the path lives under its own document.)
 */
export function buildStoragePath(
  documentId: string,
  versionNo: number,
  extension: string
): string {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new Error("buildStoragePath: invalid document id");
  }
  if (!Number.isInteger(versionNo) || versionNo < 1) {
    throw new Error("buildStoragePath: invalid version number");
  }
  if (!/^[a-z0-9]{1,10}$/.test(extension)) {
    throw new Error("buildStoragePath: invalid extension");
  }
  return `${documentId}/v${versionNo}/${randomUUID()}.${extension}`;
}
