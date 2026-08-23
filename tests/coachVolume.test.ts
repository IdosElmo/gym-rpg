/**
 * ui/coachVolume.ts — the paint.
 *
 * The rig's tests prove the skeleton is in the right place; these prove the
 * BODY drawn on it is, and they do it the only way a picture can be tested
 * without eyes: by asserting the invariants a drawing has to satisfy no matter
 * what pose it is handed.
 *
 *   - the shape vocabulary is closed (a capsule is four commands and a colour
 *     mix is a colour), so nothing downstream can produce `NaN` in a path;
 *   - a figure emits exactly the layers its caller asked for, in that order,
 *     which is the whole depth model;
 *   - the muscle highlight is INSIDE the figure's markup and moves with it —
 *     paint a pose, paint a different pose, the patch has moved too;
 *   - a limb's highlight cannot land on the other kind of limb (a hamstring on
 *     a forearm is the failure this file exists to prevent);
 *   - the two silhouettes really are two: a front view is not a side view with
 *     different numbers;
 *   - the palette in the code and the palette in `styles/coach.css` are the
 *     same palette.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LAYERS,
  MUSCLE_HE,
  MUSCLE_REGIONS,
  PAL,
  capsule,
  defsSvg,
  figureSvg,
  frameAt,
  mixHex,
  motionPathSvg,
  styleOf,
  type DemoLook,
  type FigureStyle,
  type Layer,
  type MuscleRegion,
} from '../src/ui/coachVolume.ts';
import { forwardKinematics, type Pose } from '../src/ui/coachFigure.ts';

const STANDING: Pose = {
  x: 80,
  y: 66,
  torso: -90,
  head: -90,
  arm: [90, 90],
  armF: [90, 90],
  leg: [90, 90, 0],
  legF: [90, 90, 0],
};

const HINGED: Pose = { ...STANDING, x: 66, torso: -30, head: -36, arm: [80, 80], armF: [82, 82] };

function style(over: Partial<FigureStyle> = {}): FigureStyle {
  return {
    view: 'side',
    facing: 1,
    order: LAYERS,
    primary: 'chest',
    hold: { k: 'none' },
    ...over,
  };
}

const draw = (pose: Pose, over: Partial<FigureStyle> = {}): string => {
  const st = style(over);
  return figureSvg(forwardKinematics(pose, st.view), st, 'clip');
};

/* ------------------------------------------------------------------ shapes */

describe('the shape vocabulary', () => {
  it('mixes two colours and refuses anything that is not one', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    // clamped, not wrapped
    expect(mixHex('#000000', '#ffffff', 4)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', -2)).toBe('#000000');
    expect(mixHex('rgb(0,0,0)', '#ffffff', 0.5)).toBe('rgb(0,0,0)');
  });

  it('draws a tapered capsule as one closed path with two arcs', () => {
    const d = capsule({ x: 10, y: 10 }, { x: 30, y: 10 }, 4, 2);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/A /g)).toHaveLength(2);
    expect(d).not.toMatch(/NaN|Infinity|undefined/);
    // a zero-length capsule is still a legal path, not a crash
    expect(capsule({ x: 5, y: 5 }, { x: 5, y: 5 }, 3, 3)).not.toMatch(/NaN/);
  });
});

/* ------------------------------------------------------------------ layers */

describe('the figure', () => {
  it('emits every layer the caller asked for, in that order', () => {
    const order: readonly Layer[] = ['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm'];
    const svg = draw(STANDING, { order });
    expect(svg).toMatch(/^<g class="cd-figure">/);
    // the torso is the marker of the body layer: it is the one closed bezier
    expect(svg).toContain('<clipPath id="clip">');
    // reordering the layers reorders the markup
    const other = draw(STANDING, { order: ['body', 'farLeg', 'farArm', 'nearLeg', 'nearArm'] });
    expect(other).not.toBe(svg);
    expect(other.indexOf('<clipPath')).toBeLessThan(svg.indexOf('<clipPath'));
  });

  it('draws only the layers it was given — a short order draws less', () => {
    const full = draw(STANDING);
    const bodyOnly = draw(STANDING, { order: ['body'] });
    expect(bodyOnly.length).toBeLessThan(full.length);
    expect(bodyOnly).toContain('<clipPath id="clip">');
  });

  it('never emits NaN, an external reference or a raster', () => {
    for (const region of MUSCLE_REGIONS) {
      for (const view of ['side', 'front'] as const) {
        const svg = draw(STANDING, { view, primary: region, secondary: 'arms', hold: { k: 'db' } });
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(svg).not.toMatch(/https?:|<image|xlink:href|data:|\.png|\.gif/);
        // the only url() allowed is a same-document reference
        for (const m of svg.matchAll(/url\(([^)]*)\)/g)) expect(m[1]?.startsWith('#')).toBe(true);
      }
    }
  });
});

