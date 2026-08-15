/**
 * seed.js
 * First-run demo data. Only written to Storage if the relevant key is
 * completely empty, so it never overwrites a returning user's real data.
 * Kept as JS (not a fetched .json file) so the app works when opened
 * directly from disk (file://) with no local server.
 */

function seedDemoData() {
  const K = window.STORAGE_KEYS;

  window.Storage.seedIfEmpty(K.SETTINGS, {
    theme: 'dark',
    currency: 'USD',
    language: 'en',
    userName: 'Alex',
  });

  window.Storage.seedIfEmpty(K.ACCOUNTS, [
    { id: 'acc-cash', name: 'Cash Wallet', type: 'cash', balance: 420.5 },
    { id: 'acc-checking', name: 'Current Account', type: 'checking', balance: 6840.12 },
    { id: 'acc-savings', name: 'Savings Account', type: 'savings', balance: 18250.0 },
  ]);

  const today = new Date();
  const day = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const monthsAgo = (n, dayOfMonth = 12) => {
    const d = new Date(today.getFullYear(), today.getMonth() - n, dayOfMonth);
    return d.toISOString().slice(0, 10);
  };

  window.Storage.seedIfEmpty(K.TAGS, [
    { id: 'tag-essential', name: 'Essential', color: '#34d399' },
    { id: 'tag-recurring', name: 'Recurring', color: '#60a5fa' },
    { id: 'tag-subscription', name: 'Subscription', color: '#a78bfa' },
    { id: 'tag-reimbursable', name: 'Reimbursable', color: '#fbbf24' },
    { id: 'tag-family', name: 'Family', color: '#f472b6' },
    { id: 'tag-onetime', name: 'One-time', color: '#94a3b8' },
  ]);

  window.Storage.seedIfEmpty(K.TRANSACTIONS, [
    { id: window.Helpers ? window.Helpers.uid() : 't1', type: 'income', category: 'Salary', title: 'Monthly Salary', amount: 5200, date: day(2), account: 'acc-checking', tags: ['tag-recurring'] },
    { id: 't2', type: 'expense', category: 'Rent', title: 'Apartment Rent', amount: 1600, date: day(2), account: 'acc-checking', tags: ['tag-essential', 'tag-recurring'] },
    { id: 't3', type: 'expense', category: 'Food', title: 'Grocery Store', amount: 128.4, date: day(1), account: 'acc-checking', tags: ['tag-essential', 'tag-family'] },
    { id: 't4', type: 'expense', category: 'Transport', title: 'Ride Share', amount: 24.75, date: day(1), account: 'acc-cash', tags: [] },
    { id: 't5', type: 'income', category: 'Freelance', title: 'Design Contract', amount: 850, date: day(4), account: 'acc-checking', tags: ['tag-reimbursable'] },
    { id: 't6', type: 'expense', category: 'Entertainment', title: 'Streaming Subscription', amount: 15.99, date: day(6), account: 'acc-checking', tags: ['tag-subscription', 'tag-recurring'] },
    { id: 't7', type: 'expense', category: 'Utilities', title: 'Electricity Bill', amount: 96.3, date: day(8), account: 'acc-checking', tags: ['tag-essential', 'tag-recurring'] },
    { id: 't8', type: 'expense', category: 'Shopping', title: 'New Headphones', amount: 179.0, date: day(10), account: 'acc-checking', tags: ['tag-onetime'] },
    { id: 't9', type: 'expense', category: 'Medical', title: 'Pharmacy', amount: 42.1, date: day(12), account: 'acc-cash', tags: ['tag-family'] },
    { id: 't10', type: 'income', category: 'Investment', title: 'Dividend Payout', amount: 63.2, date: day(14), account: 'acc-savings', tags: [] },
  ]);

  window.Storage.seedIfEmpty(K.BUDGETS, [
    { id: 'b1', category: 'Food', limit: 600 },
    { id: 'b2', category: 'Transport', limit: 200 },
    { id: 'b3', category: 'Entertainment', limit: 120 },
    { id: 'b4', category: 'Shopping', limit: 300 },
  ]);

  window.Storage.seedIfEmpty(K.GOALS, [
    {
      id: 'g1', name: 'Emergency Fund',
      presentValue: 10000, inflationRate: 3, targetDate: '2026-12-31',
      target: 10000 * Math.pow(1.03, Math.max((new Date('2026-12-31') - new Date()) / (1000 * 60 * 60 * 24 * 365.25), 0)),
      saved: 6400,
      entries: [
        { id: 'ge1', amount: 5000, date: '2026-01-10', where: 'DBS Savings', note: 'Initial amount' },
        { id: 'ge2', amount: 1400, date: '2026-05-02', where: 'DBS Savings', note: '' },
      ],
      createdAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'g2', name: 'Japan Trip',
      presentValue: 3500, inflationRate: 2, targetDate: '2027-03-01',
      target: 3500 * Math.pow(1.02, Math.max((new Date('2027-03-01') - new Date()) / (1000 * 60 * 60 * 24 * 365.25), 0)),
      saved: 1200,
      entries: [
        { id: 'ge3', amount: 1200, date: '2026-06-15', where: 'Cash', note: 'Initial amount' },
      ],
      createdAt: '2026-06-15T00:00:00.000Z',
    },
  ]);

  const nextDate = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  window.Storage.seedIfEmpty(K.BILLS, [
    { id: 'bill1', name: 'Internet', amount: 59.99, dueDate: nextDate(3), category: 'Internet', paid: false },
    { id: 'bill2', name: 'Phone Plan', amount: 45.0, dueDate: nextDate(6), category: 'Phone', paid: false },
    { id: 'bill3', name: 'Car Insurance', amount: 132.5, dueDate: nextDate(10), category: 'Insurance', paid: false },
  ]);

  window.Storage.seedIfEmpty(K.INVESTMENTS, [
    { id: 'inv1', name: 'Index Fund ETF', type: 'ETF', value: 8200, costBasis: 7300, date: monthsAgo(4) },
    { id: 'inv2', name: 'Tech Stocks', type: 'Stocks', value: 4100, costBasis: 4600, date: monthsAgo(2) },
    { id: 'inv3', name: 'Gold', type: 'Gold', value: 1500, costBasis: 1350, date: monthsAgo(1) },
    { id: 'inv4', name: 'CPF', type: 'CPF', value: 26000, costBasis: 26000, date: monthsAgo(5) },
  ]);

  window.Storage.seedIfEmpty(K.DIVIDENDS, [
    { id: 'div1', holdingId: 'inv2', holdingName: 'Tech Stocks', holdingType: 'Stocks', amount: 42.5, date: monthsAgo(1, 5), notes: 'Interim dividend' },
    { id: 'div2', holdingId: 'inv1', holdingName: 'Index Fund ETF', holdingType: 'ETF', amount: 18.75, date: day(10), notes: '' },
  ]);

  window.Storage.seedIfEmpty(K.CREDIT_CARDS, [
    { id: 'cc1', name: 'Everyday Rewards Visa', limit: 5000, used: 1240, dueDate: nextDate(9), minPayment: 45 },
    { id: 'cc2', name: 'Travel Miles Mastercard', limit: 8000, used: 3760, dueDate: nextDate(15), minPayment: 110 },
  ]);

  window.Storage.seedIfEmpty(K.LOANS, [
    {
      id: 'loan1', direction: 'borrowed', name: 'Car Loan', counterparty: 'AutoFin Bank',
      principal: 24000, interestRate: 5.5, emi: 460, remainingBalance: 15200,
      remainingMonths: 34, startDate: '2024-09-01', nextDueDate: nextDate(12),
    },
    {
      id: 'loan2', direction: 'lent', name: 'Personal Loan to Sam', counterparty: 'Sam',
      principal: 1200, interestRate: 0, emi: 100, remainingBalance: 600,
      remainingMonths: 6, startDate: '2025-11-01', nextDueDate: nextDate(20),
    },
  ]);
}

window.seedDemoData = seedDemoData;
