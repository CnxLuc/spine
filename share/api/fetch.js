// Fetching an article's page for Spine for iPhone, on Vercel. See lib/fetch.js.
import { fetchPage } from '../lib/fetch.js';

export default {
  fetch: request => fetchPage(request, { key: process.env.SHARE_KEY ?? '' }),
};
