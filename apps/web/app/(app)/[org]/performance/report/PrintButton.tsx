"use client";

import { Button } from "@huntloop/ui";
import { Printer } from "lucide-react";

/** The browser's print dialog, where "Save as PDF" is one of the destinations. */
export function PrintButton() {
  return (
    <Button variant="primary" icon={Printer} onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
