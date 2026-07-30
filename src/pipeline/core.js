/* Layer 0 — primitives. Plain {w,h,data} buffers so every layer above runs
   headless and testable. No canvas, no DOM. */
export const newImg = (w,h) => ({ w, h, data:new Uint8ClampedArray(w*h*4) });
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;

const lin = v => { v /= 255; return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
const enc = v => { v = clamp01(v); v = v <= 0.0031308 ? 12.92*v : 1.055*Math.pow(v,1/2.4)-0.055;
                   return Math.round(v*255); };

export function rgbToOklab(r,g,b){
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B);
  const m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B);
  const s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
export function oklabToRgb(L,a,b){
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;
  const l = l_**3, m = m_**3, s = s_**3;
  return [enc( 4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
          enc(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
          enc(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s)];
}
export const labDist = (p,q) => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) * 100;

export function sampleBilinear(img, x, y, out){
  x = x < 0 ? 0 : x > img.w-1 ? img.w-1 : x;
  y = y < 0 ? 0 : y > img.h-1 ? img.h-1 : y;
  const x0 = x|0, y0 = y|0;
  const x1 = Math.min(x0+1, img.w-1), y1 = Math.min(y0+1, img.h-1);
  const fx = x-x0, fy = y-y0, d = img.data;
  const i00=(y0*img.w+x0)*4, i10=(y0*img.w+x1)*4, i01=(y1*img.w+x0)*4, i11=(y1*img.w+x1)*4;
  for (let c = 0; c < 3; c++){
    const top = d[i00+c] + (d[i10+c]-d[i00+c])*fx;
    const bot = d[i01+c] + (d[i11+c]-d[i01+c])*fx;
    out[c] = top + (bot-top)*fy;
  }
  return out;
}

export const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
export function nz(a, b, c){
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177) | 0;
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

export function fillRect(img, x0, y0, w, h, rgb, alpha){
  const X0 = Math.max(0, Math.round(x0)), Y0 = Math.max(0, Math.round(y0));
  const X1 = Math.min(img.w, Math.round(x0+w)), Y1 = Math.min(img.h, Math.round(y0+h));
  const d = img.data;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++){
    const o = (y*img.w + x)*4;
    if (alpha === undefined || alpha >= 1){ d[o]=rgb[0]; d[o+1]=rgb[1]; d[o+2]=rgb[2]; }
    else { d[o]+=(rgb[0]-d[o])*alpha; d[o+1]+=(rgb[1]-d[o+1])*alpha; d[o+2]+=(rgb[2]-d[o+2])*alpha; }
    d[o+3] = 255;
  }
}
