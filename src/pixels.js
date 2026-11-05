// Shared palette for all pixel-art icons.
const PALETTE = {
  D: '#5f3460', // outline purple
  M: '#690f44', // shadow maroon
  C: '#f8f1a9', // highlight cream
  Y: '#fedb5c', // body yellow
  P: '#e896c2', // edge pink
  W: '#fffdf4', // paper white
};

// Turns a grid of characters (one per pixel) into an SVG string.
function pixelSvg(rows) {
  const rects = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (PALETTE[ch]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[ch]}"/>`);
    });
  });
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects.join('')}</svg>`;
}

// Folder, 26 x 23.
export const folderSvg = () =>
  pixelSvg([
    '....DDDDDDD...............',
    '...DCCCCCCCD..............',
    '..DCYPYPYPYPD.............',
    '.DCYPYPYPYPPDDDDDDDDDDDDD.',
    'DCCCCCCCCCCCCCCCCCCCCCCCPD',
    ...Array(16).fill('DCYYYYYYYYYYYYYYYYYYYYYYPM'),
    'DCPPPPPPPPPPPPPPPPPPPPPPPM',
    '.MMMMMMMMMMMMMMMMMMMMMMMM.',
  ]);

// Question mark, 18 x 20.
export const questionSvg = () =>
  pixelSvg([
    '....DDDDDDDD......',
    '...DDCCCCCCDD.....',
    '..DDCYYPPYYCDD....',
    '..DCYYPDDCYYCDM...',
    '..DCYPDDDDCYPDM...',
    '..DCPPDMMDCYPDM...',
    '..DDDDDMDDCYPDM...',
    '...MMMMDDCYYPDM...',
    '......DDCYYPDDM...',
    '......DCYYPDDMM...',
    '......DCYPDDMM....',
    '......DCPPDMM.....',
    '......DDDDDM......',
    '.......MMMMM......',
    '......DDDDD.......',
    '......DCCCDM......',
    '......DCYPDM......',
    '......DCPPDM......',
    '......DDDDDM......',
    '.......MMMMM......',
  ]);

// Heart, 9 x 8.
export const heartSvg = () =>
  pixelSvg([
    '.DD...DD.',
    'DPPD.DPPD',
    'DPCPDPPPD',
    'DPPPPPPPD',
    '.DPPPPPD.',
    '..DPPPD..',
    '...DPD...',
    '....D....',
  ]);

// Diary (pink cover, heart, label, pages), 18 x 23.
export const diarySvg = () =>
  pixelSvg([
    '.DDDDDDDDDDDDDDD..',
    '.DMDPPPPPPPPPPPD..',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPDDPDDPPPWD.',
    '.DMDPPDCCDCCDPPWD.',
    '.DMDPPDCCCCCDPPWD.',
    '.DMDPPPDCCCDPPPWD.',
    '.DMDPPPPDCDPPPPWD.',
    '.DMDPPPPPDPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPCCCCCCCPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDPPPPPPPPPPPWD.',
    '.DMDDDDDDDDDDDDWD.',
    '.DMWWWWWWWWWWWWWD.',
    '.DDDDDDDDDDDDDDDD.',
    '..MMMMMMMMMMMMMMMM',
  ]);

// Present (pink box, yellow ribbon and bow), 24 x 22.
export const presentSvg = () =>
  pixelSvg([
    '....DDDD........DDDD....',
    '...DYYYYD......DYYYYD...',
    '...DYCCYYD....DYYCCYD...',
    '....DYYYYDDYYDDYYYYD....',
    '.....DDDDDYYYYDDDDD.....',
    'DDDDDDDDDDDYYDDDDDDDDDDD',
    'DCCCCCCCCCYYYYCCCCCCCCCD',
    'DPPPPPPPPPYYYYPPPPPPPPPD',
    'DDDDDDDDDDDDDDDDDDDDDDDD',
    '.DMMMMMMMMYYYYMMMMMMMMDM',
    ...Array(10).fill('.DPPPPPPPPYYYYPPPPPPPPDM'),
    '.DDDDDDDDDDDDDDDDDDDDDDM',
    '..MMMMMMMMMMMMMMMMMMMMMM',
  ]);