/* -------------------------------------------------------------- the muscle */

describe('the muscle highlight', () => {
  it('is drawn inside the figure and moves with the pose', () => {
    const a = draw(STANDING, { primary: 'chest' });
    const b = draw(HINGED, { primary: 'chest' });
    expect(a).toContain('class="cd-hi"');
    expect(b).toContain('class="cd-hi"');
    // same region, different pose → different geometry, because the patch is
    // authored in the body's own frame rather than pinned to the stage
    expect(a).not.toBe(b);
  });

  it('paints a different shape for every region, and a name for every one', () => {
    const seen = new Set<string>();
    for (const region of MUSCLE_REGIONS) {
      const svg = draw(STANDING, { primary: region });
      expect(svg).toContain('url(#cdHot)');
      seen.add(svg);
      expect(MUSCLE_HE[region].length).toBeGreaterThan(1);
    }
    expect(seen.size).toBe(MUSCLE_REGIONS.length);
  });

  it('keeps a LEG region off the arms and an ARM region off the legs', () => {
    // Drawn from the side, a hanging arm and a standing thigh cover the same
    // rectangle: the guard is that a patch declares which limb it belongs to.
    const legs = draw(STANDING, { primary: 'legs', order: ['nearArm'] });
    const arms = draw(STANDING, { primary: 'arms', order: ['nearLeg'] });
    expect(legs).not.toContain('url(#cdHot)');
    expect(arms).not.toContain('url(#cdHot)');
    // …and each one does appear on the limb it belongs to
    expect(draw(STANDING, { primary: 'legs', order: ['nearLeg'] })).toContain('url(#cdHot)');
    expect(draw(STANDING, { primary: 'arms', order: ['nearArm'] })).toContain('url(#cdHot)');
  });

  it('puts a limb belly on the face the demo asked for', () => {
    const front = draw(STANDING, { primary: 'arms', face: 'front', order: ['nearArm'] });
    const back = draw(STANDING, { primary: 'arms', face: 'back', order: ['nearArm'] });
    expect(front).not.toBe(back);
    // the default is the flexor: a curl, not a pushdown
    expect(draw(STANDING, { primary: 'arms', order: ['nearArm'] })).toBe(front);
    // …and for a leg the default is the hamstring
    expect(draw(STANDING, { primary: 'legs', order: ['nearLeg'] })).toBe(
      draw(STANDING, { primary: 'legs', face: 'back', order: ['nearLeg'] }),
    );
  });

  it('fades the secondary region below the primary', () => {
    const opacities = (svg: string): number[] =>
      [...svg.matchAll(/class="cd-hi" opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
    const one = draw(STANDING, { primary: 'chest' });
    const two = draw(STANDING, { primary: 'chest', secondary: 'arms' });
    expect(two.length).toBeGreaterThan(one.length);
    const both = opacities(two);
    expect(both.length).toBeGreaterThan(1);
    expect(Math.max(...both)).toBeGreaterThan(Math.min(...both));
    // and the primary is deliberately BELOW 1: a muscle painted onto a body, not
    // a neon cut-out pasted over it
    expect(Math.max(...both)).toBeLessThan(1);
  });
});

/* ----------------------------------------------------------- the two views */

describe('the two silhouettes', () => {
  it('draws a front view that is not a side view', () => {
    const side = draw(STANDING, { view: 'side' });
    const front = draw(STANDING, { view: 'front' });
    expect(front).not.toBe(side);
    expect(front).not.toMatch(/NaN/);
  });

  it('paints BOTH sides of a frontal figure at full strength', () => {
    // In the sagittal plane the far side recedes; in the frontal plane neither
    // side is far, so the far limbs use the near palette.
    const farOnly = (view: 'side' | 'front'): string => draw(STANDING, { view, order: ['farLeg'] });
    expect(farOnly('side')).toContain(mixHex(PAL.skin, PAL.stage2, 0.44));
    expect(farOnly('front')).toContain(PAL.skin);
    expect(farOnly('front')).not.toContain(mixHex(PAL.skin, PAL.stage2, 0.44));
  });

  it('mirrors a symmetric frontal pose into two matching sides', () => {
    const j = forwardKinematics(STANDING, 'front');
    expect(j.near.knee.x - j.pelvis.x).toBeCloseTo(j.pelvis.x - j.far.knee.x, 6);
    expect(j.near.elbow.y).toBeCloseTo(j.far.elbow.y, 6);
  });
});

/* ------------------------------------------------------------ the movement */

describe('the load path', () => {
  const look = (over: Partial<DemoLook>): DemoLook => ({
    view: 'side',
    facing: 1,
    order: LAYERS,
    hold: { k: 'db' },
    primary: 'chest',
    frames: [STANDING, { ...STANDING, arm: [-90, -90], armF: [-90, -90] }],
    camera: [0, 0, 160, 120],
    ...over,
  });

  it('traces the load, with an arrowhead at the finish', () => {
    const svg = motionPathSvg(look({}));
    expect(svg).toContain('cd-arc');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).not.toMatch(/NaN/);
  });

  it('says nothing when the load does not travel, or when asked not to', () => {
    expect(motionPathSvg(look({ frames: [STANDING, STANDING] }))).toBe('');
    expect(motionPathSvg(look({ arcFrom: 'none' }))).toBe('');
    // bodyweight: there is no load to sample unless the demo names a joint
    expect(motionPathSvg(look({ hold: { k: 'none' } }))).toBe('');
    expect(motionPathSvg(look({ hold: { k: 'none' }, arcFrom: 'hip' }))).toBe('');
    const knees = look({
      hold: { k: 'none' },
      arcFrom: 'knee',
      frames: [STANDING, { ...STANDING, leg: [-30, 60, 0], legF: [-30, 60, 0] }],
    });
    expect(motionPathSvg(knees)).toContain('cd-arc');
  });

  it('nudges the guide clear of the limb that carries it', () => {
    expect(motionPathSvg(look({}))).not.toBe(motionPathSvg(look({ arcShift: [10, 0] })));
  });

  it('walks the keyframes and clamps at both ends', () => {
    const frames = [STANDING, { ...STANDING, y: 80 }, { ...STANDING, y: 100 }];
    expect(frameAt(frames, 0).y).toBe(66);
    expect(frameAt(frames, 0.5).y).toBe(80);
    expect(frameAt(frames, 1).y).toBe(100);
    expect(frameAt(frames, -3).y).toBe(66);
    expect(frameAt(frames, 9).y).toBe(100);
    expect(frameAt([], 0.5).y).toBe(60); // the fallback pose, not a crash
  });

  it('carries the optional fields through to the style only when set', () => {
    const bare = styleOf(look({}));
    expect('secondary' in bare).toBe(false);
    expect('face' in bare).toBe(false);
    const full = styleOf(look({ secondary: 'arms', face: 'back' }));
    expect(full.secondary).toBe('arms');
    expect(full.face).toBe('back');
  });
});

/* ------------------------------------------------------------ the palette */

describe('the palette', () => {
  const css = readFileSync(resolve(process.cwd(), 'styles/coach.css'), 'utf8');

  it('is the same in the code and in the stylesheet', () => {
    const vars = new Map<string, string>();
    for (const m of css.matchAll(/--cd-([a-z0-9]+)\s*:\s*(#[0-9a-f]{6})/gi)) {
      vars.set(m[1] as string, (m[2] as string).toLowerCase());
    }
    expect(vars.size).toBeGreaterThan(8);
    for (const [name, value] of vars) {
      const own = (PAL as Record<string, string>)[name];
      expect(own, `--cd-${name} has no PAL entry`).toBeDefined();
      expect(value, `--cd-${name}`).toBe(own);
    }
  });

  it('is all hex, so a repaint can inline it', () => {
    for (const v of Object.values(PAL)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('declares the gradient and filter the highlight refers to', () => {
    const defs = defsSvg();
    for (const id of ['cdHot', 'cdGlow', 'cdStage']) expect(defs).toContain(`id="${id}"`);
    expect(defs).toContain(PAL.hot1);
    expect(defs).toContain(PAL.hot2);
  });

  it('names every region in Hebrew', () => {
    for (const r of MUSCLE_REGIONS) {
      const he = MUSCLE_HE[r as MuscleRegion];
      expect(he).toMatch(/[֐-׿]/);
    }
    expect(new Set(Object.values(MUSCLE_HE)).size).toBe(MUSCLE_REGIONS.length);
  });
});
