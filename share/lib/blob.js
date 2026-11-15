// Shares in a private Vercel Blob store, one JSON file each. Only this server
// can read them, and it always reads the latest copy, so a changed or deleted
// share shows as soon as its page leaves the cache.
import { del, get, put } from '@vercel/blob';

const path = id => `shares/${id}.json`;
const write = (id, share, allowOverwrite) =>
  put(path(id), JSON.stringify(share), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite,
  });

export const blobStore = {
  async get(id) {
    const found = await get(path(id), { access: 'private', useCache: false });
    if (found?.statusCode !== 200) return null;
    return JSON.parse(await new Response(found.stream).text());
  },
  // Never over another share: a new id that's taken fails instead.
  create: (id, share) => write(id, share, false),
  put: (id, share) => write(id, share, true),
  delete: id => del(path(id)),
};
