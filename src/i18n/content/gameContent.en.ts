/**
 * i18n/content/gameContent.en.ts — the English overlay of the game content in
 * `data/gameContent.ts` and `data/characters.ts`.
 *
 * Worlds, enemies, bosses, equipment and skins already carry an `en` NAME
 * beside the Hebrew one (read with `pick`). What they do not carry — the
 * one-line flavour under a world, an item's shop note, a skin's tag line, the
 * skills, slots and bodies — lives here, keyed by the content's stable ids.
 * The data files stay Hebrew (other tests pin them); every screen reads this
 * copy through `i18n/gameText.ts`, which falls back to the Hebrew original for
 * an id missing here, so a gap is visible, never blank.
 *
 * Voice: short, punchy, second person — phones are narrow.
 */

import type { BodyGeometry } from '../../data/characters.ts';
import type { EquipmentSlot, SkillId } from '../../data/gameContent.ts';

/** The flavour line under each world's name, by world id. */
export const WORLD_TAGLINE_EN: Readonly<Record<number, string>> = {
  1: 'Rusted iron, dust and machines long forgotten',
  2: 'Asphalt, neon and dogs that hate strangers',
  3: 'Sand, a bloodthirsty crowd and a whole lot of noise',
  4: 'Above the clouds, only the truly trained fight',
  5: 'Pressure, darkness and armor built by a million years of evolution',
  6: 'The cold slows your hands — only trained shoulders break it',
  7: 'What has no body is hard to hit — aim a Precision Strike',
  8: 'Above it all, and it heals faster than you can complain',
  9: 'The end. Here any blow can be a crit — theirs',
  10: 'Steel, oil and targeting. They are armored — and they can aim',
  11: 'The true end. What lives here dodges and heals — and everything spins',
};

/** The shop's flavour line for each item, by item id. */
export const EQUIPMENT_NOTE_EN: Readonly<Record<string, string>> = {
  helmet_1: 'Tied tight. Sweat stays out of your eyes — and the blow lands where it should.',
  helmet_2: 'Blue visor, padded. A quiet head, a precise hand.',
  helmet_3: 'Gold with a plume. Whoever wears it has won before — and knows how.',
  helmet_4: 'Wind whistles through the wings. Your head stays put — and the blow lands twice as hard.',
  helmet_5: 'A crown cast in fire. Its wearer never looks for a fight — the fight finds them.',
  helmet_6: 'A ring of light overhead. Even the bosses look away.',
  gloves_1: 'A steady grip, a heavier punch.',
  gloves_2: 'Real leather — and a hit you can feel.',
  gloves_3: 'Gold on leather. Every hit is a statement.',
  gloves_4: "Iron on the knuckles. The bag doesn't swing — it rips.",
  gloves_5: 'Dragon scales on the hand. Every punch leaves a scar.',
  gloves_6: 'Forged from a fallen star. The hit arrives before the sound.',
  shirt_1: 'Plain cotton, open cut — the shoulders stay out.',
  shirt_2: 'Green scales. Blows just slide off.',
  shirt_3: 'Light as a feather, hard as a mountain.',
  shirt_4: "Steel plates that shed lightning. The rain doesn't stop, and neither do you.",
  shirt_5: 'Scales that survived fire. The heart is guarded — and beating strong.',
  shirt_6: 'Woven from starlight. Hits scatter like dust.',
  belt_1: 'Simple, but your core thanks it.',
  belt_2: 'Thick leather for heavy squats.',
  belt_3: 'The buckle alone outweighs the competition.',
  belt_4: 'An anchor buckle. The core is locked, the storm stays out.',
  belt_5: 'Titan hide, fire buckle. No squat is too heavy.',
  belt_6: 'Seven stars on the buckle. Back straight, all the power in one place.',
  leggings_1: 'Snug and stretchy — no squat ever gets stuck.',
  leggings_2: 'Warm legs push harder.',
  leggings_3: 'Lightning starts in the legs. It always has.',
  leggings_4: 'Knee guards that soak up thunder. The legs drive through the storm.',
  leggings_5: 'Hot scales on the thighs. Every step — an eruption.',
  leggings_6: 'Legs that walk on the sky. The floor barely feels them.',
  shoes_1: "Light. You're just faster.",
  shoes_2: 'A hard heel — stability that turns into tempo.',
  shoes_3: 'Olympus lends you a little speed.',
  shoes_4: "Iron soles, a spring in the heel. The storm gives chase — and can't catch up.",
  shoes_5: "Dragon wings at the ankle. You don't run, you fly.",
  shoes_6: "Footprints of light. By the time the enemy gets it — you've been and gone.",
  cape_1: 'Not a cape. Still helps you recover.',
  cape_2: "Flaps even when there's no wind.",
  cape_3: 'Woven from clouds. Bosses recognize it.',
  cape_4: 'Made of clouds tired of raining. Dries before you do.',
  cape_5: 'A dragon wing on your shoulders. Warm in winter, blazing in battle.',
  cape_6: 'A whole night sky, folded into a cape. The bosses already know the name.',
};

/** Equipment slot names. */
export const SLOT_EN: Readonly<Record<EquipmentSlot, string>> = {
  helmet: 'Helmet',
  gloves: 'Gloves',
  shirt: 'Shirt',
  belt: 'Belt',
  leggings: 'Leggings',
  shoes: 'Shoes',
  cape: 'Cape',
};

/** The six body-part skills: name + flavour (numbers come from BALANCE). */
export const SKILL_EN: Readonly<Record<SkillId, { readonly name: string; readonly desc: string }>> = {
  smash: { name: 'Crushing Blow', desc: 'One heavy blow that smashes the enemy.' },
  guard: { name: 'Iron Stance', desc: 'Stand firm — incoming damage drops sharply.' },
  quake: { name: 'Earthquake', desc: 'The ground shakes: damage and a short stun.' },
  flurry: { name: 'Flurry', desc: 'A storm of blows — attack speed doubled.' },
  focus: { name: 'Precision Strike', desc: 'Your next attack is a guaranteed crit, with extra damage.' },
  breath: { name: 'Deep Breath', desc: 'An instant heal, then a moment of boosted recovery.' },
};

/** A skin's tag line on the purchase sheet, by skin id. */
export const SKIN_NOTE_EN: Readonly<Record<string, string>> = {
  hero: 'The classic. Iron, sweat and persistence.',
  robot: "Doesn't breathe, doesn't complain. The battery isn't dead yet.",
  spartan: 'Bronze, a helmet and one very long battle.',
  zombie: 'Already died on the last set. Still finishing the program.',
  ninja: 'Lifts heavy in total silence. You never see it coming.',
};

/** The two bodies on the דמות screen's toggle. */
export const BODY_EN: Readonly<Record<BodyGeometry, string>> = { male: 'Male', female: 'Female' };
