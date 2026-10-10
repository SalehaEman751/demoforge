import { JobSchema, loadFixture, type Job } from "@demoforge/shared";

export type RunJobFn = (args: {
  projectSource: string;
  instructions: string;
}) => Promise<Job>;

/** Mock job runner: returns the finished fixture job without launching or recording anything. */
export const runJob: RunJobFn = async () => loadFixture("job.json", JobSchema);
