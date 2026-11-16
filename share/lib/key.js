// Whether a request carries the owner's key. Only the owner makes, changes and
// deletes links, and only the owner's phone asks the server to fetch pages.
import { timingSafeEqual } from 'node:crypto';

export function authorized(request, key) {
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const wanted = Buffer.from(key ?? '');
  return wanted.length >= 16 && given.length === wanted.length && timingSafeEqual(given, wanted);
}
