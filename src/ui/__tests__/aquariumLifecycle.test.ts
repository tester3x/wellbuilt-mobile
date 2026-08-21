import * as fs from 'fs';
import * as path from 'path';

const aqua = fs.readFileSync(path.join(__dirname, '../../components/TankFlipAquarium.tsx'), 'utf8');
const imu = fs.readFileSync(path.join(__dirname, '../../hooks/useTankImu.ts'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');

describe('FLIP aquarium lifecycle', () => {
  test('exact zero fill is not forced up to 4%', () => {
    expect(aqua).not.toMatch(/Math\.max\(0\.04/);
    expect(aqua).toContain('clamp01(fill)');
    expect(aqua).toContain('if (fillNow <= 0)');
  });

  test('reduced motion and inactivity skip the continuous rAF loop', () => {
    expect(aqua).toContain('if (!active || reducedMotion)');
    expect(aqua).toContain('paintStill()');
    expect(aqua).toMatch(/if \(!active \|\| reducedMotion\) \{\s*paintStill\(\);\s*return;/);
  });

  test('background/off-screen skips simulation without a huge timestep', () => {
    expect(aqua).toContain('fgRef.current');
    expect(aqua).toContain('Math.min(0.05, rawDt');
    expect(imu).toContain("AppState.addEventListener('change'");
    expect(imu).toContain('aSub.remove()');
    expect(imu).toContain('gSub.remove()');
  });

  test('idle cadence avoids full-rate React updates when settled', () => {
    expect(aqua).toContain('idleSkip');
    expect(aqua).toContain('publish');
    expect(aqua).toContain('kineticEnergy');
  });

  test('fish sample local surface and current; duck rides FLIP hull', () => {
    expect(aqua).toContain('sampleSurfaceAtX');
    expect(aqua).toContain('sampleVelocity');
    expect(aqua).toContain('stepDuckFloat');
    expect(aqua).toContain('surfaceY: local');
  });

  test('dev forced egg preview remains committed-off', () => {
    expect(index).toMatch(/FORCE_EGG: 'fish' \| 'fisherman' \| 'duck' \| null = null;/);
  });

  test('sensors are torn down on disable', () => {
    expect(imu).toContain('if (!enabled)');
    expect(imu).toContain('return () => {');
    expect(imu).toContain('aSub.remove()');
  });
});
