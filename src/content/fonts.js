// Newsreader, loaded into the page's font set under a name no page uses. Fonts
// from buffers aren't fetched, so a page's content security policy can't block
// them. urlOf gives each file's address: inside the extension, or beside a
// shared page.
export async function loadFonts(urlOf) {
  if ([...document.fonts].some(face => face.family === 'Spine Newsreader')) return;
  const faces = [
    ['fonts/Newsreader.ttf', 'normal'],
    ['fonts/Newsreader-Italic.ttf', 'italic'],
  ];
  await Promise.all(
    faces.map(async ([file, style]) => {
      try {
        const buffer = await (await fetch(urlOf(file))).arrayBuffer();
        const face = new FontFace('Spine Newsreader', buffer, { style, weight: '200 800', display: 'swap' });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn('Spine couldn’t load its font', error);
      }
    }),
  );
}
