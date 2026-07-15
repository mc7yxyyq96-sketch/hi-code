export const HICODE_DESIGN_SYSTEM = Object.freeze({
  id: "hicode-industrial-v1",
  density: "workbench",
  supportedWidths: Object.freeze([720, 800, 1100, 1440, 1920] as const),
  breakpoints: Object.freeze({
    compactMaximum: 820,
    inspectorDrawerMaximum: 900,
    timelineDrawerMaximum: 1180,
  }),
});

export type HiCodeViewportTier = "compact" | "workbench" | "wide";

export function viewportTier(width: number): HiCodeViewportTier {
  if (!Number.isFinite(width) || width <= HICODE_DESIGN_SYSTEM.breakpoints.compactMaximum) return "compact";
  if (width <= HICODE_DESIGN_SYSTEM.breakpoints.timelineDrawerMaximum) return "workbench";
  return "wide";
}
