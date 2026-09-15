import type { Detector, Evidence, PackageContext, Signal } from "./types.js";

export const publisherDetector: Detector = {
  code: "DC012",
  title: "Publisher identity changed",
  defaultSeverity: "low",
  summary:
    "When registry metadata exposes a per-version publisher, flags a change between versions. " +
    "Omitted entirely when registry data is unavailable rather than guessing.",

  analyze(ctx: PackageContext): Signal[] {
    if (!ctx.publisher) return [];
    return [{ identity: "publisher", detail: ctx.publisher, confidence: "high" }];
  },

  diff(oldSignals: Signal[], newSignals: Signal[]): Evidence[] {
    const oldPub = oldSignals.find((s) => s.identity === "publisher");
    const newPub = newSignals.find((s) => s.identity === "publisher");
    if (!oldPub || !newPub) return [];
    if (oldPub.detail === newPub.detail) return [];
    return [
      {
        code: "DC012",
        severity: "low",
        confidence: "medium",
        title: "Publisher identity changed",
        description:
          `The publishing account changed from "${oldPub.detail}" to "${newPub.detail}". ` +
          "This is a review signal, not proof of compromise.",
        oldValue: oldPub.detail,
        newValue: newPub.detail
      }
    ];
  }
};
