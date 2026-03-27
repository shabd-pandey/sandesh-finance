// ================================================================
// functions/index.test.js — Sandesh Finance
// Unit tests for scheduleDailyLoanAlerts helper logic
//
// RUN:  cd functions && npm test
// ================================================================

// We test the pure helper functions by extracting them.
// The actual Cloud Functions (onSchedule, onDocumentUpdated)
// are integration-tested via the Firebase Emulator.

// ── Inline copies of the helpers under test ──────────────────────

function calcDueDate(loan) {
    if (loan.dueDate && typeof loan.dueDate === 'string') {
        return new Date(loan.dueDate);
    }
    const start = new Date(loan.startDate);
    switch (loan.durationUnit) {
        case 'days':    start.setDate(start.getDate() + Number(loan.duration)); break;
        case '15days':  start.setDate(start.getDate() + Number(loan.duration) * 15); break;
        case 'weeks':   start.setDate(start.getDate() + Number(loan.duration) * 7); break;
        case 'years':   start.setFullYear(start.getFullYear() + Number(loan.duration)); break;
        default:        start.setMonth(start.getMonth() + Math.round(Number(loan.durationInMonths || loan.duration)));
    }
    return start;
}

function daysRemaining(dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due - today) / 86_400_000);
}

// ── Simple assertion helper ───────────────────────────────────────
let passed = 0; let failed = 0;
function assert(condition, label) {
    if (condition) { console.log(`  ✅ ${label}`); passed++; }
    else           { console.error(`  ❌ FAIL: ${label}`); failed++; }
}
function describe(label, fn) { console.log(`\n${label}`); fn(); }

// ── Helpers ───────────────────────────────────────────────────────

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];

// ================================================================
// TEST SUITES
// ================================================================

describe('calcDueDate — uses stored dueDate when present', () => {
    const loan = { dueDate: '2025-12-31', startDate: '2025-01-01', duration: 6, durationUnit: 'months', durationInMonths: 6 };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2025-12-31', `returns stored dueDate: got ${result}`);
});

describe('calcDueDate — months unit', () => {
    const loan = { startDate: '2024-01-01', duration: 3, durationUnit: 'months', durationInMonths: 3 };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2024-04-01', `3 months from 2024-01-01 = 2024-04-01: got ${result}`);
});

describe('calcDueDate — days unit', () => {
    const loan = { startDate: '2024-01-01', duration: 30, durationUnit: 'days' };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2024-01-31', `30 days from 2024-01-01 = 2024-01-31: got ${result}`);
});

describe('calcDueDate — weeks unit', () => {
    const loan = { startDate: '2024-01-01', duration: 2, durationUnit: 'weeks' };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2024-01-15', `2 weeks from 2024-01-01 = 2024-01-15: got ${result}`);
});

describe('calcDueDate — 15days unit', () => {
    const loan = { startDate: '2024-01-01', duration: 2, durationUnit: '15days' };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2024-01-31', `2×15 days from 2024-01-01 = 2024-01-31: got ${result}`);
});

describe('calcDueDate — years unit', () => {
    const loan = { startDate: '2024-01-01', duration: 1, durationUnit: 'years' };
    const result = calcDueDate(loan).toISOString().split('T')[0];
    assert(result === '2025-01-01', `1 year from 2024-01-01 = 2025-01-01: got ${result}`);
});

describe('daysRemaining — due today', () => {
    const r = daysRemaining(TODAY);
    assert(r === 0, `today returns 0: got ${r}`);
});

describe('daysRemaining — due in future', () => {
    const r = daysRemaining(addDays(TODAY, 3));
    assert(r === 3, `3 days ahead returns 3: got ${r}`);
});

describe('daysRemaining — overdue', () => {
    const r = daysRemaining(addDays(TODAY, -7));
    assert(r === -7, `7 days ago returns -7: got ${r}`);
});

describe('daysRemaining — due tomorrow (edge: ≤ 5)', () => {
    const r = daysRemaining(addDays(TODAY, 1));
    assert(r <= 5 && r >= 0, `tomorrow (${r}) falls within DUE_SOON_DAYS=5 window`);
});

describe('daysRemaining — due in 6 days (outside window)', () => {
    const r = daysRemaining(addDays(TODAY, 6));
    assert(r > 5, `6 days ahead (${r}) is outside DUE_SOON_DAYS=5 window`);
});

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n──────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
