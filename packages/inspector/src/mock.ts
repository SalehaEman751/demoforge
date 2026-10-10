import {
  ElementInventorySchema,
  ProjectBriefSchema,
  loadFixture,
  type InspectProjectFn,
} from "@demoforge/shared";

export const inspectProject: InspectProjectFn = async () => ({
  brief: loadFixture("brief.json", ProjectBriefSchema),
  inventory: loadFixture("element-inventory.json", ElementInventorySchema),
});
