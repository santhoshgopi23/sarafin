/**
 * goals.js (utils)
 * CRUD for the `goals` storage key.
 *
 * Each goal record:
 * {
 *   id, name,
 *   presentValue,      // "money needed today" (today's cost of the goal)
 *   targetDate,        // ISO date string
 *   inflationRate,     // annual %, e.g. 6 = 6%/yr
 *   target,            // inflation-adjusted future value — what actually needs to be saved
 *   saved,             // running total, sum of all entries
 *   entries: [ { id, amount, date, where, returnRate, note } ],
 *   createdAt
 * }
 *
 * `returnRate` on an entry is the annual % return of wherever that money is
 * kept (e.g. a savings account or fixed deposit's interest rate). It's used,
 * alongside the goal's inflation rate, to work out a realistic monthly
 * saving amount — one that accounts for the saved money (and future
 * contributions) continuing to grow until the target date, instead of
 * assuming it just sits still.
 */

const Goals = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.GOALS, []);
  },

  save(list) {
    window.Storage.set(window.STORAGE_KEYS.GOALS, list);
  },

  /** Years (can be fractional) between now and a target date, floored at 0. */
  yearsUntil(targetDate) {
    const ms = new Date(targetDate) - new Date();
    const years = ms / (1000 * 60 * 60 * 24 * 365.25);
    return Math.max(years, 0);
  },

  /** Future value of a present-day amount, compounded annually at `ratePct` for `years`. */
  inflateAmount(presentValue, ratePct, years) {
    const r = (ratePct || 0) / 100;
    return presentValue * Math.pow(1 + r, years);
  },

  /** Recompute the inflation-adjusted target for a goal from its stored inputs. */
  computeTarget(goal) {
    const years = this.yearsUntil(goal.targetDate);
    return this.inflateAmount(goal.presentValue, goal.inflationRate, years);
  },

  add(goal) {
    const list = this.all();
    const years = this.yearsUntil(goal.targetDate);
    const target = this.inflateAmount(goal.presentValue, goal.inflationRate, years);

    const record = {
      id: Helpers.uid(),
      entries: [],
      saved: 0,
      createdAt: new Date().toISOString(),
      ...goal,
      target,
    };

    // If an initial amount was provided at creation time, log it as the first entry.
    if (goal.initialAmount && goal.initialAmount > 0) {
      const entry = {
        id: Helpers.uid(),
        amount: goal.initialAmount,
        date: goal.initialDate || new Date().toISOString().slice(0, 10),
        where: goal.initialWhere || '',
        returnRate: goal.initialReturnRate || 0,
        note: 'Initial amount',
      };
      record.entries = [entry];
      record.saved = goal.initialAmount;
    }
    delete record.initialAmount;
    delete record.initialDate;
    delete record.initialWhere;
    delete record.initialReturnRate;

    list.push(record);
    this.save(list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) return null;
    const merged = { ...list[idx], ...changes };

    // If any inflation input changed, recompute the target.
    if ('presentValue' in changes || 'targetDate' in changes || 'inflationRate' in changes) {
      merged.target = this.computeTarget(merged);
    }

    list[idx] = merged;
    this.save(list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((g) => g.id !== id);
    this.save(list);
  },

  get(id) {
    return this.all().find((g) => g.id === id) || null;
  },

  /** Add a savings entry (amount + date + where + return rate) to a goal and bump its saved total. */
  addEntry(id, entry) {
    const list = this.all();
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) return null;

    const record = { ...list[idx] };
    const newEntry = {
      id: Helpers.uid(),
      amount: entry.amount,
      date: entry.date,
      where: entry.where || '',
      returnRate: entry.returnRate || 0,
      note: entry.note || '',
    };
    record.entries = [...(record.entries || []), newEntry];
    record.saved = Math.max(0, (record.saved || 0) + entry.amount);

    list[idx] = record;
    this.save(list);
    return record;
  },

  /** Remove a single entry from a goal's history and re-total `saved` from the remaining entries. */
  removeEntry(goalId, entryId) {
    const list = this.all();
    const idx = list.findIndex((g) => g.id === goalId);
    if (idx === -1) return null;

    const record = { ...list[idx] };
    record.entries = (record.entries || []).filter((e) => e.id !== entryId);
    record.saved = record.entries.reduce((sum, e) => sum + e.amount, 0);

    list[idx] = record;
    this.save(list);
    return record;
  },

  /**
   * Amount-weighted average annual return rate across a goal's entries —
   * i.e. the blended interest rate of wherever the saved money actually sits
   * (savings account, fixed deposit, etc). Entries without a rate count as 0%.
   */
  avgReturnRate(goal) {
    const entries = goal.entries || [];
    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    if (total <= 0) return 0;
    const weighted = entries.reduce((sum, e) => sum + e.amount * (e.returnRate || 0), 0);
    return weighted / total;
  },

  /**
   * How much more per month is needed to hit the (inflation-adjusted) target
   * by the target date — accounting for the fact that money already saved
   * (and each future monthly contribution) keeps earning the goal's blended
   * return rate until then, rather than assuming it just sits idle.
   */
  monthlyNeeded(goal) {
    const remaining = Math.max(0, goal.target - goal.saved);
    if (remaining <= 0) return 0;

    const msLeft = new Date(goal.targetDate) - new Date();
    const monthsLeft = msLeft / (1000 * 60 * 60 * 24 * 30.44);
    if (monthsLeft <= 0) return remaining; // overdue — needs it all now

    const years = monthsLeft / 12;
    const annualRate = this.avgReturnRate(goal) / 100;

    // What the current savings will grow to by the target date on their own.
    const futureValueOfSaved = (goal.saved || 0) * Math.pow(1 + annualRate, years);
    const stillNeeded = Math.max(0, goal.target - futureValueOfSaved);
    if (stillNeeded <= 0) return 0;

    const monthlyRate = annualRate / 12;
    if (monthlyRate <= 0) return stillNeeded / monthsLeft;

    // Ordinary annuity: solve for the monthly payment whose future value
    // (compounded at monthlyRate) equals what's still needed.
    const n = monthsLeft;
    const growthFactor = Math.pow(1 + monthlyRate, n) - 1;
    return stillNeeded * monthlyRate / growthFactor;
  },
};

window.Goals = Goals;
