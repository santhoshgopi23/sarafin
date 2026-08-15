/**
 * assistant.js
 * A rule-based (not a live LLM) finance assistant. It pattern-matches the
 * question against a handful of known intents and computes a real answer
 * from Storage. Everything runs offline in the browser — there's no
 * external API call, no key required, and no data ever leaves the device.
 */

document.addEventListener('DOMContentLoaded', () => {
  bindComposer();
  bindSuggestionChips();
  greet();
});

function greet() {
  addMessage(
    "Hi! I'm your offline finance assistant — I answer questions using the data already in this app. Try one of the suggestions below, or ask your own.",
    'bot'
  );
}

function bindComposer() {
  const form = document.querySelector('[data-assistant-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = form.querySelector('[data-assistant-input]');
    const question = input.value.trim();
    if (!question) return;
    addMessage(question, 'user');
    input.value = '';
    setTimeout(() => addMessage(answer(question), 'bot'), 250);
  });
}

function bindSuggestionChips() {
  document.querySelectorAll('[data-suggestion]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const question = chip.textContent.trim();
      addMessage(question, 'user');
      setTimeout(() => addMessage(answer(question), 'bot'), 250);
    });
  });
}

function addMessage(text, from) {
  const thread = document.querySelector('[data-assistant-thread]');
  if (!thread) return;
  const bubble = document.createElement('div');
  bubble.className = `assistant-bubble assistant-bubble--${from}`;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
}

/* ---------------- Intent matching + answers ---------------- */

function answer(question) {
  const q = question.toLowerCase();

  if (/spend|expense/.test(q) && /month/.test(q)) return answerMonthlySpend();
  if (/(most|top|biggest).*categor|categor.*(most|top|biggest)/.test(q)) return answerTopCategory();
  if (/save\s*\$?\d+/.test(q) || (/can i save/.test(q))) return answerCanISave(q);
  if (/predict|next month/.test(q)) return answerPrediction();
  if (/tip|suggest|advice/.test(q)) return answerSavingsTips();
  if (/net worth/.test(q)) return answerNetWorth();
  if (/budget/.test(q)) return answerBudgetStatus();

  return "I can answer questions about this month's spending, your top expense category, savings feasibility, a simple next-month prediction, budget status, net worth, or general savings tips — try rephrasing along those lines.";
}

function answerMonthlySpend() {
  const expense = Helpers.sumThisMonth(Transactions.all(), 'expense');
  return `You've spent ${Helpers.formatCurrency(expense)} so far this month.`;
}

function answerTopCategory() {
  const now = new Date();
  const thisMonthExpenses = Transactions.byType('expense').filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const byCategory = Transactions.sumByCategory(thisMonthExpenses);
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  if (!top) return "You don't have any expenses logged this month yet, so there's no top category to report.";
  return `Your biggest expense category this month is ${top[0]}, at ${Helpers.formatCurrency(top[1])}.`;
}

function answerCanISave(q) {
  const match = q.match(/\$?(\d+(\.\d+)?)/);
  const target = match ? parseFloat(match[1]) : 500;

  const income = Helpers.sumThisMonth(Transactions.all(), 'income');
  const expense = Helpers.sumThisMonth(Transactions.all(), 'expense');
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = daysInMonth - daysElapsed;
  const dailyBurnRate = daysElapsed > 0 ? expense / daysElapsed : 0;
  const projectedExpense = expense + dailyBurnRate * daysLeft;
  const projectedNet = income - projectedExpense;

  if (projectedNet >= target) {
    return `Looks feasible. Based on your pace so far (${Helpers.formatCurrency(income)} in, ${Helpers.formatCurrency(expense)} out so far), you're projected to end the month with about ${Helpers.formatCurrency(projectedNet)} left over — enough to hit a ${Helpers.formatCurrency(target)} savings target.`;
  }
  const gap = target - projectedNet;
  return `It's tight. At your current pace you're projected to have about ${Helpers.formatCurrency(projectedNet)} left this month, which is ${Helpers.formatCurrency(gap)} short of ${Helpers.formatCurrency(target)}. Trimming discretionary categories or adding income could close that gap.`;
}

function answerPrediction() {
  const all = Transactions.byType('expense');
  const now = new Date();
  const monthTotals = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const total = all
      .filter((t) => {
        const td = new Date(t.date);
        return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear();
      })
      .reduce((sum, t) => sum + t.amount, 0);
    if (total > 0) monthTotals.push(total);
  }
  if (monthTotals.length === 0) {
    return "There isn't enough expense history yet (need at least one past month) to predict next month — but as your data grows, I'll be able to average recent months for you.";
  }
  const avg = monthTotals.reduce((s, v) => s + v, 0) / monthTotals.length;
  return `Based on the average of your last ${monthTotals.length} month(s) with recorded expenses, next month's spending is projected at roughly ${Helpers.formatCurrency(avg)}.`;
}

function answerSavingsTips() {
  const now = new Date();
  const thisMonthExpenses = Transactions.byType('expense').filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const byCategory = Transactions.sumByCategory(thisMonthExpenses);
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  const tips = [
    'Automate a fixed transfer to savings right after payday, before you have a chance to spend it.',
    'Review subscriptions every quarter — small recurring charges add up quietly over a year.',
    'Use the Budget Planner to set a firm cap on your highest-spend category and check it weekly.',
  ];
  if (top) {
    tips.unshift(`Your top category this month is ${top[0]} at ${Helpers.formatCurrency(top[1])} — even a 10-15% trim there would meaningfully move your monthly savings.`);
  }
  return tips.join(' ');
}

function answerNetWorth() {
  const accounts = window.Storage.get(window.STORAGE_KEYS.ACCOUNTS, []);
  const investments = window.Storage.get(window.STORAGE_KEYS.INVESTMENTS, []);
  const total = accounts.reduce((s, a) => s + a.balance, 0) + investments.reduce((s, i) => s + i.value, 0);
  return `Your current net worth (account balances + investment value) is ${Helpers.formatCurrency(total)}.`;
}

function answerBudgetStatus() {
  const budgets = window.Storage.get(window.STORAGE_KEYS.BUDGETS, []);
  if (budgets.length === 0) return "You haven't set up any budgets yet — head to the Budget Planner to add category limits.";
  const now = new Date();
  const over = budgets.filter((b) => {
    const spent = Transactions.byType('expense')
      .filter((t) => {
        const d = new Date(t.date);
        return t.category === b.category && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, t) => s + t.amount, 0);
    return spent > b.limit;
  });
  if (over.length === 0) return `All ${budgets.length} of your budgets are within limit this month. Nice work.`;
  return `${over.length} of your ${budgets.length} budgets are over limit this month: ${over.map((b) => b.category).join(', ')}.`;
}
