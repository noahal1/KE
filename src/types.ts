export type Lang = "zh" | "en";
export type Unit = "kg" | "lb";

export interface Exercise {
  id: number;
  slug: string;
  name_en: string;
  name_zh: string;
  equipment: string;
  category: string;
  pattern: string;
  primary_muscles: string;
  secondary_muscles: string;
  is_custom: number;
}

export interface Plan {
  id: number;
  name: string;
  notes: string;
  created_at: string;
}

export interface PlanDay {
  id: number;
  plan_id: number;
  name: string;
  day_order: number;
}

export interface PlanExercise {
  id: number;
  day_id: number;
  exercise_id: number;
  target_sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number;
  exercise_order: number;
  notes: string;
  // joined
  name_en?: string;
  name_zh?: string;
  equipment?: string;
}

export interface Session {
  id: number;
  plan_day_id: number | null;
  name: string;
  started_at: string;
  finished_at: string | null;
  notes: string;
  // joined aggregates (nullable)
  set_count?: number;
  total_volume?: number;
  max_weight?: number;
}

export interface SetLog {
  id: number;
  session_id: number;
  exercise_id: number;
  set_number: number;
  weight_kg: number;
  /** Effective load incl. body-relative portion for bodyweight work (null
   *  for legacy rows / weighted lifts — volume falls back to weight_kg). */
  load_kg?: number | null;
  reps: number;
  rpe: number | null;
  is_warmup: number;
  is_pr: number;
  // joined
  name_en?: string;
  name_zh?: string;
}

export interface DayExerciseDraft {
  exercise_id: number;
  target_sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number;
}

/** Weekly recurring slot: which weekday a plan day is scheduled on (0=Sun..6=Sat). */
export interface PlanDaySchedule {
  id: number;
  plan_day_id: number;
  weekday: number;
}
