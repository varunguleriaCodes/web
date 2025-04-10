/// <reference types="chrome" />

/**
 * Currently, Penumbra manifests are expected to be chrome extension manifest
 * v3.  This type just requires a few fields of ManifestV3 that apps might use
 * to display provider information to the user.
 *
 * @see https://developer.chrome.com/docs/extensions/reference/manifest#keys
 *
 * For chrome extensions, the extension `id` will be the host of the extension
 * origin. The `id` is added to the manifest by the chrome store, so will be
 * missing from a locally-built extension in development. Developers may
 * configure a public `key` field to ensure the `id` field matches in
 * development builds, but `id` will still not be present in the manifest.
 *
 * If necessary, `id` could be calculated from your key.
 *
 * @see https://web.archive.org/web/20120606044635/http://supercollider.dk/2010/01/calculating-chrome-extension-id-from-your-private-key-233
 */
export type PenumbraManifestJson = chrome.runtime.ManifestV3 & {
  [k in 'name' | 'version' | 'description' | 'icons']-?: NonNullable<chrome.runtime.ManifestV3[k]>;
};

type IconBlobs = { '128': Blob } & Partial<Record<`${number}`, Blob>>;

// export interface PenumbraManifest extends Record<string, unknown> {
//   name: string;
//   version: string;
//   description: string;
//   icons: IconBlobs;
// }

export type PenumbraManifest = {
  [k in keyof PenumbraManifestJson]: k extends 'icons' ? IconBlobs : PenumbraManifestJson[k];
};

export const isPenumbraManifestJson = (mf: unknown): mf is PenumbraManifestJson =>
  mf !== null &&
  typeof mf === 'object' &&
  'name' in mf &&
  typeof mf.name === 'string' &&
  'version' in mf &&
  typeof mf.version === 'string' &&
  'description' in mf &&
  typeof mf.description === 'string' &&
  'icons' in mf &&
  typeof mf.icons === 'object' &&
  mf.icons !== null &&
  '128' in mf.icons &&
  typeof mf.icons['128'] === 'string';
