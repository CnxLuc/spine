# Chrome Web Store listing

Everything to paste into the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), field by field. Upload `releases/spine-1.0.0.zip`.

## Store listing tab

Title (from the manifest): Spine

Summary (from the manifest, 117 characters):

> A calm reading layer for long writing. Key sentences come forward, asides fold away, sections fold under short notes.

Description:

```
Spine turns a long article into a calm, distraction-free reader, and uses Claude to find the sentences that carry it. You choose how much of the text you see.

• Read: everything, as written, in clean type with the article's images.
• Skim: scroll, and the key sentences stay while the rest fades. Stop, and it all comes back.
• Supercut: everything but the key sentences folds into small pills, each with a short line in the author's voice. Rest on a pill to open it.
• Outline: each long section folds under a short note. Long essays without headings get chapters.

Spine never replaces the author's words. Everything Claude writes is in the author's voice, using their words where it can, and the full text is always one hover away.

It also offers other ways to group a list, shows chunky lists as cards, keeps your place, and copies the supercut or outline as Markdown or saves it to Obsidian.

HOW TO USE IT
Open any article and press Alt+Shift+S (⌥⇧S on a Mac), or select Spine's toolbar button. Press 1 to 4 to switch lens, and ? for every shortcut.

WHAT IT COSTS
Spine is free. Claude's reading is billed by Anthropic to your own API credits, using your own API key from platform.claude.com. API credits are separate from a Claude.ai Pro or Max subscription, which can't pay for Spine.

Claude reads each article once and Spine saves the notes, so reading it again is free. With Claude Opus 5.5, a short post costs about 6¢ and a long essay about 62¢. Claude Sonnet 5.5 costs half that, Claude Haiku 4.5 a quarter. Spine shows the cost before it reads, asks first above $1, and keeps a running total in its settings.

Without a key, Spine is still a calm reader view.

PRIVACY
Spine has no servers and collects nothing for its developer. When you agree, it sends the text of the articles you open straight to Anthropic, using your key. Your key, notes and settings stay in your browser.

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

> Spine is a reader view for long articles. It shows the article on the current page in a clean layout and uses Claude, with the user's own API key, to bring the key sentences forward, fold the rest and write a short note for each section.

Permission justifications:

| Permission | Justification |
| --- | --- |
| activeTab | Spine reads the article on the tab where the user opens it, only when they select Spine’s button, use its shortcut or choose Read with Spine from the right-click menu. |
| scripting | Adds Spine’s reader to the current tab when the user opens it there. Spine does not run on any page until the user asks. |
| storage | Keeps the user’s settings, their Anthropic API key, the notes Claude wrote for articles they read, and their place in each, in the browser. |
| unlimitedStorage | Saved notes for up to 400 articles can exceed the default storage limit. Keeping them means reopening an article is instant and costs nothing. |
| contextMenus | Adds Read with Spine to the page’s right-click menu. |
| Host permission: https://api.anthropic.com/* | Sends the article the user chose to read to Anthropic’s API, with the user’s own key, so Claude can choose the key sentences and write the notes. This is the extension’s only network request. |

Remote code: No, I am not using remote code. All JavaScript is in the package.

Data usage, what the extension collects:

- Website content: yes. The text of the article the user chooses to read, sent to Anthropic’s API to make the notes, after the user agrees in the extension.
- Authentication information: yes. The user’s own Anthropic API key, stored in the browser and sent only to Anthropic to authorise their requests.
- Everything else (personally identifiable information, health, financial, personal communications, location, web history, user activity): no.

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

> Spine's Claude features need an Anthropic API key, billed to the key owner's API credits. Without one, it still works as a reader view. To test: open https://paulgraham.com/greatwork.html, select Spine’s toolbar button (or press Alt+Shift+S), and switch between Read and the other lenses at the bottom. With a key, add it on the settings page that opens on install, accept the prompt to read with Claude, and wait about 30 seconds for the key sentences to light up.
