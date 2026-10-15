/** Display branding only. Persisted identities and protocol names stay compatible. */
export const BRAND_NAME = "Haunt";
export const brandAsset = (name: string) =>
  `${import.meta.env.BASE_URL}brand/${name}`;
export const BRAND_FAVICON = brandAsset("favicon-32.png");
