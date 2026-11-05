/* eslint-disable @next/next/no-img-element */
export function PrintIssuer({ issuer }: { issuer: { displayName: string; requisites: string | null; logoDocumentId: string | null } | null }) {
  if (!issuer) return null;
  return <header><strong>{issuer.displayName}</strong>{issuer.logoDocumentId ? <img alt="Логотип" src={`/api/v1/documents/${issuer.logoDocumentId}/download`} /> : null}{issuer.requisites ? <p className="whitespace-pre-wrap">{issuer.requisites}</p> : null}</header>;
}
