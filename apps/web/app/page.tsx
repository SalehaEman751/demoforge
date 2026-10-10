"use client";

import { HealthBanner } from "../components/HealthBanner";
import { JobForm } from "../components/JobForm";
import { RecentJobs } from "../components/RecentJobs";
import { useHealth } from "../lib/useHealth";
import { problems, warningCopy } from "../lib/health-view";

export default function Home() {
  const state = useHealth();
  const red = state.unreachable ? 1 : problems(state.health).length;
  const mocks = !state.unreachable && state.health?.mocks === true;
  const setupWarning = red > 0 ? { text: warningCopy(red, mocks).form, mild: mocks } : undefined;

  return (
    <div className="space-y-12">
      <header className="pt-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Turn your project into a demo video</h1>
        <p className="mx-auto mt-5 max-w-2xl text-xl text-slate-700">
          Point DemoForge at a web project, say what the demo should show, and get a recorded walkthrough.
        </p>
      </header>
      <HealthBanner state={state} />
      <JobForm setupWarning={setupWarning} />
      <RecentJobs />
    </div>
  );
}
