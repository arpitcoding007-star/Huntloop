/**
 * The Huntloop mark's geometry, with no React attached — importable from the
 * edge-runtime image routes (the Open Graph card, the Apple touch icon) that
 * draw the mark without the component library. `BrandMark` renders the same
 * values; see that file for how they were derived.
 *
 * Created and designed by Chandra Mani Sharma.
 */

/** The loop: a 32×32 spiral, stroked, round caps and joins. */
export const BRAND_MARK_PATH =
  "M22.1 5.43A11.99 11.99 0 0 1 25.88 9.58A11.57 11.57 0 0 1 27.29 14.81A11.15 11.15 0 0 1 26.21 19.92A10.72 10.72 0 0 1 23.04 23.81A10.3 10.3 0 0 1 18.61 25.75A9.88 9.88 0 0 1 13.99 25.46A9.46 9.46 0 0 1 10.18 23.19A9.04 9.04 0 0 1 7.93 19.59A8.62 8.62 0 0 1 7.6 15.56A8.2 8.2 0 0 1 9.08 12.01A7.77 7.77 0 0 1 11.88 9.66A7.35 7.35 0 0 1 15.25 8.9A6.93 6.93 0 0 1 18.41 9.73A6.51 6.51 0 0 1 20.68 11.78";
export const BRAND_MARK_STROKE = 3.4;
/** The target: a dot at the centre of the 32×32 box. */
export const BRAND_MARK_DOT_R = 2.8;
