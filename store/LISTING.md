# Chrome Web Store listing

Everything to paste into the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), field by field. Upload `releases/spine-store-1.2.0.zip`, the zip without the development key.

After the first upload, the dashboard shows Spine’s item ID. Put it in `store/STORE_ID` and run `node build.mjs`, then publish `docs/`: the Claude Code and Codex connector then allows the store’s Spine too.

## Store listing tab

Title (from the manifest): Spine

Summary (from the manifest, 117 characters):

> A calm reading layer for long writing. Key sentences come forward, asides fold away, sections fold under short notes.

Description:

```
Spine turns a long article into a calm, distraction-free reader, and uses ChatGPT or Claude to find the sentences that carry it. You choose how much of the text you see.

• Read: everything, as written, in clean type with the article's images.
• Skim: scroll, and the key sentences stay while the rest fades. Stop, and it all comes back.
• Supercut: everything but the key sentences folds into small pills, each with a short line in the author's voice. Rest on a pill to open it.
• Outline: each long section folds under a short note. Long essays without headings get chapters.

Spine never replaces the author's words. Every note is in the author's voice, using their words where it can, and the full text is always one hover away.

It also offers other ways to group a list, shows chunky lists as cards, keeps your place, and copies the supercut or outline as Markdown or saves it to Obsidian.

HOW TO USE IT
Open any article and press Alt+Shift+S (⌥⇧S on a Mac), or select Spine's toolbar button. Press 1 to 4 to switch lens, and ? for every shortcut.

WHO READS, AND WHAT IT COSTS
Spine is free. The first time you open it on an article, it asks who reads:
• ChatGPT, on your Plus or Pro plan, with nothing extra to pay: sign in once, right in the reader.
• Claude Code or Codex on your computer, on your Claude or ChatGPT plan: Spine shows you one command to connect them, and never sees your sign-in.
• An Anthropic API key, billed to your API credits. With Claude Opus 5.5, a short post costs about 6¢ and a long essay about 62¢, once per article. Spine shows the cost before it reads and asks first above $1.

Without either, Spine is still a calm reader view.

PRIVACY
Spine has no servers and collects nothing for its developer. When you agree, it sends the text of the articles you open to the reader you chose: ChatGPT, your Claude Code or Codex, or Anthropic with your key. Your sign-in, key, notes and settings stay in your browser.

CREDITS
Spine's reading ideas come from Tareq Ismail's Reading Long Form, episode 2 of Interfaces that think. Spine is open source under the MIT licence.
```

Category: Productivity, then Tools

Language: English

Store icon: `static/icons/icon-128.png`

Screenshots (1280 × 800), in this order:

1. `store/assets/screenshot-1-skim.png`
2. `store/assets/screenshot-2-supercut.png`
3. `store/assets/screenshot-3-outline.png`
4. `store/assets/screenshot-4-lists.png`
5. `store/assets/screenshot-5-yours.png`

Small promo tile (440 × 280): `store/assets/promo-small-440x280.png`

Marquee promo tile (1400 × 560): `store/assets/promo-marquee-1400x560.png`

Official URL: none

Homepage URL: https://cnxluc.github.io/spine/

Support URL: https://github.com/CnxLuc/spine/issues

Mature content: no

## Privacy tab

Single purpose description:

> Spine is a reader view for long articles. It shows the article on the current page in a clean layout and uses an AI the user chooses (ChatGPT on their own plan, their own Claude Code or Codex, or Claude with their own API key) to bring the key sentences forward, fold the rest and write a short note for each section.

Permission justifications:

| Permission | Justification |
| --- | --- |
| activeTab | Spine reads the article on the tab where the user opens it, only when they select Spine’s button, use its shortcut or choose Read with Spine from the right-click menu. |
| scripting | Adds Spine’s reader to the current tab when the user opens it there. Spine does not run on any page until the user asks. |
| storage | Keeps the user’s settings, their Anthropic API key, the notes written for articles they read, and their place in each, in the browser. |
| unlimitedStorage | Saved notes for up to 400 articles can exceed the default storage limit. Keeping them means reopening an article is instant and costs nothing. |
| contextMenus | Adds Read with Spine to the page’s right-click menu. |
| nativeMessaging | Connects to Spine’s optional connector, which the user installs themselves, so their own Claude Code or Codex on their computer can read articles on their own plan. Spine never sees their sign-in. |
| Host permission: https://api.anthropic.com/* | Sends the article the user chose to read to Anthropic’s API, with the user’s own key, so Claude can choose the key sentences and write the notes. |
| Host permission: https://api.openai.com/* | Sends the article the user chose to read to OpenAI’s Responses API, under the user’s own ChatGPT plan, after they sign in with ChatGPT. |
| Host permission: https://auth.openai.com/* | Completes Sign in with ChatGPT: exchanges the sign-in for tokens, renews them, and revokes them when the user signs out. |
| Host permission: http://127.0.0.1/* | OpenAI requires open-source apps to receive Sign in with ChatGPT at an address on the user’s own computer. Spine watches its sign-in window reach that address, reads the result and closes the window. It never sends anything to 127.0.0.1. |

Remote code: No, I am not using remote code. All JavaScript is in the package.

Data usage, what the extension collects:

- Website content: yes. The text of the article the user chooses to read, sent to the reader they chose to make the notes, after they agree in the extension: their own Claude Code or Codex on their computer (which send it to Anthropic or OpenAI under the user’s own plan), or Anthropic’s API.
- Authentication information: yes. The user’s own Anthropic API key, sent only to Anthropic, and the tokens OpenAI issues when they sign in with ChatGPT, sent only to OpenAI. Both are stored in the browser, to authorise the user’s own requests.
- Personally identifiable information: yes. The name and email address of the ChatGPT account the user signs in with, kept in the browser to show which account is signed in. Spine sends them nowhere.
- Everything else (health, financial, personal communications, location, web history, user activity): no.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item’s single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://cnxluc.github.io/spine/privacy.html

## Distribution tab

Payments: free

Visibility: Unlisted, to start. Anyone with the link can install Spine, but it doesn’t appear in search. Switch to Public when you’re happy with it.

Regions: all regions

## Test instructions tab

> Spine's AI features need a reader: ChatGPT (sign in with a ChatGPT Plus or Pro account, from the card Spine shows on the first article), the user's own Claude Code or Codex connected with Spine's installer, or an Anthropic API key. Without one, it still works as a reader view. To test: open https://paulgraham.com/greatwork.html, select Spine’s toolbar button (or press Alt+Shift+S), and switch between Read and the other lenses at the bottom. To try the AI features, select Continue with ChatGPT in the card Spine shows on the first article and sign in with a ChatGPT Plus or Pro account, or add an Anthropic API key in Spine's settings; the key sentences light up within about 30 seconds.
