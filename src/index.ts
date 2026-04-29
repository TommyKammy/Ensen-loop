export interface ProductIdentity {
  readonly name: string;
  readonly role: string;
  readonly successorTo: string;
  readonly independent: boolean;
}

export const productIdentity: ProductIdentity = {
  name: "Ensen-loop",
  role: "development lane engine",
  successorTo: "codex-supervisor",
  independent: true
};

export function describeProduct(): string {
  return `${productIdentity.name} is an independent ${productIdentity.role} and successor product to ${productIdentity.successorTo}.`;
}

export * from "./core/index.js";
export * from "./lane/index.js";
export * from "./protocol/index.js";
export * from "./work-item/index.js";
