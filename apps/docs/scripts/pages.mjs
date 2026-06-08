export const pages = [
  { source: "index.md", output: "index.html", title: "Overview", section: "Start" },
  {
    source: "guide/getting-started.md",
    output: "guide/getting-started/index.html",
    title: "Getting Started",
    section: "Start",
  },
  {
    source: "guide/agentic-setup.md",
    output: "guide/agentic-setup/index.html",
    title: "Agentic Setup",
    section: "Start",
  },
  {
    source: "guide/deploy.md",
    output: "guide/deploy/index.html",
    title: "Deploy",
    section: "Start",
  },
  {
    source: "guide/turbo-client.md",
    output: "guide/turbo-client/index.html",
    title: "Turbo Client Setup",
    section: "Start",
  },
  {
    source: "guide/architecture.md",
    output: "guide/architecture/index.html",
    title: "Architecture",
    section: "Core Concepts",
  },
  {
    source: "guide/configuration.md",
    output: "guide/configuration/index.html",
    title: "Configuration",
    section: "Core Concepts",
    children: [
      {
        source: "guide/storage-retention.md",
        output: "guide/storage-retention/index.html",
        title: "Storage & Retention",
      },
      {
        source: "guide/auth-teams.md",
        output: "guide/auth-teams/index.html",
        title: "Auth & Teams",
      },
      {
        source: "guide/branches-signatures.md",
        output: "guide/branches-signatures/index.html",
        title: "Branches & Signatures",
      },
    ],
  },
  {
    source: "reference/api.md",
    output: "reference/api/index.html",
    title: "API Reference",
    section: "Reference",
  },
  {
    source: "reference/examples.md",
    output: "reference/examples/index.html",
    title: "Examples",
    section: "Reference",
  },
  {
    source: "guide/operations.md",
    output: "guide/operations/index.html",
    title: "Operations",
    section: "Reference",
  },
  {
    source: "guide/troubleshooting.md",
    output: "guide/troubleshooting/index.html",
    title: "Troubleshooting",
    section: "Reference",
  },
];

export function allPages() {
  const result = [];
  for (const page of pages) {
    result.push(page);
    if (page.children) {
      for (const child of page.children) {
        result.push({ ...child, section: page.section, parent: page.title });
      }
    }
  }
  return result;
}

export function hrefFor(page) {
  return page.output === "index.html" ? "/" : `/${page.output.replace(/index\.html$/, "")}`;
}
