/** Title -> poster slug. Files live in web/public/posters/<slug>.jpg (500 x ~740). See CREDITS.md there. */
const POSTERS: [RegExp, string][] = [
  [/odyssey/i, 'the-odyssey'],
  [/dune/i, 'dune-part-three'],
  [/avengers/i, 'avengers-doomsday'],
  [/hunger/i, 'hunger-games-sunrise'],
  [/spider/i, 'spider-man-brand-new-day'],
  [/hail mary/i, 'project-hail-mary'],
  [/toy story/i, 'toy-story-5'],
  [/supergirl/i, 'supergirl'],
];

export const POSTER_W = 500;
export const POSTER_H = 740;

/** URL of the film's poster, or null when none is bundled (callers fall back to FilmArt). */
export function posterFor(title: string): string | null {
  const hit = POSTERS.find(([re]) => re.test(title));
  return hit ? `/posters/${hit[1]}.jpg` : null;
}

/** Pre-rendered greyscale poster (X-Ray view). Avoids a CSS filter, which is costly while scrolling. */
export function grayPosterFor(title: string): string | null {
  const hit = POSTERS.find(([re]) => re.test(title));
  return hit ? `/posters/gray/${hit[1]}.jpg` : null;
}
