// What Spine on a computer gives Spine for iPhone: the address of the share
// server, the key for it, and a ChatGPT sign-in made for the phone alone. It
// travels as one line of text the reader copies on the computer and pastes on
// the phone, so it never passes through a server.
//
// OpenAI only finishes Sign in with ChatGPT on 127.0.0.1, which a web app on a
// phone can't receive, so the computer signs in on the phone's behalf. The
// sign-in is the phone's own, not the computer's: each renewal replaces the
// refresh token, so two devices can't share one.

export const PREFIX = 'spine-iphone:';

const FIELDS = ['clientId', 'hostId', 'accessToken', 'refreshToken', 'expiresAt'];

const toBase64url = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64url = text => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
};

export function encodeHandoff({ server, key, chatgpt }) {
  return PREFIX + toBase64url(JSON.stringify({ v: 1, server, key, chatgpt }));
}

// The handoff in text, or an error that says what to do.
export function decodeHandoff(text) {
  const found = String(text ?? '').match(/spine-iphone:([A-Za-z0-9_-]+)/);
  if (!found) throw new Error('That isn’t Spine’s sign-in. On your computer, open Spine’s settings and select Copy for your iPhone.');
  let handoff;
  try {
    handoff = JSON.parse(fromBase64url(found[1]));
  } catch {
    throw new Error('Part of the sign-in is missing. Copy it again on your computer.');
  }
  const chatgpt = handoff?.chatgpt;
  if (handoff?.v !== 1 || !chatgpt || FIELDS.some(field => !chatgpt[field])) {
    throw new Error('That sign-in is from another version of Spine. Copy it again on your computer.');
  }
  return { server: handoff.server || '', key: handoff.key || '', chatgpt };
}
