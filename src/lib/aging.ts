/** Change in production from one season to the next, by the age he'll be. */
export function ageGrowth(age: number): number {
  if (age <= 20) return 0.08;
  if (age <= 22) return 0.06;
  if (age <= 24) return 0.04;
  if (age <= 26) return 0.02;
  if (age <= 29) return 0;
  if (age <= 31) return -0.03;
  if (age <= 33) return -0.06;
  return -0.1;
}
