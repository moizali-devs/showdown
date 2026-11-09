/** Title -> poster slug. Files live in web/public/posters/<slug>.jpg (800w JPEG fallback) plus -400/-800/-1200 .webp variants. See CREDITS.md there. */
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
export const POSTER_H = 750; // 2:3; the <img> boxes use object-fit: cover so slightly different native aspects never shift layout

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

/** Slug -> widths of the WebP variants on disk (Avengers' source is only ~1000 px wide, so no 1200). */
const MAX_W: Record<string, number> = { 'avengers-doomsday': 800 };
const slugOf = (title: string) => POSTERS.find(([re]) => re.test(title))?.[1] ?? null;
const set = (dir: string, slug: string, widths: number[]) =>
  widths.filter(w => w <= (MAX_W[slug] ?? 1200)).map(w => `/posters/${dir}${slug}-${w}.webp ${w}w`).join(', ');

/** Responsive WebP srcSet for the colour poster (400-1200 w). Pair with `posterFor` as the `src` fallback. */
export function posterSrcSet(title: string): string | null {
  const s = slugOf(title);
  return s ? set('', s, [400, 600, 800, 1000, 1200]) : null;
}

/** Responsive WebP srcSet for the pre-rendered greyscale poster (400-800 w). */
export function grayPosterSrcSet(title: string): string | null {
  const s = slugOf(title);
  return s ? set('gray/', s, [400, 600, 800]) : null;
}

/** Wide hero backdrop. None bundled: no genuine >= 1920 px key art was available, so the hero keeps the poster treatment. */
export function backdropFor(_title: string): { src: string; srcSet: string } | null {
  return null;
}

export const SIZES_CARD = '(max-width: 760px) 45vw, 280px';
export const SIZES_HERO = '(max-width: 900px) 280px, (max-width: 1280px) 38vw, 480px';
