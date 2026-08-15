# Ledger — Personal Finance Web App

**All 12 phases complete.** Full build notes and honest caveats below.

## Run it

No build step, no server required. Just open `index.html` in a browser
(double-click, or right-click → Open With → your browser). All data is
demo-seeded into `localStorage` on first load.

For live-reload during development, any static server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Folder structure

```
finance-app/
├── index.html            entry / splash screen
├── dashboard.html         Dashboard
├── income.html            Income Tracker
├── expense.html           Expense Tracker
├── budget.html            Budget Planner
├── goals.html             Savings Goals
├── accounts.html          Bank Accounts
├── credit-cards.html      Credit Cards (new page — not in the original list, but
│                          Credit Cards as a feature needed its own screen)
├── loans.html             Loans & Lending (new page, added on request)
├── investments.html       Investment Tracker
├── reports.html           Reports
├── assistant.html         AI Finance Assistant (new page, see caveat below)
├── settings.html          Settings
└── assets/
    ├── css/
    │   ├── variables.css   design tokens (color, type, spacing, motion)
    │   ├── base.css        reset + global element rules
    │   ├── layout.css      app shell: sidebar, topbar, responsive grid
    │   ├── components.css  glass cards, buttons, badges, progress, toasts, modal, forms
    │   ├── dashboard.css   hero balance, stat cards, charts, goal rings, credit
    │   │                   card panels, period tabs, assistant chat bubbles
    │   ├── splash.css      index.html entry screen
    │   └── animations.css  shared keyframes
    ├── js/
    │   ├── utils/
    │   │   ├── storage.js       localStorage wrapper — the live data layer today
    │   │   ├── helpers.js       currency/date formatting, counters, math helpers
    │   │   ├── categories.js    category → icon/color metadata (income + expense)
    │   │   ├── transactions.js  CRUD + filter/sum/CSV-export helpers (shared)
    │   │   ├── budgets.js       CRUD for per-category monthly limits
    │   │   ├── goals.js         CRUD for savings goals + contribute() helper
    │   │   ├── accounts.js      CRUD for bank accounts + transfer() between accounts
    │   │   ├── credit-cards.js  CRUD for credit cards (utilization derived, not stored)
    │   │   ├── loans.js         CRUD for loans (borrowed) and money lent, shared shape
    │   │   ├── investments.js   CRUD for holdings (profit/loss derived from value - cost)
    │   │   └── seed.js          first-run demo data
    │   ├── components/
    │   │   ├── theme.js      dark/light mode toggle
    │   │   ├── sidebar.js    active-link + mobile off-canvas nav
    │   │   ├── toast.js      toast notifications
    │   │   ├── modal.js      generic modal open/close, used by every add/edit form
    │   │   └── charts.js     Chart.js theming shared across pages
    │   ├── firebase/                     ← Phase 12 scaffold, NOT wired in by default
    │   │   ├── firebase-config.example.js  rename to firebase-config.js + fill in
    │   │   │                                your own Firebase project's keys
    │   │   └── firebase-sync.js            Firestore-backed CloudStorage, API-matched
    │   │                                    to storage.js, opt-in per page
    │   ├── app.js            boots every page (seed, theme, topbar, search)
    │   ├── dashboard.js      dashboard-page-only logic
    │   ├── expense.js        expense.html: CRUD, filters, chart, CSV, receipts
    │   ├── income.js         income.html: CRUD, filters, monthly/yearly trend, CSV
    │   ├── budget.js         budget.html: CRUD, live spend calc, progress bars, warnings
    │   ├── goals.js          goals.html: CRUD, progress rings, contribution modal
    │   ├── accounts.js       accounts.html: CRUD, per-account history, transfers
    │   ├── credit-cards.js   credit-cards.html: CRUD, utilization bars, log payment
    │   ├── loans.js          loans.html: borrowed/lent tabs, schedule preview, log payment
    │   ├── investments.js    investments.html: CRUD, allocation chart, profit/loss
    │   ├── reports.js        reports.html: daily/weekly/monthly/yearly bucketing + charts
    │   ├── assistant.js      assistant.html: rule-based Q&A over local data
    │   └── settings.js       settings.html: profile, export/import, delete-all
    ├── images/               (empty — reserved for user-uploaded assets, e.g. receipts)
    ├── icons/                (empty — reserved for custom icon overrides)
    └── data/                 (empty — reserved for CSV/JSON export & backup files)
```

## Design system

- **Palette:** deep midnight surfaces (`#0a0f1a`) with glassmorphic panels,
  emerald for income/positive, coral for expenses/negative, gold for goals.
- **Type:** Space Grotesk (headings), Inter (body), IBM Plex Mono (every
  currency figure — the "ledger tape" signature: tabular numerals everywhere
  money appears, like an accounting ledger or trading terminal).
