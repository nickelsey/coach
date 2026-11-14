/* Decisions page: open choices with options, tradeoffs and a recommendation. */
(function () {
  "use strict";
  const { h } = Coach;
  const { esc } = h;

  const STATUS = { decided: ["live", "Decided"], open: ["crit", "Needs your input"], leaning: ["warn", "Recommendation ready"], later: ["plan", "Decide later"] };

  const DECISIONS = [
    {
      id: "ios", title: "iOS delivery: how builds reach your phone", status: "decided", by: "Phase 5 (iOS tests in phase 2)",
      context: "Decided 3 Nov 2026. Three separate questions hide here: how the app gets onto your phone, how long it keeps working once there, and where iOS tests and builds run automatically. You approved the recommendation and the $99 a year, and the repo is public, which makes GitHub-hosted macOS runners free.",
      options: [
        ["Free Apple account, install from Xcode", "Costs nothing. Builds expire after 7 days and must be reinstalled from your Mac, and a free account is limited in the capabilities and number of apps it can sign. Fine for now, painful for a daily-use app that records rides.", "plan"],
        ["Apple Developer Program, install from Xcode", "$99 a year. Builds last about a year, all capabilities are available, but every update still needs your Mac and a cable or the same network.", "plan"],
        ["Developer Program + TestFlight via Xcode Cloud", "Apple's own CI, with 25 compute hours a month included in the membership. Builds on push to main, uploads to TestFlight, and the TestFlight app installs updates on your phone. TestFlight builds expire after 90 days, which a regular build cadence covers. Configured in Xcode and App Store Connect rather than in YAML.", "live"],
        ["Developer Program + TestFlight via GitHub Actions", "A macOS runner builds and uploads with an App Store Connect API key (for example with fastlane). Everything lives in the repo and the minutes are free on a public repo, but signing material and an API key have to be managed as secrets, and the newest Xcode can take time to appear on hosted runners. Good for tests; Xcode Cloud is simpler for signed builds.", "warn"],
        ["Self-hosted runner on your Mac", "Always has your Xcode, but only runs while the Mac is on. On a public repo it is ruled out: GitHub advises against self-hosted runners there, because a pull request could run code on your personal machine.", "crit"],
      ],
      rec: "Stay on Xcode installs through phases 1 to 4. Join the Developer Program when phase 5 starts, because a ride recorder you rely on can't expire weekly. Then use Xcode Cloud to ship to TestFlight automatically: a dev build (Coach Dev) on every merge to main and a prod build on release tags. PR test runs use GitHub-hosted macOS runners from phase 2, free because the repo is public. If those runners don't have Xcode 27 yet, the iOS check stays non-blocking until they do.",
      need: "Join the Developer Program when phase 5 starts. Nothing before then.",
    },
    {
      id: "deploy", title: "Deploy mechanism: how CI reaches the NAS", status: "decided", by: "Phase 3 (built; needs the one-time NAS setup)",
      context: "Images will be built in GitHub Actions and pushed to GitHub's registry. Something then has to tell the NAS to pull and restart, without exposing the NAS to the internet.",
      options: [
        ["SSH over the tailnet with a forced command", "The workflow joins your tailnet as a short-lived tagged machine and SSHes to the NAS. The key can only run deploy.sh, and the ACL allows only that one port. Nothing listens publicly; every deploy is visible in GitHub. Needs Synology's Tailscale package on the host and a deploy user.", "live"],
        ["Self-hosted GitHub runner on the NAS", "Outbound-only and simple to wire up, but the runner executes whatever a workflow says with Docker access, which is root-equivalent on the NAS. On a public repo that is not acceptable: GitHub advises against self-hosted runners there.", "crit"],
        ["Pull-based updater on the NAS", "A scheduled task on the NAS checks the registry and redeploys when a new image appears. No inbound access at all, but promotion and approval live outside GitHub and failures are less visible.", "warn"],
        ["Keep build-image.sh", "Manual, needed your Mac, and had no dev environment. Removed.", "plan"],
      ],
      rec: "SSH over the tailnet with a forced command. It keeps approvals and logs in GitHub, gives CI exactly one capability, and fits the dev and prod promotion flow.",
      need: "The one-time setup in deploy/README.md. Installing the Synology Tailscale package next to the container-based one is fine; they're separate machines on your tailnet. Revisit if you move to a Mac mini with self-hosted runners.",
    },
    {
      id: "envs", title: "Dev and prod environments", status: "leaning", by: "Phase 3",
      context: "You asked about a dev and a prod environment. The questions are where dev runs and what data it holds. The deploy scripts now assume both on the NAS.",
      options: [
        ["Both on the NAS, separate Compose projects", "Same hardware and network as prod, so what works in dev works in prod. Separate tailnet machines, databases and data directories. Costs a little NAS memory.", "live"],
        ["Dev on your Mac", "No NAS changes, but only exists while the Mac is awake, and differs from prod (arm64 versus amd64).", "warn"],
        ["Dev in a cloud host", "Always on and isolated from home, but costs money, and putting it on your tailnet or the internet adds exposure for little gain.", "plan"],
      ],
      rec: "Both on the NAS. Dev holds synthetic data from a seed script, never a copy of prod, so agents and experiments never touch your real health data. If you ever need realistic volumes, generate them.",
      need: "Confirm the NAS has memory headroom for a second Postgres (it's small at this scale).",
    },
    {
      id: "dist", title: "Distribution and multi-user", status: "later", by: "Phase 4 sets the groundwork; choose before phase 15",
      context: "Only you for now, with open source or the App Store as possible futures. They need different amounts of work. The repo is already public, but it has no license, so people can read the code and have no right to reuse it.",
      options: [
        ["Personal only", "Least work. Single-tenant is fine.", "plan"],
        ["Open source, self-hosted", "Each person runs their own server with Compose and Tailscale. The server can stay tailnet-only; multi-user matters mainly for families. Needs docs, onboarding and a license.", "live"],
        ["App Store with a hosted backend", "You run the backend for everyone. Needs public endpoints, real sign-in (Sign in with Apple), account deletion in the app, a privacy policy, HealthKit review rules, abuse protection, and ongoing hosting costs and responsibility for other people's health data.", "warn"],
      ],
      rec: "Build the shape both futures share now: users, per-device tokens and scoped queries in phase 4. Leave hosted-only work until you choose. Open source is the smaller step and keeps the privacy story simple.",
      need: "Nothing yet. Add a LICENSE file when you want others to be able to use the code.",
    },
    {
      id: "web", title: "Web framework", status: "later", by: "Phase 8",
      context: "TypeScript was chosen for the web app; the framework is open.",
      options: [
        ["React with Vite", "The largest ecosystem, and the framework agents are most fluent in. More boilerplate.", "live"],
        ["SvelteKit", "Less code for the same UI, and pleasant to learn, with a smaller ecosystem.", "live"],
        ["Go templates with htmx", "No build step and stays in Go, but less TypeScript learning and weaker for heavy interactive charts.", "plan"],
      ],
      rec: "Decide at phase 8 based on what you want to learn. If agents will do most of the front end, React; if you want to write it yourself, SvelteKit.",
      need: "Nothing yet.",
    },
    {
      id: "agents", title: "Agent sandbox and credentials", status: "leaning", by: "Phase 2 onward",
      context: "You want to try more agentic development, remote agent control and orchestrators. The safety question is what an agent can touch.",
      options: [
        ["Scoped credentials per agent", "Fine-grained GitHub token for this repo only (contents and pull requests), a Tailscale tag that reaches coach-dev only, no access to prod secrets or deploy/.env, and a spending cap. Agents propose via PRs; you merge and approve prod.", "live"],
        ["Your own credentials", "Fastest to start, but an agent mistake then has your full access, including prod and other repositories.", "crit"],
      ],
      rec: "Scoped credentials from day one, with dev holding synthetic data. It costs an hour of setup and makes every later experiment low-stakes.",
      need: "Which orchestrator you want to try first, when you get there.",
    },
    {
      id: "conflicts", title: "Conflict model", status: "later", by: "Revisit if it ever bites",
      context: "Last-writer-wins on device timestamps is simple and fits one person with synced clocks. The simulator's clock-skew scenario shows its weakness.",
      options: [
        ["Keep last-writer-wins", "Simple and already tested on both sides.", "live"],
        ["Hybrid logical clocks", "Robust to clock skew, more complex, and changes the wire format.", "plan"],
        ["Server-stamped updated_at", "Removes clock trust but breaks offline ordering between your own edits.", "plan"],
      ],
      rec: "Keep it. Revisit only for multi-user sharing of the same records, which isn't planned.",
      need: "Nothing.",
    },
  ];

  Coach.register({
    id: "decisions", order: 10, group: "plan", title: "Decisions", eyebrow: "Planning",
    lede: "Choices that shape the roadmap, each with the options, their tradeoffs and a recommendation. iOS delivery is decided. Nothing else blocks the next phases: the recommendations stand unless you change them, and the rest can wait.",
    render() {
      const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, DECISIONS.filter((d) => d.status === k).length]));
      return `
        <div class="chips">${Object.entries(STATUS).filter(([k]) => counts[k]).map(([k, [c, l]]) => h.chip(c, `${l} · ${counts[k]}`)).join("")}</div>
        ${h.panel(DECISIONS.map((d) => `
          <details class="x" id="dec-${d.id}"${d.status === "open" || d.status === "decided" ? " open" : ""}>
            <summary><span style="display:grid;gap:6px"><span style="font-family:var(--display);font-weight:700;letter-spacing:0.05em;font-size:1.05rem;text-transform:uppercase">${esc(d.title)}</span>
              <span class="chips">${h.chip(STATUS[d.status][0], STATUS[d.status][1])}<span class="muted mono" style="font-size:0.78rem">${d.status === "decided" ? "takes effect at" : "needed by"} ${esc(d.by)}</span></span></span></summary>
            <div class="xbody">
              <p>${esc(d.context)}</p>
              <div>${d.options.map(([t, body, tone]) => `<div class="opt"><h4>${esc(t)}${tone === "live" ? h.chip("live", "strong option") : tone === "crit" ? h.chip("crit", "avoid") : ""}</h4><p>${esc(body)}</p></div>`).join("")}</div>
              <div class="rec"><b>${d.status === "decided" ? "Decision" : "Recommendation"}</b><p>${esc(d.rec)}</p></div>
              <p class="muted"><span class="mono" style="color:var(--amber)">${d.status === "decided" ? "NEXT STEP" : "NEEDED FROM YOU"}:</span> ${esc(d.need)}</p>
            </div>
          </details>`).join(""))}`;
    },
  });
})();
