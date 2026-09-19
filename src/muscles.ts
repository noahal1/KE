/** Parses the CSV muscle columns of an exercise into trimmed key lists. */
export function parseMuscles(primary: string, secondary = "") {
  const split = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return { primary: split(primary), secondary: split(secondary) };
}

/**
 * Coarse body-part buckets used to summarize what a plan/day trains
 * (e.g. "胸 · 背 · 腿"). Fine-grained muscle keys map into these.
 */
const BODY_PART_OF: Record<string, string> = {
  chest: "chest",
  lats: "back",
  "upper-back": "back",
  traps: "back",
  "rear-delts": "shoulders",
  "side-delts": "shoulders",
  "front-delts": "shoulders",
  shoulders: "shoulders",
  biceps: "arms",
  triceps: "arms",
  forearms: "arms",
  quads: "legs",
  hamstrings: "legs",
  glutes: "legs",
  adductors: "legs",
  calves: "legs",
  abs: "core",
  obliques: "core",
  core: "core",
  "lower-back": "back",
  neck: "shoulders",
  tibialis: "legs",
  "hip-flexors": "core",
};

/**
 * Summarizes a list of exercises (by their muscle CSV columns) into ordered,
 * deduplicated body-part keys — primary muscles first, then secondary.
 */
export function summarizeBodyParts(
  exercises: { primary_muscles: string; secondary_muscles?: string | null }[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ex of exercises) {
    const { primary, secondary } = parseMuscles(
      ex.primary_muscles,
      ex.secondary_muscles ?? "",
    );
    for (const m of [...primary, ...secondary]) {
      const part = BODY_PART_OF[m];
      if (part && !seen.has(part)) {
        seen.add(part);
        result.push(part);
      }
    }
  }
  return result;
}
