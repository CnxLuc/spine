// A stand-in for OpenAI's Sign in with ChatGPT and Responses API, for testing
// Spine's ChatGPT reading without an OpenAI account. It serves:
//
//   /article                               a long article to open Spine on
//   /api/accounts/authorize                a consent page with Allow and Cancel
//   /api/accounts/oauth/token              codes and refresh tokens, PKCE checked
//   /.well-known/openid-configuration      the revocation address
//   /oauth/revoke                          signing out
//   /v1/models, /v1/responses              the models and streamed replies
//
// Everything it receives is kept in `seen`, for the tests to look at.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const base64url = value => Buffer.from(value).toString('base64url');
const SCOPE = 'chatgpt.tokens.use.direct email offline_access openid profile resource.invoke';
const CLIENT = 'oaiapp_test';

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>On reading long things</title></head><body>
<article><h1>On reading long things</h1><p class="byline">By A. Writer</p>
${Array.from(
  { length: 3 },
  (_, section) => `<h2>${['Why we stop', 'What a good essay does', 'Seeing the spine first'][section]}</h2>
${Array.from(
  { length: 4 },
  (_, paragraph) => `<p>${Array.from(
    { length: 5 },
    (_, sentence) =>
      `This is sentence ${sentence + 1} of paragraph ${paragraph + 1} in part ${section + 1}, and it carries one small idea about reading that the next sentence builds on.`,
  ).join(' ')}</p>`,
).join('\n')}`,
).join('\n')}
</article></body></html>`;

// What each kind of request gets back: notes with every third sentence as a
// key sentence, no list ideas, and a bridge for every fold.
function replyFor(name, input) {
  if (name === 'notes') {
    const ids = [...input.matchAll(/\b(s\d+)(?: \[lead\])?: /g)].map(match => match[1]);
    return { keySentences: ids.filter((_, at) => at % 3 === 0), collapseFolds: [], sections: [], chapters: [] };
  }
  if (name === 'lists') return { groupings: [], carousels: [] };
  const runs = [...input.matchAll(/^Run (\d+)$/gm)].map(match => Number(match[1]));
  return { bridges: runs.map(run => ({ run, text: 'And so the thread carries on.' })) };
}

export async function startFakeOpenAI() {
  const state = { seen: { authorize: [], token: [], revoke: [], models: 0, responses: [] }, limit: false, codes: new Map() };
  const body = request =>
    new Promise(resolve => {
      let data = '';
      request.on('data', chunk => (data += chunk));
      request.on('end', () => resolve(data));
    });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const send = (status, value, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
      response.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    const issuer = state.issuer;

    if (url.pathname === '/article') return send(200, ARTICLE, 'text/html; charset=utf-8');

    if (url.pathname === '/api/accounts/authorize') {
      const params = Object.fromEntries(url.searchParams);
      state.seen.authorize.push(params);
      const code = `code-${state.codes.size + 1}`;
      state.codes.set(code, params);
      const back = new URL(params.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('scope', SCOPE);
      back.searchParams.set('state', params.state);
      if (params.client_id === 'dynamic_agent_client') back.searchParams.set('client_id', CLIENT);
      const cancel = new URL(params.redirect_uri);
      cancel.searchParams.set('error', 'access_denied');
      cancel.searchParams.set('state', params.state);
      return send(
        200,
        `<!doctype html><title>Sign in to ChatGPT</title><h1>${params.agent_name_hint ?? 'Your app'} wants to use your ChatGPT plan</h1>
<a id="allow" href="${back.href}">Allow</a> <a id="cancel" href="${cancel.href}">Cancel</a>`,
        'text/html; charset=utf-8',
      );
    }

    if (url.pathname === '/api/accounts/oauth/token' && request.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await body(request)));
      state.seen.token.push(form);
      if (form.client_id !== CLIENT) return send(400, { error: 'invalid_client' });
      let nonce;
      if (form.grant_type === 'authorization_code') {
        const asked = state.codes.get(form.code);
        const challenge = createHash('sha256').update(form.code_verifier ?? '').digest('base64url');
        if (!asked || asked.code_challenge !== challenge || asked.redirect_uri !== form.redirect_uri) {
          return send(400, { error: 'invalid_grant' });
        }
        state.codes.delete(form.code);
        nonce = asked.nonce;
      } else if (form.grant_type === 'refresh_token') {
        if (!String(form.refresh_token).startsWith('rt-')) return send(400, { error: 'invalid_grant' });
      } else return send(400, { error: 'unsupported_grant_type' });
      const serial = state.seen.token.length;
      const claims = { iss: issuer, aud: CLIENT, sub: 'user-1', email: 'reader@example.com', name: 'Reader', nonce, exp: Math.floor(Date.now() / 1000) + 3600 };
      return send(200, {
        access_token: `at-${serial}`,
        refresh_token: `rt-${serial}`,
        id_token: `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(claims))}.sig`,
        token_type: 'Bearer',
        expires_in: state.expiresIn ?? 3600,
        scope: SCOPE,
      });
    }

    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, { issuer, revocation_endpoint: `${issuer}/oauth/revoke` });
    }
    if (url.pathname === '/oauth/revoke' && request.method === 'POST') {
      state.seen.revoke.push(Object.fromEntries(new URLSearchParams(await body(request))));
      return send(200, '', 'text/plain');
    }

    const bearer = /^Bearer at-\d+$/.test(request.headers.authorization ?? '');
    if (url.pathname === '/v1/models') {
      state.seen.models++;
      if (!bearer) return send(401, { error: { code: 'invalid_api_key' } });
      return send(200, {
        models: [
          { slug: 'gpt-fast', display_name: 'GPT Fast', visibility: 'list' },
          { slug: 'gpt-careful', display_name: 'GPT Careful', visibility: 'list' },
          { slug: 'gpt-internal', display_name: 'Internal', visibility: 'hide' },
        ],
      });
    }

    if (url.pathname === '/v1/responses' && request.method === 'POST') {
      const payload = JSON.parse(await body(request));
      state.seen.responses.push(payload);
      if (!bearer) return send(401, { error: { code: 'invalid_api_key' } });
      if (state.ineligible) {
        return send(403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'Not eligible.' } });
      }
      if (state.limit) {
        return send(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached.' } });
      }
      // What OpenAI turns down for plan usage.
      if (payload.store !== false || payload.stream !== true || payload.input?.some(item => item.role === 'system') || 'temperature' in payload) {
        return send(400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'request' } });
      }
      const name = payload.text?.format?.name;
      const text = JSON.stringify(replyFor(name, payload.input?.[0]?.content ?? ''));
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      event({ type: 'response.created', response: { model: payload.model } });
      for (let at = 0; at < text.length; at += 24) {
        event({ type: 'response.output_text.delta', delta: text.slice(at, at + 24) });
        await new Promise(done => setTimeout(done, 4));
      }
      event({ type: 'response.completed', response: { model: payload.model, usage: { input_tokens: 100, output_tokens: 50 } } });
      return response.end();
    }

    send(404, { error: 'not found' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  state.issuer = url;
  return {
    url,
    get seen() {
      return state.seen;
    },
    set limit(value) {
      state.limit = value;
    },
    set ineligible(value) {
      state.ineligible = value;
    },
    set expiresIn(value) {
      state.expiresIn = value;
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
