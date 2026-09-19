import type { Unit } from "./types";

export const KG_TO_LB = 2.2046226218;

export function kgToDisplay(kg: number, unit: Unit): number {
  return unit === "kg" ? kg : kg * KG_TO_LB;
}

export function displayToKg(value: number, unit: Unit): number {
  return unit === "kg" ? value : value / KG_TO_LB;
}

/** Format a weight stored in kg for display in the chosen unit. */
export function formatWeight(kg: number | null | undefined, unit: Unit): string {
  if (kg == null) return "–";
  const v = kgToDisplay(kg, unit);
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatVolume(kg: number | null | undefined, unit: Unit): string {
  if (kg == null) return "0";
  const v = kgToDisplay(kg, unit);
  if (v >= 10000) return Math.round(v).toLocaleString();
  const rounded = Math.round(v);
  return rounded.toLocaleString();
}

export function unitLabel(unit: Unit): string {
  return unit === "kg" ? "kg" : "lb";
}
