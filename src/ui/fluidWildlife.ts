/** Shared water geometry for rendering and decorative wildlife. */
export function waterDepthAt(x: number, width: number, height: number, fill: number, samples: number[]): number {
  'worklet';
  const pos = x / width * samples.length - 0.5;
  const a = Math.max(0, Math.min(samples.length - 1, Math.floor(pos))), b = Math.min(samples.length - 1, a + 1);
  const t = Math.max(0, Math.min(1, pos - a));
  const before = samples[Math.max(0, a - 1)] || 0, left = samples[a] || 0, right = samples[b] || 0, after = samples[Math.min(samples.length - 1, b + 1)] || 0;
  const curve = 0.5 * (2 * left + (-before + right) * t + (2 * before - 5 * left + 4 * right - after) * t * t + (-before + 3 * left - 3 * right + after) * t * t * t);
  const offset = Math.max(Math.min(left, right), Math.min(Math.max(left, right), curve));
  return Math.max(0, Math.min(height, fill * height + offset));
}
export function submergedPosition(width: number, height: number, fill: number, samples: number[], inverted: boolean, angle: number, lane: number, depth: number, travel: number, radius = 9) {
  'worklet';
  let wetLeft = width, wetRight = 0;
  const safeDepth = (x: number) => {
    'worklet';
    return Math.min(waterDepthAt(x - radius, width, height, fill, samples), waterDepthAt(x, width, height, fill, samples), waterDepthAt(x + radius, width, height, fill, samples));
  };
  for (let i = 0; i <= 64; i++) {
    const x = radius + (width - radius * 2) * i / 64;
    if (safeDepth(x) >= radius * 2) { wetLeft = Math.min(wetLeft, x); wetRight = Math.max(wetRight, x); }
  }
  if (wetLeft > wetRight) return { left: 0, top: 0, opacity: 0, transform: [{ rotate: angle + 'rad' }] };
  const desired = Math.max(wetLeft, Math.min(wetRight, wetLeft + (wetRight - wetLeft) * lane + travel * Math.cos(angle)));
  let x = desired, nearest = width;
  if (safeDepth(x) < radius * 2) {
    for (let i = 0; i <= 64; i++) {
      const candidate = radius + (width - radius * 2) * i / 64;
      if (safeDepth(candidate) >= radius * 2 && Math.abs(candidate - desired) < nearest) { x = candidate; nearest = Math.abs(candidate - desired); }
    }
  }
  const water = safeDepth(x);
  const lo = inverted ? radius : height - water + radius, hi = inverted ? water - radius : height - radius;
  const center = inverted ? hi - (hi - lo) * depth : lo + (hi - lo) * depth;
  const y = Math.max(lo, Math.min(hi, center + travel * Math.sin(angle)));
  return { left: x - radius, top: y - radius, opacity: 1, transform: [{ rotate: angle + 'rad' }] };
}
export function floatingPosition(width: number, height: number, fill: number, samples: number[], inverted: boolean, angle: number, desiredX: number, size: number, lift: number) {
  'worklet';
  let x = width / 2, nearest = Infinity, depth = 0;
  for (let i = 0; i <= 128; i++) {
    const candidate = width * (i + 0.5) / 129;
    const d = waterDepthAt(candidate, width, height, fill, samples);
    if (d > 1 && d < height - 1 && Math.abs(candidate - desiredX) < nearest) { nearest = Math.abs(candidate - desiredX); x = candidate; depth = d; }
  }
  if (!Number.isFinite(nearest)) return { left: 0, top: 0, opacity: 0, transform: [{ rotate: angle + 'rad' }] };
  const surface = inverted ? depth : height - depth;
  const radius = size / 2;
  const cx = Math.max(radius, Math.min(width - radius, x + Math.sin(angle) * lift));
  const cy = Math.max(radius, Math.min(height - radius, surface - Math.cos(angle) * lift));
  return { left: cx - radius, top: cy - radius, opacity: 1, transform: [{ rotate: angle + 'rad' }] };
}

/** A near miss startles the school; distant tank taps keep their usual action. */
export function fishScatterDirections(positions: {left:number;top:number;opacity:number}[], x:number, y:number, angle:number, radius=28) {
  const visible=positions.filter(p=>p.opacity>0);
  if(!visible.some(p=>Math.hypot(p.left+9-x,p.top+9-y)<=radius)) return null;
  return positions.map((p,i)=>{
    const dx=p.left+9-x,dy=p.top+9-y;
    const tangent=dx*Math.cos(angle)+dy*Math.sin(angle);
    return {travel:Math.abs(tangent)>2?Math.sign(tangent):(i%2===0?-1:1),depth:(-dx*Math.sin(angle)+dy*Math.cos(angle))>=0?0.18:-0.18};
  });
}
