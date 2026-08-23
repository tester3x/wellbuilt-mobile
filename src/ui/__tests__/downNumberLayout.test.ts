import { numberTopForTank, downNumberTopPx, waterlineNumberTopPx } from '../downNumberLayout';

function interiorHeight(screenW: number, screenH: number, tablet: boolean): number {
  let tankWidth: number;
  let tankHeight: number;
  if (tablet) {
    tankHeight = screenH * 0.42;
    tankWidth = tankHeight / 1.2;
  } else {
    tankWidth = screenW * 0.70;
    tankHeight = tankWidth * 1.2;
  }
  return tankHeight * 0.70;
}

describe('DOWN-only static numeric lane', () => {
  const levels = [
    { label: "3'4\"", fraction: (3 + 4 / 12) / 20 },
    { label: "4'", fraction: 4 / 20 },
    { label: "5'", fraction: 5 / 20 },
    { label: "6'", fraction: 6 / 20 },
    { label: 'high 16\'', fraction: 16 / 20 },
  ];

  const devices = [
    { name: 'S24', w: 360, h: 780, tablet: false },
    { name: 'Z Fold cover', w: 320, h: 844, tablet: false },
    { name: 'Z Fold inner', w: 673, h: 720, tablet: true },
  ];

  it('DOWN number uses the same lower safe lane at 3\'–6\' and high levels', () => {
    for (const d of devices) {
      const ih = interiorHeight(d.w, d.h, d.tablet);
      const off = d.tablet ? ih * 0.025 : d.h * 0.015;
      const lane = downNumberTopPx(ih, off);
      for (const level of levels) {
        const top = numberTopForTank({
          isDown: true,
          interiorHeight: ih,
          waterFraction: level.fraction,
          numberOffset: off,
        });
        expect(top).toBeCloseTo(lane, 5);
      }
      expect(lane).toBeGreaterThan(ih * 0.5);
      expect(lane).toBeLessThan(ih * 0.8);
    }
  });

  it('normal wells retain moving waterline number behavior', () => {
    const ih = interiorHeight(360, 780, false);
    const off = 780 * 0.015;
    const low = waterlineNumberTopPx(ih, (3 + 4 / 12) / 20, off);
    const high = waterlineNumberTopPx(ih, 16 / 20, off);
    expect(high).toBeLessThan(low);
    expect(numberTopForTank({
      isDown: false,
      interiorHeight: ih,
      waterFraction: 16 / 20,
      numberOffset: off,
    })).toBe(high);
    expect(numberTopForTank({
      isDown: false,
      interiorHeight: ih,
      waterFraction: (3 + 4 / 12) / 20,
      numberOffset: off,
    })).toBe(low);
  });
});
