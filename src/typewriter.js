const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Types `lines` into `el` one character at a time with a blinking cursor.
// The cursor is removed when done, unless `keepCursor` is set.
export async function typeLines(el, lines, { charDelay, lineDelay, punctuationDelay, keepCursor = false }) {
  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  for (const line of lines) {
    const p = document.createElement('p');
    p.className = 'line';
    el.append(p);
    p.append(cursor);
    // Keep the line being typed on screen for long messages.
    p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    for (const ch of line) {
      cursor.before(ch);
      // Long paragraphs wrap onto new rows; keep the cursor in view as they grow.
      if (ch === ' ' && cursor.getBoundingClientRect().bottom > window.innerHeight * 0.75) {
        cursor.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      await wait(charDelay + ('.,!?'.includes(ch) ? punctuationDelay : 0));
    }
    await wait(lineDelay);
  }

  if (!keepCursor) cursor.remove();
}
