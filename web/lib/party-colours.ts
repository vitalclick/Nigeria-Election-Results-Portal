// Party brand colours, used to fill region polygons + polling-unit dots
// on the public results map. The choropleth's primary visual variable
// is "which party leads this region/PU"; verification status moves to
// the stroke so it never competes with the political signal for the
// reader's attention.

export interface Party {
  code: string;
  name: string;
  colour_hex: string | null;
  inec_registered: boolean;
}

export type PartyPalette = Record<string, string>;

// Used until the live /api/v1/parties response lands (or if the
// request fails). Kept in sync with db/seed/01_geo_seed.sql and the
// MOCK_PARTIES list in web/app/api/v1/parties/route.ts.
export const DEFAULT_PARTY_PALETTE: PartyPalette = {
  APC:  '#1f4e9c',
  PDP:  '#c0392b',
  LP:   '#2ecc71',
  NNPP: '#f39c12',
  ADC:  '#8e44ad',
};

// Fallback colour for regions / PUs whose leader hasn't been
// determined yet (no submissions, election not started, etc.). Light
// neutral grey reads as "no data" without competing with party hues.
export const NO_LEADER_FILL = '#e2e8f0';

// Fallback colour for a leader whose party code isn't in the palette
// (e.g. a new entrant the colour table hasn't caught up with). A neutral
// stone tone communicates "known but unbranded" without claiming a
// party's identity.
export const UNKNOWN_PARTY_FILL = '#94a3b8';

export function partyColour(
  leaderCode: string | null | undefined,
  palette: PartyPalette = DEFAULT_PARTY_PALETTE,
): string {
  if (!leaderCode) return NO_LEADER_FILL;
  return palette[leaderCode] ?? UNKNOWN_PARTY_FILL;
}

// Compute the leader of a polling unit from its consensus_data.
// Returns the party code with the highest vote count, or null if no
// votes have been recorded yet.
export function leaderFromCandidateVotes(
  candidateVotes: Record<string, number> | null | undefined,
): string | null {
  if (!candidateVotes) return null;
  let leader: string | null = null;
  let max = -1;
  for (const [code, votes] of Object.entries(candidateVotes)) {
    if (typeof votes === 'number' && votes > max) {
      max = votes;
      leader = code;
    }
  }
  return max > 0 ? leader : null;
}
