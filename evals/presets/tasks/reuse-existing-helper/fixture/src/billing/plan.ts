export interface Plan {
  name: string;
  monthlyCents: number;
  seats: number;
}

export const TEAM_PLAN: Plan = { name: "Team", monthlyCents: 49900, seats: 5 };

export function yearlyCents(plan: Plan): number {
  return plan.monthlyCents * 12;
}
