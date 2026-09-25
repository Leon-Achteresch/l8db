export function searchParam(search: string, key: string): string {
  return new URLSearchParams(search).get(key) ?? "";
}

export function withSearchParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search);
  if (value.trim()) params.set(key, value.trim());
  else params.delete(key);
  const next = params.toString().replace(/\+/g, "%20");
  return next ? `?${next}` : "";
}

export function splitKeySecret(secret: string): { pem: string; passphrase: string } {
  const match = /-----END [^-]+-----/.exec(secret);
  if (!match) return { pem: secret, passphrase: "" };
  const cut = match.index + match[0].length;
  return { pem: secret.slice(0, cut), passphrase: secret.slice(cut).replace(/^[\r\n]+/, "") };
}

export function joinKeySecret(pem: string, passphrase: string): string {
  const trimmed = pem.trimEnd();
  if (!passphrase || !/-----END [^-]+-----$/.test(trimmed)) return pem;
  return `${trimmed}\n${passphrase}`;
}
