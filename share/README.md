# Spine’s share server

The share server keeps shared articles and shows each one at a short address, in Spine’s reader. It is two Vercel functions, with shares in a private Vercel Blob store. Spine’s own runs at read-with-spine.vercel.app.

It also serves Spine for iPhone, the web app at `/app`, from [src/app](../src/app) and [share/app](app). The app fetches articles through `/api/fetch`, because a web page can’t fetch other sites itself.

## How a share works

1. In the reader, the share menu sends the server the article as Spine found it, with its notes and the owner’s key.
2. The server keeps the share and answers with a link, such as `https://read-with-spine.vercel.app/Ab3dEf7h`.
3. The link opens Spine’s own reader on a plain page. The reader builds the article from the copy in the page, as the extension builds it from the original, and applies the notes when they fit the text. No one reads the article again.

The page checks every block of the article against the shape Spine’s rebuilder gives it, in [src/content/clean.js](../src/content/clean.js). Pages also run no script but the reader’s own. A share cannot run code, whatever it carries.

Pages stay in Vercel’s cache for a minute at most. A changed or deleted share shows within 2 minutes.

## Requests

Every request to `/api/share` and `/api/fetch` needs the key, as `Authorization: Bearer <key>`. Pages need nothing.

| Request | What it does |
| --- | --- |
| `POST /api/share` | Makes a link for the share in the body |
| `PUT /api/share?id=…` | Shows a new share at the same link |
| `DELETE /api/share?id=…` | Deletes the share, so the link stops working |
| `GET /api/share` | Checks a key |
| `GET /api/share?id=…` | Checks that a link still works |
| `GET /<id>` | Shows the shared article |
| `GET /api/fetch?url=…` | Fetches a web page for Spine for iPhone, after redirects, and says where it ended up. It refuses addresses inside a private network and pages over 6 MB |
| `GET /app/` | Spine for iPhone |

## Run your own

From the repository’s root:

1. Run `npm install --prefix share`.
2. Run `node share/build.mjs` to build the shared page into `share/public/reader` and Spine for iPhone into `share/public/app`.
3. In `share`, run `vercel link`, then `vercel blob create-store <name> --access private` to make a private store for the shares.
4. Run `vercel env add SHARE_KEY production` and give it a key of at least 16 characters. To fix the address links use, set `SHARE_ORIGIN` the same way.
5. Run `vercel deploy --prod` in `share`.
6. In Spine’s settings, under Advanced, set Share server to your address and Share key to your key.

Build the page again before each deploy, so pages load the reader you deploy.

## Test

Run `node build.mjs --test && node share/build.mjs --test && node test/share-check.mjs`. The check runs the server on your computer and shares 4 real articles whose notes are saved in `test/.profile`, as the other reader checks do. It opens each link in a browser without Spine and checks that every lens shows exactly what the extension shows. It also checks phones, link previews, sharing again, deleting, the key, and a share that carries scripts.

`node test/app-check.mjs` checks Spine for iPhone the same way, with a stand-in for OpenAI. Spine’s settings sign in for the iPhone. The app takes the sign-in, adds an article by its link and reads it, in Chromium and in WebKit at iPhone size.
