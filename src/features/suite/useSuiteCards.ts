import { useState } from "react";
import { suiteFixture } from "../../api/fixtures";
import type { SuiteCard } from "../../api/contracts";

export function useSuiteCards() {
  return useState<SuiteCard[]>(
    suiteFixture.cards.map((card) => ({ ...card, status: "generated" })),
  );
}
