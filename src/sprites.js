// Original pixel sprites, drawn locally. No downloaded artwork or raster libraries.
// Each anatomy is fitted with its own pressure suit, helmet, and breathing hardware.
export const ANATOMIES = ['crest', 'mantid', 'cyclops', 'frond', 'moth', 'amphibian', 'cephalid'];
const cache = new Map();
export function crewSprite(color, anatomy = 'crest', working = false) {
  const id = `${color}/${anatomy}/${working}`;
  if (cache.has(id)) return cache.get(id);
  const canvas = document.createElement('canvas'); canvas.width = 38; canvas.height = 52;
  const c = canvas.getContext('2d');
  const rect = (x, y, w, h, fill) => { c.fillStyle = fill; c.fillRect(x, y, w, h); };
  const pixels = (points, fill) => { c.fillStyle = fill; c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill(); };
  const dark = '#172932', seam = '#324d58', pale = '#d3e0cd', glow = '#abeecf';
  // Thruster pack and individual oxygen bottles.
  rect(7, 23, 25, 19, dark); rect(5, 25, 5, 14, '#819899'); rect(30, 24, 5, 15, '#66868e');
  rect(6, 25, 3, 3, pale); rect(31, 25, 3, 3, pale); rect(6, 37, 3, 2, '#e2b87d');
  // Feet and a nonhuman leg silhouette, with joint protection.
  pixels([[11,37],[18,38],[16,45],[16,50],[8,50],[8,47],[12,45]], dark);
  pixels([[21,38],[28,37],[27,45],[31,48],[30,51],[23,51],[22,46]], dark);
  rect(11, 39, 6, 5, color); rect(22, 39, 6, 5, color); rect(10, 47, 6, 2, '#7b9597'); rect(24, 48, 6, 2, '#789698');
  // Suit body: dark outline, shaded side, pressure harness, boots and gloves.
  pixels([[12,21],[24,21],[29,29],[27,41],[12,41],[9,30]], dark);
  pixels([[12,23],[24,23],[26,30],[24,39],[13,39],[11,30]], color);
  rect(23, 27, 3, 11, seam); rect(13, 24, 3, 12, '#c9d9c3'); rect(12, 37, 14, 3, '#9aab9e');
  rect(17, 28, 6, 7, dark); rect(18, 29, 4, 2, glow); rect(18, 33, 2, 1, '#eec78a');
  rect(9, 26, 4, 10, color); rect(25, 25, 5, 10, color); rect(8, 35, 5, 6, dark); rect(26, 34, 5, 6, dark);
  rect(9, 36, 3, 2, pale); rect(27, 35, 3, 2, pale);
  // Collar and protective dome; the visible creature inside changes by anatomy.
  rect(11, 20, 16, 5, dark); rect(12, 20, 14, 2, pale);
  pixels([[11,5],[25,5],[30,10],[30,19],[25,23],[10,22],[6,17],[6,10]], dark);
  pixels([[12,6],[24,6],[28,10],[28,18],[24,21],[11,20],[8,16],[8,11]], '#608c98');
  pixels([[12,7],[24,7],[27,11],[27,17],[23,20],[12,19],[9,15],[9,11]], '#284e60');
  if (anatomy === 'crest') {
    pixels([[16,7],[19,2],[22,7],[25,9],[24,17],[20,20],[13,17],[12,12]], '#96baa4');
    rect(14, 12, 4, 2, '#182f3d'); rect(21, 12, 3, 2, '#182f3d'); rect(15, 12, 2, 1, '#e1d590'); rect(21, 12, 2, 1, '#e1d590');
    rect(18, 17, 4, 1, '#557b77');
  } else if (anatomy === 'mantid') {
    pixels([[10,10],[15,7],[25,8],[27,12],[20,20],[17,20]], '#b8c387');
    rect(11, 10, 5, 4, '#dbb29d'); rect(23, 10, 4, 4, '#dbb29d'); rect(12,11,2,2,dark); rect(24,11,2,2,dark);
    rect(17, 17, 2, 5, '#c5d39f'); rect(21,17,2,5,'#c5d39f');
    rect(12, 1, 2, 7, '#8ea39d'); rect(24,0,2,8,'#8ea39d'); rect(10,0,4,2,glow);
    rect(5, 30, 4, 5, color); rect(3,33,3,6,dark);
  } else if (anatomy === 'cyclops') {
    pixels([[13,8],[23,8],[26,12],[24,19],[14,20],[11,16]], '#c2a6c5');
    rect(14, 11, 10, 6, '#e2e5bf'); rect(17, 11, 4, 6, '#355b68'); rect(18,12,2,3,'#b7efce'); rect(17,19,6,1,'#746487');
    rect(14, 3, 8, 3, '#a3b7b3');
  } else if (anatomy === 'frond') {
    rect(16, 10, 8, 10, '#8caf90');
    pixels([[15,12],[10,5],[13,4],[19,11],[18,2],[21,2],[22,11],[27,5],[29,7],[24,16]], '#a4ca9b');
    rect(17, 14, 2, 2, dark); rect(22, 14, 2, 2, dark); rect(14,18,11,3,'#6c9790');
  } else if (anatomy === 'moth') {
    pixels([[12,9],[16,7],[23,8],[27,12],[23,20],[17,20],[12,17]], '#cabb9d');
    rect(11, 10, 6, 6, '#a2c8c7'); rect(23,10,5,6,'#a2c8c7'); rect(12,11,3,3,'#283e51'); rect(24,11,3,3,'#283e51');
    pixels([[13,8],[7,3],[8,1],[16,5]], '#b9bb9f'); pixels([[23,8],[29,2],[31,3],[27,8]], '#b9bb9f');
    rect(18,17,4,4,'#827565');
  } else if (anatomy === 'amphibian') {
    pixels([[10,12],[11,8],[16,7],[19,10],[23,7],[28,9],[28,16],[23,20],[14,20]], '#89b8bb');
    rect(12, 9, 4, 4, '#ebd687'); rect(24,9,3,4,'#ebd687'); rect(14,9,1,4,dark); rect(25,9,1,4,dark);
    rect(14, 17, 10, 1, '#395c73'); rect(8,13,3,4,'#85b4b2');
  } else {
    pixels([[15,6],[22,6],[26,10],[26,15],[22,19],[13,18],[11,12]], '#c5a6ae');
    rect(13,11,4,3,'#f0d3a6'); rect(22,11,3,3,'#f0d3a6'); rect(14,12,2,1,dark); rect(22,12,2,1,dark);
    for (let i = 0; i < 3; i++) { rect(13+i*5,17,3,6,'#c5a6ae'); rect(11+i*5,21,4,2,'#a785a0'); }
  }
  // Transparent helmet rim, reflection, and breathing couplers.
  rect(9, 8, 2, 7, '#cbe8df'); rect(11,6,5,1,'#cbe8df'); rect(27,13,2,5,'#8cc1c5'); rect(9,20,4,3,pale); rect(24,20,4,3,pale);
  if (working) { rect(32, 29, 2, 17, '#c3b98f'); rect(29, 27, 8, 4, '#d8cfac'); rect(35, 30, 2, 3, '#82d4c1'); }
  cache.set(id, canvas); return canvas;
}
