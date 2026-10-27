export interface DiscountCode {
  code: string;
  percent: number;
}

export const CODES: DiscountCode[] = [
  { code: "WELCOME10", percent: 10 },
  { code: "SUMMER25", percent: 25 },
];
