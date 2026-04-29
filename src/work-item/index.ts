import type { WorkItem } from "../core/index.js";

export type { ChangeRequest, WorkItem } from "../core/index.js";

export const sampleLocalWorkItem: WorkItem = {
  id: "sample-local-work-item",
  title: "Sample local work item",
  source: "local-sample",
  status: "ready",
};
