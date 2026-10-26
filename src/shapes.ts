// Shape table for .kenshape compatibility. Index = tile.shape, path[angle] = SVG path
// relative to the tile origin on a 32-unit tile (same convention as Kenney Shape's SVG export).

export type ShapeKind = 'corner' | 'tip' | 'unique';

export interface ShapeDef {
  name: string;
  kind: ShapeKind;
  partner: string;
  path: [string, string, string, string];
}

export const SHAPES: ShapeDef[] = [
  { name: "square", kind: "corner", partner: "", path: [
    "m 0 0 l 32 0 l 0 32 l -32 0 l 0 -32",
    "m 0 0 l 32 0 l 0 32 l -32 0 l 0 -32",
    "m 0 0 l 32 0 l 0 32 l -32 0 l 0 -32",
    "m 0 0 l 32 0 l 0 32 l -32 0 l 0 -32",
  ] },
  { name: "corner", kind: "corner", partner: "", path: [
    "m 0 0 l 32 32 l -32 0 l 0 -32",
    "m 32 0 l -32 32 l 0 -32 l 32 0",
    "m 32 32 l -32 -32 l 32 0 l 0 32",
    "m 0 32 l 32 -32 l 0 32 l -32 0",
  ] },
  { name: "cornerRounded", kind: "corner", partner: "", path: [
    "m 0 0 q 13.25 0 22.6 9.35 q 9.4 9.4 9.4 22.65 l -32 0 l 0 -32",
    "m 32 0 q 0 13.25 -9.35 22.6 q -9.4 9.4 -22.65 9.4 l 0 -32 l 32 0",
    "m 32 32 q -13.25 0 -22.6 -9.35 q -9.4 -9.4 -9.4 -22.65 l 32 0 l 0 32",
    "m 0 32 q 0 -13.25 9.35 -22.6 q 9.4 -9.4 22.65 -9.4 l 0 32 l -32 0",
  ] },
  { name: "cornerRoundedInner", kind: "corner", partner: "", path: [
    "m 10.4 21.6 q 9 9.05 21.6 10.4 l -32 0 l 0 -32 l 0.1 0.7 q 0.25 2.3 0.85 4.45 q 2.3 9.3 9.45 16.45",
    "m 10.4 10.4 q -9.05 9 -10.4 21.6 l 0 -32 l 32 0 l -0.7 0.1 q -2.3 0.25 -4.45 0.85 q -9.3 2.3 -16.45 9.45",
    "m 21.6 10.4 q -9 -9.05 -21.6 -10.4 l 32 0 l 0 32 l -0.1 -0.7 q -0.25 -2.3 -0.85 -4.45 q -2.3 -9.3 -9.45 -16.45",
    "m 21.6 21.6 q 9.05 -9 10.4 -21.6 l 0 32 l -32 0 l 0.7 -0.1 l 4.45 -0.85 q 9.3 -2.3 16.45 -9.45",
  ] },
  { name: "cornerRoundedInnerSmall", kind: "corner", partner: "", path: [
    "m 0 0 l 16 0 q 0 6.65 4.65 11.3 q 4.7 4.7 11.35 4.7 l 0 16 l -32 0 l 0 -32",
    "m 32 0 l 0 16 q -6.65 0 -11.3 4.65 q -4.7 4.7 -4.7 11.35 l -16 0 l 0 -32 l 32 0",
    "m 32 32 l -16 0 q 0 -6.65 -4.65 -11.3 q -4.7 -4.7 -11.35 -4.7 l 0 -16 l 32 0 l 0 32",
    "m 0 32 l 0 -16 q 6.65 0 11.3 -4.65 q 4.7 -4.7 4.7 -11.35 l 16 0 l 0 32 l -32 0",
  ] },
  { name: "cornerSmall", kind: "corner", partner: "", path: [
    "m 0 0 l 16 0 l 16 16 l 0 16 l -32 0 l 0 -32",
    "m 32 0 l 0 16 l -16 16 l -16 0 l 0 -32 l 32 0",
    "m 32 32 l -16 0 l -16 -16 l 0 -16 l 32 0 l 0 32",
    "m 0 32 l 0 -16 l 16 -16 l 16 0 l 0 32 l -32 0",
  ] },
  { name: "endEdge", kind: "tip", partner: "", path: [
    "m 0 0 l 16 0 l 16 16 l -16 16 l -16 0 l 0 -32",
    "m 32 0 l 0 16 l -16 16 l -16 -16 l 0 -16 l 32 0",
    "m 32 32 l -16 0 l -16 -16 l 16 -16 l 16 0 l 0 32",
    "m 0 32 l 0 -16 l 16 -16 l 16 16 l 0 16 l -32 0",
  ] },
  { name: "endRounded", kind: "tip", partner: "", path: [
    "m 0 0 l 16 0 q 6.6 0 11.3 4.7 q 4.7 4.7 4.7 11.3 q 0 6.65 -4.7 11.3 q -4.7 4.7 -11.3 4.7 l -16 0 l 0 -32",
    "m 32 0 l 0 16 q 0 6.6 -4.7 11.3 q -4.7 4.7 -11.3 4.7 q -6.65 0 -11.3 -4.7 q -4.7 -4.7 -4.7 -11.3 l 0 -16 l 32 0",
    "m 32 32 l -16 0 q -6.6 0 -11.3 -4.7 q -4.7 -4.7 -4.7 -11.3 q 0 -6.65 4.7 -11.3 q 4.7 -4.7 11.3 -4.7 l 16 0 l 0 32",
    "m 0 32 l 0 -16 q 0 -6.6 4.7 -11.3 q 4.7 -4.7 11.3 -4.7 q 6.65 0 11.3 4.7 q 4.7 4.7 4.7 11.3 l 0 16 l -32 0",
  ] },
  { name: "half", kind: "tip", partner: "", path: [
    "m 0 0 l 16 0 l 0 32 l -16 0 l 0 -32",
    "m 32 0 l 0 16 l -32 0 l 0 -16 l 32 0",
    "m 32 32 l -16 0 l 0 -32 l 16 0 l 0 32",
    "m 0 32 l 0 -16 l 32 0 l 0 16 l -32 0",
  ] },
  { name: "halfCornerInner", kind: "corner", partner: "", path: [
    "m 0 0 l 16 0 l 0 16 l 16 0 l 0 16 l -32 0 l 0 -32",
    "m 32 0 l 0 16 l -16 0 l 0 16 l -16 0 l 0 -32 l 32 0",
    "m 32 32 l -16 0 l 0 -16 l -16 0 l 0 -16 l 32 0 l 0 32",
    "m 0 32 l 0 -16 l 16 0 l 0 -16 l 16 0 l 0 32 l -32 0",
  ] },
  { name: "spike", kind: "corner", partner: "", path: [
    "m 0 16 l 32 -16 l -16 32 l -16 0 l 0 -16",
    "m 16 0 l 16 32 l -32 -16 l 0 -16 l 16 0",
    "m 32 16 l -32 16 l 16 -32 l 16 0 l 0 16",
    "m 16 32 l -16 -32 l 32 16 l 0 16 l -16 0",
  ] },
  { name: "triangle", kind: "tip", partner: "", path: [
    "m 0 0 l 32 16 l -32 16 l 0 -32",
    "m 32 0 l -16 32 l -16 -32 l 32 0",
    "m 32 32 l -32 -16 l 32 -16 l 0 32",
    "m 0 32 l 16 -32 l 16 32 l -32 0",
  ] },
  { name: "slantLeftTop", kind: "unique", partner: "slantRightTop", path: [
    "m 32 0 l -32 0 l 16 32 l 16 0 l 0 -32",
    "m 32 32 l 0 -32 l -32 16 l 0 16 l 32 0",
    "m 0 32 l 32 0 l -16 -32 l -16 0 l 0 32",
    "m 0 0 l 0 32 l 32 -16 l 0 -16 l -32 0",
  ] },
  { name: "slantRightTop", kind: "unique", partner: "slantLeftTop", path: [
    "m 32 0 l -32 0 l 0 32 l 16 0 l 16 -32",
    "m 32 32 l 0 -32 l -32 0 l 0 16 l 32 16",
    "m 0 32 l 32 0 l 0 -32 l -16 0 l -16 32",
    "m 0 0 l 0 32 l 32 0 l 0 -16 l -32 -16",
  ] },
  { name: "slantLeftBottom", kind: "unique", partner: "slantRightBottom", path: [
    "m 32 32 l 0 -32 l -16 0 l 16 32",
    "m 32 16 l -32 16 l 32 0 l 0 -16",
    "m 0 32 l 16 0 l -16 -32 l 0 32",
    "m 32 0 l -32 0 l 0 16 l 32 -16",
  ] },
  { name: "slantRightBottom", kind: "unique", partner: "slantLeftBottom", path: [
    "m 0 0 l 0 32 l 16 -32 l -16 0",
    "m 0 0 l 32 16 l 0 -16 l -32 0",
    "m 16 32 l 16 0 l 0 -32 l -16 32",
    "m 32 32 l -32 -16 l 0 16 l 32 0",
  ] },
  { name: "circleLeftBottom", kind: "unique", partner: "circleRightBottom", path: [
    "m 0 30 l 0 2 l 32 0 l 0 -32 l -23.7 0 q -7.8 13.5 -8.3 30",
    "m 2 0 l -2 0 l 0 32 l 32 0 l 0 -23.7 q -13.5 -7.8 -30 -8.3",
    "m 32 2 l 0 -2 l -32 0 l 0 32 l 23.7 0 q 7.8 -13.5 8.3 -30",
    "m 30 32 l 2 0 l 0 -32 l -32 0 l 0 23.7 q 13.5 7.8 30 8.3",
  ] },
  { name: "circleRightBottom", kind: "unique", partner: "circleLeftBottom", path: [
    "m 32 32 l 0 -2 q -0.5 -16.5 -8.3 -30 l -23.7 0 l 0 32 l 32 0",
    "m 0 32 l 2 0 q 16.5 -0.5 30 -8.3 l 0 -23.7 l -32 0 l 0 32",
    "m 0 0 l 0 2 q 0.5 16.5 8.3 30 l 23.7 0 l 0 -32 l -32 0",
    "m 32 0 l -2 0 q -16.5 0.5 -30 8.3 l 0 23.7 l 32 0 l 0 -32",
  ] },
  { name: "circleTop", kind: "corner", partner: "", path: [
    "m 23.7 32 q -4.1 -7.1 -10.3 -13.4 q -6.3 -6.2 -13.4 -10.3 l 0 23.7 l 23.7 0",
    "m 0 23.7 q 7.1 -4.1 13.4 -10.3 q 6.2 -6.3 10.3 -13.4 l -23.7 0 l 0 23.7",
    "m 8.3 0 q 4.1 7.1 10.3 13.4 q 6.3 6.2 13.4 10.3 l 0 -23.7 l -23.7 0",
    "m 18.6 18.6 q -6.2 6.3 -10.3 13.4 l 23.7 0 l 0 -23.7 q -7.1 4.1 -13.4 10.3",
  ] },
  { name: "quarter", kind: "corner", partner: "", path: [
    "m 16 16 l -16 0 l 0 16 l 16 0 l 0 -16",
    "m 16 0 l -16 0 l 0 16 l 16 0 l 0 -16",
    "m 16 0 l 0 16 l 16 0 l 0 -16 l -16 0",
    "m 16 32 l 16 0 l 0 -16 l -16 0 l 0 16",
  ] },
  { name: "edgeOuter", kind: "tip", partner: "", path: [
    "m 16 16 l -16 -16 l 0 32 l 16 -16",
    "m 16 16 l 16 -16 l -32 0 l 16 16",
    "m 16 16 l 16 16 l 0 -32 l -16 16",
    "m 32 32 l -16 -16 l -16 16 l 32 0",
  ] },
  { name: "edgeInner", kind: "tip", partner: "", path: [
    "m 16 16 l 16 -16 l -32 0 l 0 32 l 32 0 l -16 -16",
    "m 16 16 l 16 16 l 0 -32 l -32 0 l 0 32 l 16 -16",
    "m 16 16 l -16 16 l 32 0 l 0 -32 l -32 0 l 16 16",
    "m 16 16 l -16 -16 l 0 32 l 32 0 l 0 -32 l -16 16",
  ] },
];
