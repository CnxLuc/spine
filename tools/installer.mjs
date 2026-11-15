// The connector installers the website serves: connect.sh for Mac and Linux,
// with the connector (native/spine-host.sh) inside it, and connect.ps1 for
// Windows, with the connector's source (native/SpineHost.cs) inside it. Both
// carry the ids of every Spine allowed to use the connector.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// An extension's id, from the public key in its manifest.
export const idOf = key =>
  [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
    .map(digit => String.fromCharCode(97 + parseInt(digit, 16)))
    .join('');

// The downloaded Spine, whose id the manifest's key fixes, and the Chrome Web
// Store one once it exists (store/STORE_ID).
export async function extensionIds() {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const ids = [idOf(manifest.key)];
  const storeId = await readFile('store/STORE_ID', 'utf8').then(text => text.trim(), () => '');
  if (/^[a-p]{32}$/.test(storeId)) ids.push(storeId);
  return ids;
}

export async function installer(ids) {
  const host = await readFile('native/spine-host.sh', 'utf8');
  return (await readFile('tools/connect.sh', 'utf8'))
    .replace('__SPINE_HOST_SH__', () => host.trimEnd())
    .replace('__SPINE_EXTENSION_IDS__', () => ids.join(' '));
}

export async function windowsInstaller(ids) {
  const source = await readFile('native/SpineHost.cs', 'utf8');
  // A PowerShell here-string ends at a line starting with '@.
  if (/^'@/m.test(source)) throw new Error('native/SpineHost.cs has a line starting with \'@');
  return (await readFile('tools/connect.ps1', 'utf8'))
    .replace('__SPINE_HOST_CS__', () => source.trimEnd())
    .replace('__SPINE_EXTENSION_IDS_PS__', () => ids.map(id => `'${id}'`).join(', '));
}