- **Motion:** staggered card entrances, animated hero counter, respects
  `prefers-reduced-motion`.
- Dark mode is default; toggle persists to `settings.theme` in localStorage.
  Light mode is fully themed via the `[data-theme='light']` CSS variable
  overrides in `variables.css`.

## What's built

- **Dashboard** — balance hero with animated counter, net worth, monthly
  savings, quick actions, stat cards, a 7-day cash flow chart, expense
  category chart, recent transactions, upcoming bills.
- **Expense Tracker** — add/edit/delete, 12 categories, receipt upload,
  search/filter, category chart, CSV export.
- **Income Tracker** — add/edit/delete, 6 categories, search/filter,
  this-month/this-year stats, category chart, a monthly trend chart with a
  year selector, CSV export.
- **Budget Planner** — one limit per category, spend always computed live
  from actual expenses (never a stale number), color-coded progress bars,
  over-budget warnings.
- **Savings Goals** — target/saved/date, animated SVG progress ring, an
  "Add Funds" contribution modal, gold achievement badge on completion.
- **Bank Accounts** — multiple accounts, editable balances, per-account
  transaction history, a validated Transfer Money modal.
- **Credit Cards** — limit, used, available, utilization %, due date,
  minimum payment, a Log Payment action.
- **Loans & Lending** (`loans.html`) — two tabs: loans you've borrowed and
  money you've lent to others. Principal, remaining balance, interest rate,
  EMI/installment, remaining months, a progress bar, a projected 3-payment
  schedule, and a Log Payment (or Log Repayment Received) action.
- **Investment Tracker** — Stocks/ETF/Mutual Funds/Gold/Crypto/CPF/EPF,
  portfolio value, profit/loss ($ and %), allocation doughnut chart.
- **Reports** — Daily/Weekly/Monthly/Yearly tabs; an income-vs-expense
  comparison bar chart and a net-savings line chart over trailing buckets;
  an expense-by-category pie chart; Top 5 Expenses and Top 5 Income
  Sources for the selected period.
- **Settings** — display name, currency (7 options), language selector
  (English live, others marked "coming soon" rather than silently doing
  nothing), theme, Export/Backup (JSON download), Import/Restore (JSON
  upload with validation), and a double-confirmed Delete All Data.
- Dark/light theme toggle, toast notifications, a global search stub,
  responsive sidebar with mobile off-canvas nav, throughout every page.

### Two additions beyond the original page list

- **`credit-cards.html`** — Credit Cards was specified as a feature but the
  original page list didn't include a dedicated file for it. Added it as
  its own page (linked from the sidebar under Accounts) rather than
  cramming it into `accounts.html`, since cards and bank accounts have
  different shapes (limit/utilization vs. balance/transactions).
- **`assistant.html`** — same reasoning for the AI Finance Assistant.
- **`loans.html`** — added on request, covering both directions (loans you
  owe, and money you've lent out) since the original spec only had a
  "Loans" feature for debt you owe, not lending to others.

## Honest caveats on the last two phases

**Phase 11 — AI Finance Assistant.** This is a **rule-based, fully offline**
assistant, not a live LLM integration. It pattern-matches your question
against known intents (monthly spend, top category, "can I save $X",
a simple next-month projection, budget status, net worth, savings tips)
and computes a real answer from your local data — there's no external API
call, no key to configure, and nothing ever leaves your browser. Wiring in
an actual LLM (e.g. the Claude API) would need a server to hold the API key
safely, which this static, no-backend app deliberately doesn't have. If you
want that upgrade later, it's a separate, well-scoped piece of work — say
the word and I'll lay out what it takes.

**Phase 12 — Firebase Integration.** This is a **scaffold, not a working
feature**, and honestly can't be otherwise from this side: Firestore and
Firebase Auth require *your own* Firebase project (a cloud resource tied to
a Google account, with its own security rules), and there's no safe way to
generate one on your behalf or ship working cloud credentials inside a
static app that anyone can view-source. What's actually in the repo:

- `assets/js/firebase/firebase-config.example.js` — the exact steps to
  create your Firebase project and where to paste your config.
- `assets/js/firebase/firebase-sync.js` — a `CloudStorage` object with the
  same shape as `Storage` (`get`/`set`/`remove`), plus `signUp`/`signIn`/
  `signOut` and a `migrateFromLocalStorage()` helper — but it's `async`
  (network calls are), while every page today calls `Storage` synchronously.
  Adopting it means going page by page, swapping `Storage.get(...)` for
  `await CloudStorage.get(...)`, which is mechanical but real work I didn't
  want to silently do without you testing each flow against real network/
  auth conditions.

Net effect: **the app is 100% functional today on localStorage**, and the
path to real accounts + cross-device sync is fully documented and
ready to execute whenever you've created a Firebase project and want to
go through that migration together.
