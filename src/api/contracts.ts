export type SuiteStatus = "draft" | "in_progress";

export interface SuiteCard {
  id: string;
  title: string;
  type: string;
  prompt: string;
  image: string;
  ratio: string;
  size: string;
  model: string;
  template: string;
  status?: "generated" | "generating";
}

export interface SuiteFixture {
  id: string;
  product: string;
  site: string;
  status: SuiteStatus;
  cards: SuiteCard[];
}
