/* Layered SVG export. There is no <layer> in SVG; Illustrator treats
   top-level <g> elements as layers and Inkscape needs
   inkscape:groupmode="layer" + inkscape:label. One layer per yarn, adjacent
   cells merged into horizontal-run subpaths within a single <path> per yarn,
   floats in their own layer above the ground. Small files, editor-native.  */
export function modelToSvg(model, opt = {}){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx, ground = model.cells.ground;
  // Cell units: one warp thread = 1 SVG unit. Coordinates stay tiny integers,
  // which is what keeps a 70k-cell cloth's file size sane.
  const ch = +(model.geometry.wefted ?? 0.86).toFixed(3);
  const W = cols, H = +(rows*ch).toFixed(1);
  const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2,'0')).join('');

  // All-integer path data: one cell = 1x1, and the weft/warp ratio is applied
  // once per layer as a scale() transform instead of being repeated in every
  // subpath. Integers compress dramatically better.
  const yarnPath = (v) => {
    let d = '';
    for (let y = 0; y < rows; y++){
      let x = 0;
      while (x < cols){
        if (idx[y*cols+x] !== v){ x++; continue; }
        let len = 1;
        while (x+len < cols && idx[y*cols+x+len] === v) len++;
        d += `M${x} ${y}h${len}v1h${-len}z`;
        x += len;
      }
    }
    return d;
  };
  const tf = ` transform="scale(1 ${ch})"`;

  const layers = [];
  // ground first (paint order: bottom layer first in SVG)
  const order = model.palette.map((_,i)=>i)
    .sort((a,b) => (a===ground?-1:b===ground?1:0) ||
                   (model.palette[a].role==='supplementary') - (model.palette[b].role==='supplementary'));
  for (const v of order){
    const y = model.palette[v];
    const label = `yarn-${v+1}-${y.role}`;
    // The ground is everything the other yarns are not: a single rect, with
    // every other layer painted above it. This removes the majority of all
    // subpaths at a stroke and is visually identical.
    const d = v === ground ? null : yarnPath(v);
    if (v !== ground && !d) continue;
    const body = v === ground
      ? `    <rect fill="${hex(y.rgb)}" width="${W}" height="${H}"/>`
      : `    <path fill="${hex(y.rgb)}"${tf} d="${d}"/>`;
    layers.push(
      `  <g id="${label}" inkscape:groupmode="layer" inkscape:label="${label} (${(y.share*100).toFixed(1)}%)"` +
      ` data-role="${y.role}" data-share="${y.share.toFixed(4)}" data-oklab="${y.lab.map(n=>n.toFixed(4)).join(',')}">\n` +
      body + `\n  </g>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
    ` viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-schema="albers-studio/svg@1"` +
    ` data-cols="${cols}" data-rows="${rows}">\n${layers.join('\n')}\n</svg>\n`;
}
