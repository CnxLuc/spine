// The share server's one function, on Vercel. vercel.json sends /<id> here as
// ?page=<id>; everything else is /api/share. See lib/handler.js.
import { handle } from '../lib/handler.js';
import { blobStore } from '../lib/blob.js';

export default {
  fetch: request =>
    handle(request, {
      store: blobStore,
      key: process.env.SHARE_KEY ?? '',
      origin: process.env.SHARE_ORIGIN || null,
    }),
};
