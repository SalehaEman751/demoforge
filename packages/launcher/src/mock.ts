import {
  LaunchInfoSchema,
  loadFixture,
  type LaunchProjectFn,
} from "@demoforge/shared";

export const launchProject: LaunchProjectFn = async () => ({
  info: loadFixture("launch-info.json", LaunchInfoSchema),
  stop: async () => {},
});
