import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@cloudflare/kumo/components/button";

import {
  RocketLaunch,
  Stack,
  BookOpen,
  GithubLogo,
  ArrowRight,
  Lightning,
  HardDrives,
  Key,
  Wrench,
  ArrowSquareOut,
  CaretDown,
  Globe,
  ShieldCheck,
  TreeStructure,
  List,
  X,
} from "@phosphor-icons/react";

const REPO = "https://github.com/vaishnav-mk/turboflare";
const ISSUES = `${REPO}/issues`;
const TWITTER = "https://x.com/wishee0";
const DEPLOY = "https://deploy.workers.cloudflare.com/?url=" + REPO;

function LinkButton({ href, className, children, ...rest }) {
  return (
    <a href={href} className={`btn-link${className ? " " + className : ""}`}>
      <Button tabIndex={-1} {...rest}>
        {children}
      </Button>
    </a>
  );
}

const SECTION_ICONS = { Start: RocketLaunch, "Core Concepts": Stack, Reference: BookOpen };

function SidebarNav({ pages, hrefFor, current }) {
  const sections = [...new Set(pages.filter((p) => !p.parent).map((p) => p.section))];

  function isActive(p) {
    return p.output === current.output;
  }
  function isInGroup(p) {
    if (isActive(p)) return true;
    return p.children?.some((c) => c.output === current.output) ?? false;
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <div className="sidebar-header">
          <a href="/" className="brand">
            <img src="/logo.svg" alt="Turboflare logo" width={20} height={20} />
            <span className="brand-name">Turboflare</span>
          </a>
          <button
            className="sidebar-close"
            type="button"
            data-nav-close="true"
            aria-label="Close menu"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => {
            const Icon = SECTION_ICONS[section] ?? BookOpen;
            const items = pages.filter((p) => p.section === section && !p.parent);
            return (
              <div className="nav-section" key={section}>
                <div className="nav-label">
                  <Icon size={11} weight="bold" />
                  {section}
                </div>
                <ul className="nav-list">
                  {items.map((p) => {
                    const active = isActive(p);
                    const open = isInGroup(p);
                    return (
                      <li key={p.output}>
                        <a
                          className={`nav-item${active ? " active" : ""}`}
                          href={hrefFor(p)}
                          aria-current={active ? "page" : undefined}
                        >
                          {p.title}
                          {p.children && (
                            <CaretDown
                              size={10}
                              weight="bold"
                              className={`nav-caret${open ? " open" : ""}`}
                            />
                          )}
                        </a>
                        {p.children && open && (
                          <ul className="nav-sub-list">
                            {p.children.map((c) => (
                              <li key={c.output}>
                                <a
                                  className={`nav-item sub${isActive(c) ? " active" : ""}`}
                                  href={hrefFor(c)}
                                  aria-current={isActive(c) ? "page" : undefined}
                                >
                                  {c.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <LinkButton href={DEPLOY} variant="primary" size="sm" className="sidebar-cta">
            Deploy to Cloudflare
          </LinkButton>
          <a href={REPO} className="sidebar-gh" target="_blank" rel="noopener">
            <GithubLogo size={14} weight="bold" />
            <span>GitHub</span>
            <ArrowSquareOut size={10} className="sidebar-ext" />
          </a>
          <a href={ISSUES} className="sidebar-gh" target="_blank" rel="noopener">
            <GithubLogo size={14} weight="bold" />
            <span>Issues</span>
            <ArrowSquareOut size={10} className="sidebar-ext" />
          </a>
          <a href={TWITTER} className="sidebar-gh" target="_blank" rel="noopener">
            <span className="sidebar-mark">X</span>
            <span>@wishee0</span>
            <ArrowSquareOut size={10} className="sidebar-ext" />
          </a>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ current, pages, hrefFor }) {
  const sections = [...new Set(pages.filter((p) => !p.parent).map((p) => p.section))];
  const currentSection = current.section || "Start";
  const sectionPages = pages.filter((p) => p.section === currentSection && !p.parent);

  return (
    <header className="topbar">
      <button className="nav-toggle" type="button" data-nav-toggle="true" aria-label="Open menu">
        <List size={17} weight="bold" />
        <span>Menu</span>
      </button>
      <nav className="topbar-nav">
        <a href="/" className="crumb-link">
          Docs
        </a>
        <span className="crumb-sep">/</span>
        <select className="crumb-select" defaultValue={currentSection} data-section-select="true">
          {sections.map((s) => {
            const first = pages.find((p) => p.section === s && !p.parent);
            return (
              <option key={s} value={s} data-href={first ? hrefFor(first) : "/"}>
                {s}
              </option>
            );
          })}
        </select>
        <span className="crumb-sep">/</span>
        <select
          className="crumb-select crumb-page"
          defaultValue={hrefFor(current)}
          data-page-select="true"
        >
          {sectionPages.map((p) => {
            const group = p.children ? [p, ...p.children] : [p];
            return group.map((g) => (
              <option key={g.output} value={hrefFor(g)}>
                {g.parent ? `\u00A0\u00A0${g.title}` : g.title}
              </option>
            ));
          })}
        </select>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.addEventListener('change',function(e){var t=e.target;if(t&&t.dataset.sectionSelect){var o=t.options[t.selectedIndex];if(o&&o.dataset.href)location.href=o.dataset.href}if(t&&t.dataset.pageSelect){location.href=t.value}});document.addEventListener('click',function(e){var t=e.target;if(t.closest('[data-nav-toggle]'))document.body.classList.add('nav-open');if(t.closest('[data-nav-close]')||t.classList.contains('sidebar-backdrop'))document.body.classList.remove('nav-open')});document.addEventListener('keydown',function(e){if(e.key==='Escape')document.body.classList.remove('nav-open')})",
          }}
        />
      </nav>
    </header>
  );
}

const FEATURES = [
  {
    icon: HardDrives,
    title: "R2 artifact storage",
    body: "Durable cache artifacts in your Cloudflare account.",
    link: "/guide/storage-retention/",
  },
  {
    icon: Lightning,
    title: "Works with Turbo",
    body: "Use standard Turbo remote cache env vars. No client fork.",
    link: "/reference/api/",
  },
  {
    icon: Key,
    title: "Flexible auth",
    body: "Start with one token. Add scopes and teams later.",
    link: "/guide/auth-teams/",
  },
  {
    icon: Globe,
    title: "Edge-fast reads",
    body: "Serve repeated reads from nearby Cloudflare PoPs.",
    link: "/guide/architecture/",
  },
  {
    icon: TreeStructure,
    title: "Branch isolation",
    body: "Share main cache safely without trusting every PR.",
    link: "/guide/branches-signatures/",
  },
  {
    icon: ShieldCheck,
    title: "Signature enforcement",
    body: "Require signed uploads when CI needs stricter integrity.",
    link: "/guide/branches-signatures/",
  },
  {
    icon: Wrench,
    title: "Ops built-in",
    body: "Retention, cleanup, stats, purge, and metrics hooks.",
    link: "/guide/operations/",
  },
  {
    icon: RocketLaunch,
    title: "One-click deploy",
    body: "Deploy Worker + R2, set a token, point Turbo at it.",
    link: "/guide/deploy/",
  },
];

function Hero() {
  return (
    <div className="hero">
      <div className="hero-banner">
        <div className="hero-left">
          <span className="hero-eyebrow">Cloudflare-native Turborepo remote cache</span>
          <h1 className="hero-title">Turboflare</h1>
          <p className="hero-lede">
            A fast, self-hosted remote cache backed by Workers and R2. One token to start. Zero
            servers to manage.
          </p>
          <div className="hero-actions">
            <LinkButton href={DEPLOY} variant="primary" size="base">
              Deploy to Cloudflare
            </LinkButton>
            <LinkButton
              href="/guide/getting-started/"
              variant="secondary"
              size="base"
              icon={<ArrowRight size={14} weight="bold" />}
            >
              Get started
            </LinkButton>
          </div>
        </div>
        <div className="hero-right">
          {[
            ["Worker + R2", "default architecture"],
            ["Turbo-compatible", "standard remote cache"],
            ["0 servers", "no infra to manage"],
          ].map(([v, l]) => (
            <div className="hero-stat" key={v}>
              <span className="hero-stat-val">{v}</span>
              <span className="hero-stat-label">{l}</span>
            </div>
          ))}
        </div>
      </div>
      <h2 className="feat-heading">Everything you need</h2>
      <div className="feat-grid">
        {FEATURES.map((f) => {
          const I = f.icon;
          return (
            <a className="feat-card" href={f.link} key={f.title}>
              <div className="feat-icon">
                <I size={16} weight="duotone" />
              </div>
              <h3 className="feat-title">{f.title}</h3>
              <p className="feat-body">{f.body}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

const TIPS = [
  "Set TURBO_TEAM to namespace artifacts per project.",
  "Use ARTIFACT_STORE=kv to try KV storage (25 MiB limit).",
  "The /internal/* endpoints need INTERNAL_ADMIN_TOKEN.",
  "Run pnpm deploy to create R2 bucket + deploy Worker.",
  "Branch policy main-write-pr-read shares cache safely.",
  "SIGNATURE_POLICY=require enforces x-artifact-tag on PUT.",
  "R2 lifecycle rules auto-expire old artifacts after 30 days.",
  "Use --remote-only to skip local cache and always hit remote.",
  "TURBO_TOKEN_SCOPES limits tokens to read, write, or both.",
  "The cleanup cron runs at 03:17 UTC daily by default.",
  "Cache API reads are sub-millisecond at the nearest PoP.",
  "Set CACHE_STATUS=enabled to activate Cache API acceleration.",
];

function getSuggestions(page, pages, hrefFor) {
  const flat = pages.filter((p) => p.output !== "404.html");
  const idx = flat.findIndex((p) => p.output === page.output);
  const result = [];
  if (idx > 0) result.push({ label: "Previous", ...flat[idx - 1], href: hrefFor(flat[idx - 1]) });
  if (idx >= 0 && idx < flat.length - 1)
    result.push({ label: "Next", ...flat[idx + 1], href: hrefFor(flat[idx + 1]) });
  const related = flat
    .filter((p) => p.section === page.section && p.output !== page.output)
    .slice(0, 3);
  for (const r of related) {
    if (!result.some((s) => s.output === r.output)) {
      result.push({ label: page.section, ...r, href: hrefFor(r) });
    }
  }
  return result.slice(0, 4);
}

function Toc({ toc, page, pages, hrefFor }) {
  const suggestions = page.output !== "index.html" ? getSuggestions(page, pages, hrefFor) : [];
  const hasToc = toc.length > 0;
  const tipIdx = Math.abs(hashStr(page.output)) % TIPS.length;
  const tip = TIPS[tipIdx];
  if (!hasToc && !suggestions.length) return <aside className="toc-col" />;
  return (
    <aside className="toc-col">
      <div className="toc-sticky">
        {hasToc && (
          <>
            <div className="toc-label">On this page</div>
            <ul className="toc-list" id="toc-list">
              {toc.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "toc-sub" : undefined}>
                  <a className="toc-link" href={`#${h.id}`} data-id={h.id}>
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {suggestions.length > 0 && (
          <div className={`toc-suggest${hasToc ? " has-toc" : ""}`}>
            <div className="toc-label">Suggested</div>
            {suggestions.map((s) => (
              <a className="suggest-link" href={s.href} key={s.output}>
                <span className="suggest-title">{s.title}</span>
                <span className="suggest-badge">{s.label}</span>
              </a>
            ))}
          </div>
        )}
        <div className="toc-tip">
          <div className="toc-tip-label">Tip</div>
          <div className="toc-tip-text">{tip}</div>
        </div>
      </div>
    </aside>
  );
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function Shell({ page, pages, hrefFor, bodyHtml, toc, isHome }) {
  return (
    <div className="shell">
      <button
        className="sidebar-backdrop"
        type="button"
        data-nav-close="true"
        aria-label="Close menu"
      />
      <SidebarNav pages={pages} hrefFor={hrefFor} current={page} />
      <header className="topbar-wrap">
        <Topbar current={page} pages={pages} hrefFor={hrefFor} />
      </header>
      <main className="content-col">
        {isHome && <Hero />}
        <article className="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </main>
      <Toc toc={toc} page={page} pages={pages} hrefFor={hrefFor} />
    </div>
  );
}

export function renderBody(props) {
  return renderToStaticMarkup(<Shell {...props} />);
}
