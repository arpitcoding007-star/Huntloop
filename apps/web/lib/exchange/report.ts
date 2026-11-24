/** Why something on the Exchange can be reported (0065, build plan DN-32). */
export const REPORT_REASONS = [
  { value: "spam", label: "Spam or unsolicited promotion" },
  { value: "fake_buyer", label: "Not a real request" },
  { value: "misrepresentation", label: "Misleading claims" },
  { value: "prohibited", label: "Prohibited goods or services" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "privacy", label: "Shares someone's private details" },
  { value: "other", label: "Something else" },
] as const;

export type ReportSubject = "need" | "offering" | "provider" | "intro" | "message";
