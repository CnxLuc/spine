# Spine

Spine is a reading layer for long writing, in Aside or any Chromium browser. It turns an article into a calm reader view, keeps its images, and uses ChatGPT or Claude to find the sentences that carry the piece. You choose how much of the text you see: all of it, the key sentences with the rest folded away, or a short note for each section.

The reading ideas come from Tareq Ismail’s [Reading Long Form prototype](https://github.com/onepixelaway/interfaces-that-think/tree/main/reading-long-form), episode 2 of [Interfaces that think](https://tareqistyping.com/interfaces-that-think/). Spine takes them from one essay to any article on the web.

## Install Spine

Download [spine.zip](https://github.com/CnxLuc/spine/releases/latest/download/spine.zip) from the latest release, then:

1. Double-click the file to unzip it.
2. Type `chrome://extensions` in your browser’s address bar and turn on Developer mode, top right.
3. Select Load unpacked and choose the unzipped `spine` folder. Keep the folder: your browser loads Spine from it.

Spine works in Chrome, Arc, Brave, Edge, Dia and Aside. Open it on any article and it asks who reads (see [Choose who reads](#choose-who-reads)). A Chrome Web Store listing is on its way; it will update Spine for you.

Read more at [cnxluc.github.io/spine](https://cnxluc.github.io/spine/).

## Open Spine on an article

Press ⌥⇧S on any article, or use Spine’s toolbar button, or right-click the page and choose Read with Spine. Press Esc to close it. The page underneath stays as it was.

Spine opens straight away with the article as plain, readable text. ChatGPT or Claude then reads it once, which takes 15 to 60 seconds, and the key sentences light up as they are chosen. The notes are saved in your browser, so opening the article again is instant and free.

## Choose how much of the text to see

The dock at the bottom has 4 lenses, each with its reading time:

- Read shows everything, as written
- Skim shows everything, but while you scroll the key sentences stay and the rest fades to a quarter; it comes back when you stop
- Supercut keeps only the key sentences and folds the rest into small pills, each with a short line in the author’s voice; rest on a pill to open it, click to pin it open
- Outline folds each long section under a 1 to 3 sentence note; click a note to open its section

Articles without headings get chapters that Claude suggests. Their titles show only in the outline and in the list beside the text, marked ✦.

Switching lens keeps your place: the sentence at the top of the screen stays there.

## Read lists another way

Above a list that could be grouped differently, a sentence names how the author ordered it, for example “These reasons are organized from leverage to tone”. Rest on the dropdown to choose another grouping, such as “by how sure I am”. Lists with long items can also show as cards you slide through, each with an icon. Turn cards on from the ✦ panel.

## Other things you can do

- Hold ⌥ to see the key sentences without scrolling.
- Use the outline on the left (wide windows) to jump between sections. Rest on a section to read its note.
- Change theme, font, size, column width and line spacing from the Aa panel.
- Copy the supercut, the outline or the whole article as Markdown, or save the outline and supercut to Obsidian as a new note.
- Close Spine and open it again later: it picks up where you left off.

## Keyboard shortcuts

| Keys | What they do |
| --- | --- |
| ⌥⇧S | Open or close Spine |
| 1 2 3 4 | Read, Skim, Supercut, Outline |
| [ and ] | Show more or less of the text |
| ⌥ (hold) | See the key sentences without scrolling |
| E | Open or fold everything in Supercut and Outline |
| J and K | Next or previous section |
| O | Show or hide the outline beside the text |
| T | Next theme |
| − and + | Smaller or larger text |
| ? | All shortcuts |
| Esc | Close a panel, or close Spine |

## Choose who reads

The first time you open Spine on an article, it asks who should read it, right in the reader: ChatGPT or Claude Code, on a plan you already pay for. Choose one and reading starts as soon as it’s connected. You can also choose in Spine’s settings, or use an Anthropic API key. Without any, Spine still works as a reader view.

### ChatGPT, on your Plus or Pro plan

Select Continue with ChatGPT. A small window opens where you allow Spine to use your ChatGPT plan, and Spine starts reading as soon as you’re back. There is nothing to install, on any computer. Reading counts toward your plan’s usage limits; see or cap Spine’s share in [your ChatGPT usage settings](https://chatgpt.com/settings/usage).

Spine uses OpenAI’s [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). OpenAI sends the sign-in window back to an address on your own computer, 127.0.0.1, which Spine watches for, so nothing has to listen there. Spine keeps the sign-in in its own storage in your browser, which websites and the script Spine adds to them can’t read, and sends it only to OpenAI. To sign out, select Sign out in Spine’s settings, or disconnect Spine in your ChatGPT settings.

### Claude Code or Codex, on your own plan

If you use [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex), Spine can read with it, on your Claude or ChatGPT plan, with nothing extra to pay. Reading counts toward your plan’s usage limits, like any other use. Select Use Claude Code and Spine shows you the command below, then starts reading as soon as it’s connected.

1. Make sure Claude Code or Codex is installed and signed in: run `claude` or `codex` once in Terminal.
2. Connect Spine to it with one command, on macOS or Linux:

   ```sh
   curl -fsSL https://cnxluc.github.io/spine/connect.sh | bash
   ```

3. Open Spine’s settings. They show which tools are connected and signed in.

The command installs a small program, `native/spine_host.py`, and registers it with every Chromium browser on your computer. Your browser starts it when Spine asks for a reading, and only Spine may start it. It runs your own, unmodified `claude -p` or `codex exec`, signed in as you, then exits. Spine never sees or stores your Claude or ChatGPT sign-in, and nothing runs in the background. To remove it, run the same command with `bash -s -- --uninstall`.

When several are ready, Spine uses Claude Code, then ChatGPT, then Codex, unless you choose in settings.

### An Anthropic API key

1. Get a key at [platform.claude.com](https://platform.claude.com/settings/keys).
2. Open Spine’s settings (right-click Spine’s toolbar button and choose Options).
3. Choose An Anthropic API key, paste the key and select Test.

Claude’s reading is billed by Anthropic to your own API credits, which you buy separately from a Claude.ai Pro or Max subscription. With Claude Opus 5.5, the default, a short post costs about 6¢ and a long essay about 62¢, once: the notes are saved, so reading it again is free. Claude Sonnet 5.5 costs half that and Claude Haiku 4.5 a quarter. Spine shows the cost of each article before it reads and asks first above $1, which you can change in settings.

## What leaves your browser

Nothing, until you agree to have articles read. Spine asks once, before it sends anything. Then it sends the text of each article you open to whichever reader you chose: OpenAI’s API under your ChatGPT plan, Claude Code or Codex on your computer, which send it on to Anthropic or OpenAI under your plan, or Anthropic’s API with your key. Choosing a reader in the first-run card is that agreement: the card says what Spine sends. Spine keeps the notes in your browser. Your key and your ChatGPT sign-in stay in Spine’s extension storage and are only sent to Anthropic and OpenAI. You can turn this off in Spine’s settings. Read the [privacy policy](https://cnxluc.github.io/spine/privacy.html).

## How Spine works

1. Spine finds the article with Mozilla’s Readability, then rebuilds it from an allowlist of elements, so nothing from the page runs and every article arrives in the same shape.
2. It splits each paragraph, list item and quotation into sentences, and numbers them.
3. It asks for notes in 3 requests, through ChatGPT, Claude Code, Codex or the API. The first streams the key sentences, the supercut and the section notes. The second, run at the same time, finds other groupings for lists. The third writes the bridges for the folds as soon as the key sentences are settled, split into up to 3 parallel requests.
4. It checks every note against the article and drops anything that does not fit, then saves the notes with a fingerprint of the article’s sentences.

Each lens then only changes classes on the numbered sentences, which is why switching is instant.

Through ChatGPT, requests go to OpenAI’s Responses API with structured outputs, using the first model your plan lists unless you choose another in settings, at medium reasoning effort for the notes and low for the rest. Through the API, requests to Claude Opus 5.5 and Sonnet 5.5 use adaptive thinking at medium effort, and server-side fallback if Claude’s safeguards decline an article. Through Claude Code they run as `claude -p` at medium effort, with no tools; through Codex as `codex exec` in a read-only sandbox, ignoring your own Codex settings so it uses your plan’s default model.

## Build and test Spine

You need Node 22 or later.

```sh
npm install
node build.mjs             # builds the extension into dist/
node build.mjs --release   # also zips it for release, into releases/
```

Load `dist/` with Load unpacked on your browser’s extensions page, with developer mode on. After a change, run `node build.mjs` again and reload Spine on the extensions page.

Tests:

```sh
node --test test/*.test.mjs            # unit tests: sentences, notes, folds
node build.mjs --test                  # a build the browser tests can drive
node test/look.mjs <url> [name]        # screenshots of Spine on a page
node test/ai.mjs <url> [name] [--engine=claude-code|codex]   # reads a page with your Claude Code or Codex
node --test test/native.test.mjs       # the connector, against fake claude and codex
node test/local-check.mjs              # Spine finding Claude Code and Codex
node test/onboard.mjs                  # the first-run card and ChatGPT sign-in, against a stand-in for OpenAI
node test/tour.mjs <url> [name]        # each lens, panel and theme, as screenshots
node test/interact.mjs                 # keyboard, hover, rail and resume checks
node test/extras.mjs                   # narrow window, lightbox and copying
```

Never load `.test-build/` in your own browser: it can open Spine on any page without a click.

| File | What it does |
| --- | --- |
| `src/background.js` | Opens Spine on a tab and streams Claude’s replies |
| `src/shared/prompts.js` | The instructions for Claude and the shapes of its replies |
| `src/content/extract.js` | Finds the article and rebuilds it as clean blocks |
| `src/content/article.js` | Lays out sections and wraps every sentence |
| `src/content/reader.js` | Lenses, panels, shortcuts and saved places |
| `src/content/supercut.js` | What folds, the pills, hovering and bridges |
| `src/content/outline.js` | Section notes, chapters and the outline beside the text |
| `src/content/lists.js` | Regrouped lists and cards |
| `src/content/ai.js` | The 3 requests, applied as they stream, and saving |
| `src/content/notes.js` | Checks Claude’s notes against the article |
| `src/content/styles.css` | Every colour, font and timing |
| `src/chatgpt.js` | Sign in with ChatGPT, and reading on a ChatGPT plan |
| `src/content/onboard.js` | The card that asks who reads, the first time |
| `native/spine_host.py` | The connector your browser starts to run Claude Code or Codex |
| `tools/connect.sh` | The installer for the connector; the build puts it on the website |
| `docs/` | The website, with the privacy policy, served by GitHub Pages |
| `store/` | The Chrome Web Store listing text, images and the scripts that make them |

## Credits and licences

Spine is under the MIT licence. It adapts code and prompts from Tareq Ismail’s Reading Long Form, also under the MIT licence; see `LICENSE`. Newsreader is by Production Type, under the SIL Open Font License. The icons are from Lucide, under the ISC licence. Readability is by Mozilla, under the Apache License 2.0.
