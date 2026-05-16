// Simplified Nigeria country boundary as [lng, lat] pairs.
//
// Derived from public-domain Natural Earth 1:50m admin-0 boundaries,
// down-sampled to ~120 vertices so it ships inline without needing a
// network fetch in the no-Mapbox fallback. Sufficient for the SVG
// background outline; the real Mapbox renderer uses vector tiles.

export const NIGERIA_BOUNDARY: Array<[number, number]> = [
  // North-west: Sokoto / Kebbi border with Niger and Benin
  [3.61, 11.66], [3.57, 11.83], [3.66, 12.21], [3.59, 12.43], [3.66, 12.55],
  [3.62, 12.71], [3.70, 12.86], [4.13, 13.46], [4.30, 13.50], [4.80, 13.74],
  // Northern border with Niger Republic
  [5.32, 13.85], [5.70, 13.71], [6.21, 13.65], [6.82, 13.32], [7.20, 13.10],
  [7.78, 13.34], [8.28, 13.20], [8.80, 12.93], [9.40, 12.98], [9.94, 13.05],
  [10.61, 13.27], [11.42, 13.40], [12.06, 13.34], [12.69, 13.34], [13.07, 13.18],
  [13.43, 13.08], [13.71, 12.92], [13.95, 12.46], [14.18, 12.49], [14.50, 12.85],
  // North-east: Lake Chad and Borno
  [14.60, 12.50], [14.50, 12.05], [14.18, 11.24], [13.99, 10.49], [13.73, 10.16],
  [13.31, 9.97], [13.02, 9.49], [12.91, 9.41], [12.62, 8.90], [12.36, 8.61],
  // Eastern border with Cameroon: Adamawa, Taraba, Cross River
  [12.21, 8.30], [12.06, 7.80], [11.84, 7.27], [11.45, 6.96], [11.05, 6.69],
  [10.75, 6.85], [10.49, 6.93], [10.10, 6.84], [9.83, 6.78], [9.23, 6.43],
  [9.04, 6.36], [8.85, 5.81], [8.60, 5.55], [8.50, 4.95], [8.30, 4.62],
  // Southern coast: Atlantic Ocean (Niger Delta)
  [7.82, 4.55], [7.49, 4.42], [7.08, 4.46], [6.70, 4.24], [6.27, 4.27],
  [5.87, 4.31], [5.50, 4.51], [5.07, 4.85], [4.83, 5.59], [4.49, 5.86],
  [4.17, 6.13], [3.82, 6.40], [3.43, 6.40], [3.10, 6.37], [2.74, 6.36],
  // Western border with Benin Republic
  [2.69, 6.81], [2.71, 7.41], [2.74, 7.87], [2.76, 8.27], [2.78, 8.50],
  [2.78, 9.05], [3.06, 9.10], [3.30, 9.39], [3.43, 9.84], [3.55, 10.20],
  [3.66, 10.47], [3.55, 10.87], [3.61, 11.40], [3.61, 11.66],
];

// Computed bounding box used for SVG projection. Hand-rounded so the
// projection is deterministic regardless of vertex changes above.
export const NIGERIA_BBOX = {
  lngMin: 2.5,
  lngMax: 14.7,
  latMin: 4.0,
  latMax: 14.0,
};
