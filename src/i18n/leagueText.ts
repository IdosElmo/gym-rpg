/**
 * i18n/leagueText.ts — a league prize in the reader's language.
 *
 * data/leaguePools.ts is Hebrew (and pinned by tests/league.test.ts); English
 * lives beside it in `content/leaguePools.en.ts`, keyed by the stable item ids
 * of BOTH prize modes. Every place the app prints a pool item — the shop, the
 * confirmation sheet, the staked challenge — goes through here. A missing
 * English entry falls back to the Hebrew original rather than to nothing.
 */

import type { LeagueItem } from '../data/leaguePools.ts';
import { LEAGUE_ITEMS_EN } from './content/leaguePools.en.ts';
import { locale } from './locale.ts';

/** The item's title ("עיסוי גב" / "A back massage"). */
export function leagueItemName(item: LeagueItem): string {
  return (locale() === 'en' && LEAGUE_ITEMS_EN[item.id]?.name) || item.he;
}

/** The item's one line of detail — what exactly is promised, or demanded. */
export function leagueItemDetail(item: LeagueItem): string {
  return (locale() === 'en' && LEAGUE_ITEMS_EN[item.id]?.detail) || item.detail;
}
