/* Layer 1 — geometry. Perspective flatten via DLT homography. */
import { newImg, sampleBilinear } from './core.js';

export function solveHomography(dst, src){
  const A = [], B = [];
  for (let i = 0; i < 4; i++){
    const [x,y] = dst[i], [u,v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -x*u, -y*u]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -x*v, -y*v]); B.push(v);
  }
  for (let c = 0; c < 8; c++){
    let piv = c;
    for (let r = c+1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];  [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++){
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const h = B.map((v,i) => v / A[i][i]); h.push(1);
  return h;
}

export const quadAspect = q => {
  const d = (a,b) => Math.hypot(q[a][0]-q[b][0], q[a][1]-q[b][1]);
  const w = (d(0,1) + d(3,2)) / 2, hh = (d(0,3) + d(1,2)) / 2;
  return hh < 1e-6 ? 1 : w / hh;
};

export function warpQuad(img, quad, outW, outH){
  const dst = [[0,0],[outW-1,0],[outW-1,outH-1],[0,outH-1]];
  const H = solveHomography(dst, quad);
  const out = newImg(outW, outH);
  if (!H) return out;
  const px = [0,0,0];
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++){
    const w = H[6]*x + H[7]*y + H[8];
    sampleBilinear(img, (H[0]*x+H[1]*y+H[2])/w, (H[3]*x+H[4]*y+H[5])/w, px);
    const o = (y*outW + x)*4;
    out.data[o]=px[0]; out.data[o+1]=px[1]; out.data[o+2]=px[2]; out.data[o+3]=255;
  }
  return out;
}
