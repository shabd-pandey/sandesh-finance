// ================================================================
// script.js — Sandesh Finance
// Migrated from localStorage → Firebase Firestore (Step 3)
//
// CHANGES FROM ORIGINAL:
//   • Runs as ES Module (type="module" in index.html)
//   • loadData() / saveData() removed entirely
//   • Auth guard + initial data load via onAuthChange()
//   • All 10 mutation sites replaced with async Firestore calls
//   • Local appData kept in-memory for UI rendering (no re-fetches)
//   • All calculation, rendering, PDF, and UI logic UNCHANGED
// ================================================================

import { onAuthChange, logout }    from './auth.js';
import {
    loadAllData,
    addInvestor      as fsAddInvestor,
    updateInvestor   as fsUpdateInvestor,
    deleteInvestor   as fsDeleteInvestor,
    addBorrower      as fsAddBorrower,
    deleteBorrower   as fsDeleteBorrower,
    addLoan          as fsAddLoan,
    updateLoanStatus as fsUpdateLoanStatus,
    deleteLoan       as fsDeleteLoan,
    addLoanDelay     as fsAddLoanDelay,
    updateAppMeta    as fsUpdateAppMeta,
} from './firestore.js';
import {
    initNotifications,
    notifyLoanCreated,
    notifyLoanCompleted,
    notifyUrgentLoans,
} from './notifications.js';

// ================================================================
// AUTH STATE & CURRENT USER
// ================================================================

let currentUserId = null;   // set once Firebase resolves auth

// ================================================================
// IN-MEMORY APP DATA  (mirrors Firestore, synced after every write)
// ================================================================

let appData = {
    investors: [],
    borrowers: [],
    loans: [],
    totalCommissionEarned: 0,
    dismissedAlerts: {},
    delays: []
};

// ================================================================
// UI LOADING STATE  (shown while Firestore fetches on first load)
// ================================================================

function showAppLoading() {
    // Disable interactive sections while data loads
    document.querySelectorAll('form button[type="submit"]').forEach(b => b.disabled = true);
    document.getElementById('loansTableBody').innerHTML =
        '<tr><td colspan="9" style="text-align:center;padding:32px;color:#888;">Loading data…</td></tr>';
}

function hideAppLoading() {
    document.querySelectorAll('form button[type="submit"]').forEach(b => b.disabled = false);
}

// ================================================================
// UTILITY FUNCTIONS  — unchanged from original
// ================================================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatCurrency(amount) {
    return '₹' + parseFloat(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Modified to support async onConfirm callbacks (needed for Firestore calls)
function showModal(title, message, onConfirm) {
    const modal = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    modal.classList.add('show');

    const confirmBtn = document.getElementById('modalConfirm');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    const cancelBtn = document.getElementById('modalCancel');
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newConfirmBtn.addEventListener('click', () => {
        modal.classList.remove('show');
        onConfirm();   // may be async — errors handled inside onConfirm itself
    });
    newCancelBtn.addEventListener('click', () => modal.classList.remove('show'));
}

// ================================================================
// CAPITAL OVERVIEW  — unchanged
// ================================================================

function updateCapitalOverview() {
    let totalCapital = 0;
    let totalInvested = 0;

    appData.investors.forEach(inv => {
        totalCapital  += inv.capital;
        totalInvested += inv.invested;
    });

    const totalAvailable = totalCapital - totalInvested;

    document.getElementById('totalCapital').textContent   = formatCurrency(totalCapital);
    document.getElementById('totalInvested').textContent  = formatCurrency(totalInvested);
    document.getElementById('totalAvailable').textContent = formatCurrency(totalAvailable);
}

// ================================================================
// DUE DATES & ALERTS  — unchanged
// ================================================================

function calculateDaysRemaining(dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

function formatCountdown(days) {
    if (days < 0)    return `${Math.abs(days)} days overdue`;
    if (days === 0)  return 'Due today';
    if (days === 1)  return '1 day remaining';
    if (days < 30)   return `${days} days remaining`;
    if (days < 365) {
        const months = Math.floor(days / 30);
        const rem    = days % 30;
        return `${months} month${months > 1 ? 's' : ''} ${rem > 0 ? `${rem} day${rem > 1 ? 's' : ''}` : ''} remaining`;
    }
    const years  = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return `${years} year${years > 1 ? 's' : ''} ${months > 0 ? `${months} month${months > 1 ? 's' : ''}` : ''} remaining`;
}

function getCountdownClass(days) {
    if (days < 0 || days <= 7) return 'urgent';
    if (days <= 30)             return 'warning';
    return '';
}

function renderDueDateItem(loan, type) {
    const countdownClass = getCountdownClass(loan.daysRemaining);
    const countdownText  = formatCountdown(loan.daysRemaining);

    if (type === 'borrower') {
        return `
            <div class="due-date-item borrower">
                <div class="due-date-header">
                    <span class="due-date-title">${loan.borrowerName}</span>
                    <span class="due-date-type borrower">Payment Due</span>
                </div>
                <div class="due-date-info">
                    <div class="due-date-detail"><strong>Amount:</strong> ${formatCurrency(loan.totalPayable)}</div>
                    <div class="due-date-detail"><strong>Due Date:</strong> ${formatDate(loan.dueDate)}</div>
                    <div class="due-date-detail"><strong>Breakdown:</strong> Principal ${formatCurrency(loan.amount)} + Interest ${formatCurrency(loan.totalInterest)}</div>
                </div>
                <div class="countdown-timer">
                    <span class="countdown-value ${countdownClass}">${countdownText}</span>
                    <span class="countdown-label">Time Remaining</span>
                </div>
            </div>`;
    } else {
        return `
            <div class="due-date-item investor">
                <div class="due-date-header">
                    <span class="due-date-title">${loan.investorName}</span>
                    <span class="due-date-type investor">Collection Due</span>
                </div>
                <div class="due-date-info">
                    <div class="due-date-detail"><strong>Expected:</strong> ${formatCurrency(loan.amount + loan.investorShare)}</div>
                    <div class="due-date-detail"><strong>Collection Date:</strong> ${formatDate(loan.dueDate)}</div>
                    <div class="due-date-detail"><strong>Breakdown:</strong> Principal ${formatCurrency(loan.amount)} + Interest ${formatCurrency(loan.investorShare)}</div>
                </div>
                <div class="countdown-timer">
                    <span class="countdown-value ${countdownClass}">${countdownText}</span>
                    <span class="countdown-label">Time Until Collection</span>
                </div>
            </div>`;
    }
}

let currentTab = 'all';

function showDueDatesDialog() {
    currentTab = 'all';
    renderDueDatesContent();
    document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', idx === 0);
    });
    document.getElementById('dueDatesModal').classList.add('show');
}

function closeDueDatesDialog() {
    document.getElementById('dueDatesModal').classList.remove('show');
}

function renderDueDatesContent() {
    const content     = document.getElementById('dueDatesContent');
    const activeLoans = appData.loans.filter(l => l.status === 'active');

    if (!activeLoans.length) {
        content.innerHTML = '<div class="empty-state"><span class="empty-icon">📅</span><p>No active loans with due dates.</p></div>';
        content.classList.remove('two-columns');
        return;
    }

    const loansWithDates = activeLoans.map(loan => {
        const dueDate = calculateDueDateFromLoan(loan);
        return { ...loan, dueDate, daysRemaining: calculateDaysRemaining(dueDate) };
    }).sort((a, b) => a.daysRemaining - b.daysRemaining);

    if (currentTab === 'all') {
        content.classList.add('two-columns');
        content.innerHTML = `
            <div>
                <div class="column-title borrowers">💳 Borrowers - Payments Due</div>
                ${loansWithDates.map(l => renderDueDateItem(l, 'borrower')).join('')}
            </div>
            <div>
                <div class="column-title investors">💰 Investors - Collections</div>
                ${loansWithDates.map(l => renderDueDateItem(l, 'investor')).join('')}
            </div>`;
    } else if (currentTab === 'borrowers') {
        content.classList.remove('two-columns');
        content.innerHTML = loansWithDates.map(l => renderDueDateItem(l, 'borrower')).join('');
    } else if (currentTab === 'investors') {
        content.classList.remove('two-columns');
        content.innerHTML = loansWithDates.map(l => renderDueDateItem(l, 'investor')).join('');
    }
}

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
        currentTab = e.target.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        renderDueDatesContent();
    }
});

async function checkUrgentAlerts() {
    const activeLoans = appData.loans.filter(l => l.status === 'active');
    const today       = new Date().toISOString().split('T')[0];

    const urgentLoans = activeLoans.filter(loan => {
        const dueDate      = calculateDueDateFromLoan(loan);
        const daysRemaining = calculateDaysRemaining(dueDate);
        const isUrgent     = daysRemaining <= 5 && daysRemaining >= -5;
        const dismissKey   = `${loan.id}_${today}`;
        return isUrgent && !appData.dismissedAlerts[dismissKey];
    });

    if (urgentLoans.length > 0) {
        // build daysRemaining into each loan object for the notification helper
        const urgentWithDays = urgentLoans.map(loan => ({
            ...loan,
            daysRemaining: calculateDaysRemaining(calculateDueDateFromLoan(loan))
        }));
        showAlertModal(urgentLoans);
        // ── Step 4: fire urgent-loan notifications ──
        await notifyUrgentLoans(currentUserId, urgentWithDays);
    }
}

function showAlertModal(urgentLoans) {
    const content      = document.getElementById('alertContent');
    const loansWithDates = urgentLoans.map(loan => {
        const dueDate = calculateDueDateFromLoan(loan);
        return { ...loan, dueDate, daysRemaining: calculateDaysRemaining(dueDate) };
    }).sort((a, b) => a.daysRemaining - b.daysRemaining);

    content.innerHTML = loansWithDates.map(loan => {
        const isOverdue = loan.daysRemaining < 0;
        return `
            <div class="alert-item">
                <div class="alert-item-header">
                    <span class="alert-item-title">${loan.borrowerName}</span>
                    <span class="alert-badge">${isOverdue ? 'OVERDUE' : 'URGENT'}</span>
                </div>
                <div class="alert-details">
                    <div class="alert-detail"><strong>💰 Total Due:</strong> ${formatCurrency(loan.totalPayable)}</div>
                    <div class="alert-detail"><strong>📅 Due Date:</strong> ${formatDate(loan.dueDate)}</div>
                    <div class="alert-detail"><strong>👤 Investor:</strong> ${loan.investorName} (expects ${formatCurrency(loan.amount + loan.investorShare)})</div>
                </div>
                <div class="alert-countdown">
                    <span class="alert-countdown-value">${formatCountdown(loan.daysRemaining).toUpperCase()}</span>
                    <span class="alert-countdown-label">${isOverdue ? 'Please follow up immediately' : 'Action required soon'}</span>
                </div>
            </div>`;
    }).join('');

    document.getElementById('alertModal').classList.add('show');
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 1 — dismissAlerts
// Was: saveData()
// Now: fsUpdateAppMeta(userId, { dismissedAlerts })
// ─────────────────────────────────────────────────────────────────
async function dismissAlerts() {
    document.getElementById('alertModal').classList.remove('show');

    const activeLoans = appData.loans.filter(l => l.status === 'active');
    const today       = new Date().toISOString().split('T')[0];

    activeLoans.forEach(loan => {
        const dueDate       = calculateDueDateFromLoan(loan);
        const daysRemaining = calculateDaysRemaining(dueDate);
        if (daysRemaining <= 5 && daysRemaining >= -5) {
            appData.dismissedAlerts[`${loan.id}_${today}`] = true;
        }
    });

    try {
        await fsUpdateAppMeta(currentUserId, { dismissedAlerts: appData.dismissedAlerts });
        showToast('Reminders dismissed for today', 'success');
    } catch (err) {
        console.error('dismissAlerts save failed:', err);
        // Non-critical — local state already updated, just warn
        showToast('Dismissed locally (sync failed)', 'warning');
    }
}

// Cleans up stale dismiss keys from both appData and Firestore
async function cleanupOldAlerts() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    let changed = false;
    Object.keys(appData.dismissedAlerts).forEach(key => {
        const dateStr = key.split('_')[1];
        if (dateStr && dateStr < cutoffStr) {
            delete appData.dismissedAlerts[key];
            changed = true;
        }
    });

    if (changed) {
        try {
            await fsUpdateAppMeta(currentUserId, { dismissedAlerts: appData.dismissedAlerts });
        } catch (err) {
            console.warn('cleanupOldAlerts sync failed (non-critical):', err);
        }
    }
}

// ================================================================
// INVESTORS
// ================================================================

function toggleInvestorForm() {
    const form = document.getElementById('investorFormContainer');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function toggleBorrowerForm() {
    const form = document.getElementById('borrowerFormContainer');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 2 — Add Investor
// Was: appData.investors.push({id:generateId(),...}); saveData()
// Now: fsAddInvestor() → returns Firestore doc ID → push with that ID
// ─────────────────────────────────────────────────────────────────
document.getElementById('investorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name    = document.getElementById('investorName').value.trim();
    const phone   = document.getElementById('investorPhone').value.trim();
    const capital = parseFloat(document.getElementById('investorCapital').value);

    if (!name || !phone || capital <= 0) return showToast('Check inputs', 'error');

    const submitBtn = this.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
        const newId = await fsAddInvestor(currentUserId, {
            name, phone, capital, invested: 0, activeLoans: 0
        });

        // Mirror in local appData so renders are instant (no re-fetch needed)
        appData.investors.push({ id: newId, name, phone, capital, invested: 0, activeLoans: 0 });

        renderInvestors();
        updateLoanDropdowns();
        toggleInvestorForm();
        updateCapitalOverview();
        showToast('Investor added');
        this.reset();
    } catch (err) {
        console.error('addInvestor failed:', err);
        showToast('Failed to save investor. Check connection.', 'error');
    } finally {
        submitBtn.disabled  = false;
        submitBtn.textContent = 'Save Investor';
    }
});

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 3 — Add Borrower
// Was: appData.borrowers.push({id:generateId(),...}); saveData()
// Now: fsAddBorrower() → returns Firestore doc ID
// ─────────────────────────────────────────────────────────────────
document.getElementById('borrowerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name    = document.getElementById('borrowerName').value.trim();
    const phone   = document.getElementById('borrowerPhone').value.trim();
    const address = document.getElementById('borrowerAddress').value.trim();

    if (!name || !phone) return showToast('Check inputs', 'error');

    const submitBtn = this.querySelector('[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Saving…';

    try {
        const newId = await fsAddBorrower(currentUserId, {
            name, phone, address, borrowed: 0, activeLoans: 0
        });

        appData.borrowers.push({ id: newId, name, phone, address, borrowed: 0, activeLoans: 0 });

        renderBorrowers();
        updateLoanDropdowns();
        toggleBorrowerForm();
        showToast('Borrower added');
        this.reset();
    } catch (err) {
        console.error('addBorrower failed:', err);
        showToast('Failed to save borrower. Check connection.', 'error');
    } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Save Borrower';
    }
});

function renderInvestors() {
    const list = document.getElementById('investorsList');
    if (!appData.investors.length) {
        return (list.innerHTML = '<div class="empty-state"><span class="empty-icon">💼</span><p>No investors yet.</p></div>');
    }

    list.innerHTML = appData.investors.map(inv => {
        const available = inv.capital - inv.invested;
        return `
        <div class="entity-card investor">
            <div class="entity-header">
                <div class="entity-info">
                    <h3>${inv.name}</h3>
                    <p>📱 ${inv.phone}</p>
                </div>
                <div class="entity-actions">
                    <button class="icon-btn view"   onclick="showInvestorDetails('${inv.id}')"  title="View Investment Details">📊</button>
                    <button class="icon-btn edit"   onclick="editInvestorCapital('${inv.id}')"  title="Edit Capital">✏️</button>
                    <button class="icon-btn delete" onclick="deleteInvestor('${inv.id}')"       title="Delete">🗑️</button>
                </div>
            </div>
            <div class="entity-stats">
                <div class="stat-item"><span class="stat-item-label">Capital</span><span>${formatCurrency(inv.capital)}</span></div>
                <div class="stat-item"><span class="stat-item-label">Invested</span><span>${formatCurrency(inv.invested)}</span></div>
                <div class="stat-item balance-remaining"><span class="stat-item-label">Available</span><span>${formatCurrency(available)}</span></div>
                <div class="stat-item"><span class="stat-item-label">Active Loans</span><span>${inv.activeLoans}</span></div>
            </div>
        </div>`;
    }).join('');
}

function renderBorrowers() {
    const list = document.getElementById('borrowersList');
    if (!appData.borrowers.length) {
        return (list.innerHTML = '<div class="empty-state"><span class="empty-icon">👥</span><p>No borrowers yet.</p></div>');
    }

    list.innerHTML = appData.borrowers.map(b => `
        <div class="entity-card borrower">
            <div class="entity-header">
                <div class="entity-info">
                    <h3>${b.name}</h3>
                    <p>📱 ${b.phone}</p>
                </div>
                <div class="entity-actions">
                    <button class="icon-btn view"   onclick="showBorrowerDetails('${b.id}')" title="View Loan Details">📋</button>
                    <button class="icon-btn delete" onclick="deleteBorrower('${b.id}')"       title="Delete">🗑️</button>
                </div>
            </div>
            <div class="entity-stats">
                <div class="stat-item"><span class="stat-item-label">Borrowed</span><span>${formatCurrency(b.borrowed)}</span></div>
                <div class="stat-item"><span class="stat-item-label">Active Loans</span><span>${b.activeLoans || 0}</span></div>
            </div>
        </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 4 — Delete Investor
// Was: appData.investors.filter(...); saveData()
// Now: fsDeleteInvestor(userId, id)
// ─────────────────────────────────────────────────────────────────
function deleteInvestor(id) {
    if (appData.loans.some(l => l.investorId === id && l.status === 'active')) {
        return showToast('Has active loans — cannot delete', 'error');
    }
    showModal('Delete Investor', 'Delete this investor? This cannot be undone.', async () => {
        try {
            await fsDeleteInvestor(currentUserId, id);

            appData.investors = appData.investors.filter(i => i.id !== id);
            renderInvestors();
            updateLoanDropdowns();
            updateStats();
            updateCapitalOverview();
            showToast('Investor deleted');
        } catch (err) {
            console.error('deleteInvestor failed:', err);
            showToast('Failed to delete investor.', 'error');
        }
    });
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 5 — Delete Borrower
// Was: appData.borrowers.filter(...); saveData()
// Now: fsDeleteBorrower(userId, id)
// ─────────────────────────────────────────────────────────────────
function deleteBorrower(id) {
    if (appData.loans.some(l => l.borrowerId === id && l.status === 'active')) {
        return showToast('Has active loans — cannot delete', 'error');
    }
    showModal('Delete Borrower', 'Delete this borrower? This cannot be undone.', async () => {
        try {
            await fsDeleteBorrower(currentUserId, id);

            appData.borrowers = appData.borrowers.filter(b => b.id !== id);
            renderBorrowers();
            updateLoanDropdowns();
            updateStats();
            showToast('Borrower deleted');
        } catch (err) {
            console.error('deleteBorrower failed:', err);
            showToast('Failed to delete borrower.', 'error');
        }
    });
}

// ================================================================
// LOANS
// ================================================================

function updateLoanDropdowns() {
    const iSelect = document.getElementById('loanInvestor');
    const bSelect = document.getElementById('loanBorrower');

    iSelect.innerHTML = '<option value="">Choose Investor...</option>' +
        appData.investors.map(i => {
            const available = i.capital - i.invested;
            return `<option value="${i.id}">${i.name} (Available: ${formatCurrency(available)})</option>`;
        }).join('');

    bSelect.innerHTML = '<option value="">Choose Borrower...</option>' +
        appData.borrowers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
}

// ── Interest / Due Date helpers — unchanged ──────────────────────

function convertDurationToMonths(duration, unit) {
    if (unit === 'days')    return duration / 30;
    if (unit === '15days')  return (duration * 15) / 30;
    if (unit === 'weeks')   return duration / 4.33;
    if (unit === 'years')   return duration * 12;
    return duration; // months
}

function calculateDueDateFromLoan(loan) {
    const start = new Date(loan.startDate);
    if (loan.dueDate && typeof loan.dueDate === 'string') {
        // If a dueDate was explicitly stored (e.g. after a delay), use it
        return new Date(loan.dueDate);
    }
    if (loan.durationUnit === 'days')   { start.setDate(start.getDate() + loan.duration); }
    else if (loan.durationUnit === '15days') { start.setDate(start.getDate() + (loan.duration * 15)); }
    else if (loan.durationUnit === 'weeks')  { start.setDate(start.getDate() + (loan.duration * 7)); }
    else if (loan.durationUnit === 'years')  { start.setFullYear(start.getFullYear() + loan.duration); }
    else { start.setMonth(start.getMonth() + (loan.durationInMonths || loan.duration)); }
    return start;
}

function calculateInterestAmount(amount, rate, frequency, durationMonths) {
    if (frequency === 'daily')   return amount * (rate / 100) * (durationMonths * 30);
    if (frequency === 'weekly')  return amount * (rate / 100) * (durationMonths * 4.33);
    if (frequency === '15days')  return amount * (rate / 100) * (durationMonths * 2);
    if (frequency === 'monthly') return amount * (rate / 100) * durationMonths;
    if (frequency === 'yearly')  return amount * (rate / 100) * (durationMonths / 12);
    return 0;
}

function calculateLoanInterest() {
    const amount       = parseFloat(document.getElementById('loanAmount').value)       || 0;
    const borrowerRate = parseFloat(document.getElementById('borrowerRate').value)     || 0;
    const investorRate = parseFloat(document.getElementById('investorRate').value)     || 0;
    const frequency    = document.getElementById('interestFrequency').value;
    const duration     = parseFloat(document.getElementById('loanDuration').value)     || 0;
    const durationUnit = document.getElementById('durationUnit').value;

    const durationInMonths       = convertDurationToMonths(duration, durationUnit);
    const totalInterestPaid      = calculateInterestAmount(amount, borrowerRate, frequency, durationInMonths);
    const investorInterestEarned = calculateInterestAmount(amount, investorRate, frequency, durationInMonths);
    const myCommission           = totalInterestPaid - investorInterestEarned;
    const totalPayable           = amount + totalInterestPaid;

    document.getElementById('calcTotalInterest').textContent = formatCurrency(totalInterestPaid);
    document.getElementById('calcInvestorShare').textContent = formatCurrency(investorInterestEarned);
    document.getElementById('calcCommission').textContent    = formatCurrency(myCommission);
    document.getElementById('totalPayable').textContent      = formatCurrency(totalPayable);

    const commEl = document.getElementById('calcCommission').parentElement;
    if (myCommission < 0) {
        commEl.style.borderLeftColor = 'red';
        document.getElementById('calcCommission').style.color = 'red';
    } else {
        commEl.style.borderLeftColor = 'var(--accent-orange)';
        document.getElementById('calcCommission').style.color = 'var(--accent-orange)';
    }

    return { totalInterestPaid, investorInterestEarned, myCommission, totalPayable, durationInMonths };
}

['loanAmount', 'borrowerRate', 'investorRate', 'interestFrequency', 'loanDuration', 'durationUnit'].forEach(id => {
    document.getElementById(id).addEventListener('input',  calculateLoanInterest);
    document.getElementById(id).addEventListener('change', calculateLoanInterest);
});

document.getElementById('startDate').valueAsDate = new Date();

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 6 — Create Loan
// Was: appData.loans.push(loan); investor.invested+=amount; saveData()
// Now: fsAddLoan() — Firestore batch handles investor + borrower counters
//      atomically, then we mirror in local appData
// ─────────────────────────────────────────────────────────────────
document.getElementById('loanForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const investorId   = document.getElementById('loanInvestor').value;
    const borrowerId   = document.getElementById('loanBorrower').value;
    const amount       = parseFloat(document.getElementById('loanAmount').value);
    const borrowerRate = parseFloat(document.getElementById('borrowerRate').value);
    const investorRate = parseFloat(document.getElementById('investorRate').value);
    const frequency    = document.getElementById('interestFrequency').value;
    const duration     = parseFloat(document.getElementById('loanDuration').value);
    const durationUnit = document.getElementById('durationUnit').value;
    const startDate    = document.getElementById('startDate').value;

    if (!investorId || !borrowerId) return showToast('Select Investor & Borrower', 'error');

    const investor = appData.investors.find(i => i.id === investorId);
    if (investor.capital - investor.invested < amount) {
        return showToast('Insufficient Capital', 'error');
    }

    const calcs    = calculateLoanInterest();
    const borrower = appData.borrowers.find(b => b.id === borrowerId);

    // Calculate dueDate string up-front so it's stored in Firestore
    const dueDateObj = (() => {
        const s = new Date(startDate);
        const d = calcs.durationInMonths;
        if (durationUnit === 'days')    s.setDate(s.getDate() + duration);
        else if (durationUnit === '15days') s.setDate(s.getDate() + duration * 15);
        else if (durationUnit === 'weeks')  s.setDate(s.getDate() + duration * 7);
        else if (durationUnit === 'years')  s.setFullYear(s.getFullYear() + duration);
        else                               s.setMonth(s.getMonth() + Math.round(d));
        return s;
    })();
    const dueDate = dueDateObj.toISOString().split('T')[0];

    const loanData = {
        investorId,    borrowerId,
        investorName:  investor.name,
        borrowerName:  borrower.name,
        amount,        borrowerRate,  investorRate,
        frequency,     duration,      durationUnit,
        durationInMonths: calcs.durationInMonths,
        startDate,     dueDate,
        totalInterest:    calcs.totalInterestPaid,
        investorShare:    calcs.investorInterestEarned,
        commissionAmount: calcs.myCommission,
        totalPayable:     calcs.totalPayable,
        status: 'active'
    };

    const submitBtn = this.querySelector('[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Creating…';

    try {
        // Firestore batch: writes loan + increments investor.invested + borrower.borrowed
        const newLoanId = await fsAddLoan(currentUserId, loanData);

        // Mirror exactly what Firestore batch did, into local appData
        loanData.id     = newLoanId;
        loanData.delays = [];
        appData.loans.push(loanData);

        investor.invested    += amount;
        investor.activeLoans += 1;
        borrower.borrowed    += amount;
        borrower.activeLoans  = (borrower.activeLoans || 0) + 1;

        renderLoans();
        renderInvestors();
        renderBorrowers();
        updateStats();
        updateCapitalOverview();
        this.reset();
        document.getElementById('startDate').valueAsDate = new Date();
        calculateLoanInterest();
        showToast('Loan Created ✓');

        // ── Step 4: fire new-loan notification ──
        await notifyLoanCreated(currentUserId, loanData, newLoanId);
    } catch (err) {
        console.error('addLoan failed:', err);
        showToast('Failed to create loan. Check connection.', 'error');
    } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Create Loan';
    }
});

function renderLoans(loans = appData.loans) {
    const tbody = document.getElementById('loansTableBody');
    if (!loans.length) {
        return (tbody.innerHTML = '<tr class="empty-row"><td colspan="9"><div class="empty-state"><span class="empty-icon">📊</span><p>No active loans.</p></div></td></tr>');
    }

    const freqMap = { daily:'Daily', monthly:'Mo.', yearly:'Yr.', weekly:'Wk.', '15days':'15-day' };
    const unitMap = { days:'days', '15days':'15-day periods', weeks:'wks', months:'mos', years:'yrs' };

    tbody.innerHTML = loans.map(loan => {
        const dueDate          = calculateDueDateFromLoan(loan);
        const dueDateFormatted = dueDate.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' });
        const durationDisplay  = loan.durationUnit
            ? `${loan.duration} ${unitMap[loan.durationUnit] || 'mos'}`
            : `${loan.duration} mos`;

        return `
        <tr>
            <td>
                <strong>${loan.borrowerName}</strong><br>
                <span style="font-size:0.8em;color:#666">from ${loan.investorName}</span>
            </td>
            <td>${formatCurrency(loan.amount)}</td>
            <td>
                <div style="font-size:0.85em;">
                    <span style="color:#ef4444">B: ${loan.borrowerRate}%</span> /
                    <span style="color:#2563eb">I: ${loan.investorRate}%</span>
                    <br><span style="color:#888">${freqMap[loan.frequency] || loan.frequency} / ${durationDisplay}</span>
                </div>
            </td>
            <td>${formatCurrency(loan.totalInterest)}</td>
            <td style="color:var(--primary-blue)">${formatCurrency(loan.investorShare)}</td>
            <td style="color:var(--accent-orange);font-weight:bold">${formatCurrency(loan.commissionAmount)}</td>
            <td>${dueDateFormatted}</td>
            <td><span class="status-badge ${loan.status}">${loan.status}</span></td>
            <td>
                ${loan.status === 'active' ? `
                    <button class="btn btn-success btn-small" onclick="completeLoan('${loan.id}')" title="Complete">✓</button>
                    <button class="btn btn-warning btn-small" onclick="addDelay('${loan.id}')"     title="Add Delay">⏰</button>
                ` : ''}
                <button class="btn btn-danger btn-small" onclick="deleteLoan('${loan.id}')" title="Delete">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 7 — Complete Loan
// Was: loan.status='completed'; investor/borrower counters; saveData()
// Now: fsUpdateLoanStatus() — Firestore batch handles all counter updates
//      + increments totalCommissionEarned on meta document
// ─────────────────────────────────────────────────────────────────
function completeLoan(id) {
    showModal('Complete Loan', 'Mark this loan as completed?', async () => {
        try {
            await fsUpdateLoanStatus(currentUserId, id, 'completed');

            // Mirror Firestore batch into local appData
            const loan = appData.loans.find(l => l.id === id);
            loan.status        = 'completed';
            loan.completedDate = new Date().toISOString().split('T')[0];

            const inv = appData.investors.find(i => i.id === loan.investorId);
            inv.invested    -= loan.amount;
            inv.activeLoans -= 1;

            const bor = appData.borrowers.find(b => b.id === loan.borrowerId);
            bor.borrowed    -= loan.amount;
            bor.activeLoans  = Math.max(0, (bor.activeLoans || 1) - 1);

            appData.totalCommissionEarned = (appData.totalCommissionEarned || 0) + loan.commissionAmount;

            renderLoans();
            renderInvestors();
            renderBorrowers();
            updateStats();
            updateCapitalOverview();
            showToast('Loan Completed ✓');

            // ── Step 4: fire loan-completed notification ──
            await notifyLoanCompleted(currentUserId, loan);
        } catch (err) {
            console.error('completeLoan failed:', err);
            showToast('Failed to complete loan.', 'error');
        }
    });
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 8 — Delete Loan
// Was: appData.loans.filter(...); investor/borrower reversal; saveData()
// Now: fsDeleteLoan() — Firestore batch reverses counters if loan was active
// ─────────────────────────────────────────────────────────────────
function deleteLoan(id) {
    showModal('Delete Loan', 'Delete this loan record permanently?', async () => {
        try {
            const loan = appData.loans.find(l => l.id === id);
            await fsDeleteLoan(currentUserId, id, loan);

            // Mirror counter reversals into local appData (only if was active)
            if (loan.status === 'active') {
                const inv = appData.investors.find(i => i.id === loan.investorId);
                inv.invested    -= loan.amount;
                inv.activeLoans -= 1;

                const bor = appData.borrowers.find(b => b.id === loan.borrowerId);
                bor.borrowed    -= loan.amount;
                bor.activeLoans  = Math.max(0, (bor.activeLoans || 1) - 1);
            }
            appData.loans = appData.loans.filter(l => l.id !== id);

            renderLoans();
            renderInvestors();
            renderBorrowers();
            updateStats();
            updateCapitalOverview();
            showToast('Loan Deleted');
        } catch (err) {
            console.error('deleteLoan failed:', err);
            showToast('Failed to delete loan.', 'error');
        }
    });
}

function updateStats() {
    document.getElementById('totalInvestors').textContent  = appData.investors.length;
    document.getElementById('totalCommission').textContent = formatCurrency(appData.totalCommissionEarned || 0);
    document.getElementById('activeLoans').textContent     = appData.loans.filter(l => l.status === 'active').length;

    const now          = new Date();
    const currentMonth = now.getMonth();
    const currentYear  = now.getFullYear();

    const monthlyEarnings = appData.loans
        .filter(loan => {
            if (loan.status === 'completed' && loan.completedDate) {
                const d = new Date(loan.completedDate);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }
            return false;
        })
        .reduce((sum, loan) => sum + (loan.commissionAmount || 0), 0);

    document.getElementById('monthlyEarnings').textContent = formatCurrency(monthlyEarnings);
}

document.getElementById('searchLoans').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    renderLoans(appData.loans.filter(l =>
        l.borrowerName.toLowerCase().includes(term) ||
        l.investorName.toLowerCase().includes(term)
    ));
});

// ================================================================
// PDF EXPORT  — unchanged (reads from in-memory appData)
// ================================================================

function downloadDataReport() {
    try {
        const { jsPDF } = window.jspdf;
        const doc        = new jsPDF();

        let yPosition    = 20;
        const pageWidth  = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const margin     = 20;

        function checkPageBreak(requiredSpace) {
            if (yPosition + requiredSpace > pageHeight - 20) {
                doc.addPage();
                yPosition = 20;
                return true;
            }
            return false;
        }

        // Title
        doc.setFontSize(22); doc.setFont(undefined, 'bold'); doc.setTextColor(10, 14, 39);
        doc.text('Sandesh Finance', pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 8;
        doc.setFontSize(14);
        doc.text('Data Export Report', pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 15;

        doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(107, 114, 128);
        doc.text(`Generated: ${new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}`,
            pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 15;

        // Executive Summary
        doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(37, 99, 235);
        doc.text('Executive Summary', margin, yPosition);
        yPosition += 10;

        const totalCapital  = appData.investors.reduce((s, i) => s + i.capital,  0);
        const totalInvested = appData.investors.reduce((s, i) => s + i.invested, 0);
        const now           = new Date();
        const monthlyEarnings = appData.loans
            .filter(l => l.status === 'completed' && l.completedDate &&
                new Date(l.completedDate).getMonth()     === now.getMonth() &&
                new Date(l.completedDate).getFullYear()  === now.getFullYear())
            .reduce((s, l) => s + (l.commissionAmount || 0), 0);

        doc.autoTable({
            startY: yPosition,
            head:   [['Metric', 'Value']],
            body:   [
                ['Total Investors',        appData.investors.length.toString()],
                ['Total Borrowers',        appData.borrowers.length.toString()],
                ['Total Capital',          formatCurrency(totalCapital)],
                ['Currently Invested',     formatCurrency(totalInvested)],
                ['Available Capital',      formatCurrency(totalCapital - totalInvested)],
                ['Active Loans',           appData.loans.filter(l => l.status === 'active').length.toString()],
                ['Completed Loans',        appData.loans.filter(l => l.status === 'completed').length.toString()],
                ['Total Commission',       formatCurrency(appData.totalCommissionEarned || 0)],
                ['This Month Earnings',    formatCurrency(monthlyEarnings)],
            ],
            theme: 'grid',
            headStyles: { fillColor: [37, 99, 235], fontSize: 10, fontStyle: 'bold' },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 }, 1: { cellWidth: 90 } },
            styles: { fontSize: 9, cellPadding: 5 },
            margin: { left: margin, right: margin }
        });
        yPosition = doc.lastAutoTable.finalY + 15;

        // Investors
        if (appData.investors.length) {
            checkPageBreak(30);
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(37, 99, 235);
            doc.text('Investors', margin, yPosition); yPosition += 10;
            appData.investors.forEach(inv => {
                checkPageBreak(40);
                doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(55, 65, 81);
                doc.text(inv.name, margin, yPosition); yPosition += 8;
                doc.autoTable({
                    startY: yPosition,
                    body: [
                        ['Phone',              inv.phone],
                        ['Total Capital',      formatCurrency(inv.capital)],
                        ['Currently Invested', formatCurrency(inv.invested)],
                        ['Available Balance',  formatCurrency(inv.capital - inv.invested)],
                        ['Active Loans',       inv.activeLoans.toString()],
                    ],
                    theme: 'plain',
                    columnStyles: { 0: { fontStyle:'bold', cellWidth:70, fillColor:[243,244,246] }, 1: { cellWidth:100 } },
                    styles: { fontSize:9, cellPadding:4, lineColor:[209,213,219], lineWidth:0.5 },
                    margin: { left: margin, right: margin }
                });
                yPosition = doc.lastAutoTable.finalY + 10;
            });
        }

        // Borrowers
        if (appData.borrowers.length) {
            checkPageBreak(30);
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(37, 99, 235);
            doc.text('Loan Takers (Borrowers)', margin, yPosition); yPosition += 10;
            appData.borrowers.forEach(b => {
                checkPageBreak(35);
                doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(55, 65, 81);
                doc.text(b.name, margin, yPosition); yPosition += 8;
                doc.autoTable({
                    startY: yPosition,
                    body: [
                        ['Phone',          b.phone],
                        ['Address',        b.address || 'Not provided'],
                        ['Total Borrowed', formatCurrency(b.borrowed)],
                        ['Active Loans',   (b.activeLoans || 0).toString()],
                    ],
                    theme: 'plain',
                    columnStyles: { 0: { fontStyle:'bold', cellWidth:70, fillColor:[243,244,246] }, 1: { cellWidth:100 } },
                    styles: { fontSize:9, cellPadding:4, lineColor:[209,213,219], lineWidth:0.5 },
                    margin: { left: margin, right: margin }
                });
                yPosition = doc.lastAutoTable.finalY + 10;
            });
        }

        // Active Loans
        const activeLoans = appData.loans.filter(l => l.status === 'active');
        if (activeLoans.length) {
            doc.addPage(); yPosition = 20;
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(37, 99, 235);
            doc.text('Active Loans', margin, yPosition); yPosition += 10;
            const unitMap = { days:'days', '15days':'15-day periods', weeks:'weeks', months:'months', years:'years' };
            activeLoans.forEach(loan => {
                checkPageBreak(50);
                doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(55, 65, 81);
                doc.text(`${loan.borrowerName} ← ${loan.investorName}`, margin, yPosition); yPosition += 7;
                const dur = loan.durationUnit ? `${loan.duration} ${unitMap[loan.durationUnit]}` : `${loan.duration} months`;
                doc.autoTable({
                    startY: yPosition,
                    body: [
                        ['Loan Amount',                  formatCurrency(loan.amount)],
                        ['Borrower Rate',                `${loan.borrowerRate}% (${loan.frequency})`],
                        ['Investor Rate',                `${loan.investorRate}% (${loan.frequency})`],
                        ['Duration',                     dur],
                        ['Start Date',                   formatDate(loan.startDate)],
                        ['Total Interest (from Borrower)', formatCurrency(loan.totalInterest)],
                        ['Investor Share',               formatCurrency(loan.investorShare)],
                        ['Your Profit',                  formatCurrency(loan.commissionAmount)],
                        ['Total Repayment',              formatCurrency(loan.totalPayable)],
                    ],
                    theme: 'plain',
                    columnStyles: { 0: { fontStyle:'bold', cellWidth:80, fillColor:[239,246,255] }, 1: { cellWidth:90 } },
                    styles: { fontSize:8, cellPadding:3, lineColor:[191,219,254], lineWidth:0.5 },
                    margin: { left: margin, right: margin }
                });
                yPosition = doc.lastAutoTable.finalY + 8;
            });
        }

        // Completed Loans
        const completedLoans = appData.loans.filter(l => l.status === 'completed');
        if (completedLoans.length) {
            checkPageBreak(30);
            doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(37, 99, 235);
            doc.text('Completed Loans', margin, yPosition); yPosition += 10;
            const unitMap2 = { days:'days', '15days':'15-day periods', weeks:'weeks', months:'months', years:'years' };
            completedLoans.forEach(loan => {
                checkPageBreak(40);
                doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(55, 65, 81);
                doc.text(`${loan.borrowerName} ← ${loan.investorName} (Completed)`, margin, yPosition); yPosition += 7;
                doc.autoTable({
                    startY: yPosition,
                    body: [
                        ['Loan Amount',       formatCurrency(loan.amount)],
                        ['Duration',          loan.durationUnit ? `${loan.duration} ${unitMap2[loan.durationUnit]}` : `${loan.duration} months`],
                        ['Start Date',        formatDate(loan.startDate)],
                        ['Your Profit Earned', formatCurrency(loan.commissionAmount)],
                    ],
                    theme: 'plain',
                    columnStyles: { 0: { fontStyle:'bold', cellWidth:80, fillColor:[240,253,244] }, 1: { cellWidth:90 } },
                    styles: { fontSize:8, cellPadding:3, lineColor:[187,247,208], lineWidth:0.5 },
                    margin: { left: margin, right: margin }
                });
                yPosition = doc.lastAutoTable.finalY + 8;
            });
        }

        // Page numbers
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8); doc.setTextColor(107, 114, 128);
            doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
        }

        doc.save(`Sandesh_Finance_Export_${new Date().toISOString().split('T')[0]}.pdf`);
        showToast('Data exported successfully!', 'success');
    } catch (error) {
        console.error('PDF export error:', error);
        showToast('Error generating PDF.', 'error');
    }
}

// ================================================================
// EDIT INVESTOR CAPITAL
// ================================================================

let currentEditingInvestorId = null;

function editInvestorCapital(investorId) {
    currentEditingInvestorId = investorId;
    const investor = appData.investors.find(inv => inv.id === investorId);
    if (!investor) return showToast('Investor not found', 'error');

    document.getElementById('editInvestorName').textContent   = investor.name;
    document.getElementById('currentCapital').textContent     = formatCurrency(investor.capital);
    document.getElementById('currentInvested').textContent    = formatCurrency(investor.invested);
    document.getElementById('newCapital').value               = investor.capital;
    document.getElementById('newCapital').min                 = investor.invested;
    document.getElementById('editCapitalModal').classList.add('show');
}

function closeEditCapitalDialog() {
    document.getElementById('editCapitalModal').classList.remove('show');
    currentEditingInvestorId = null;
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 9 — Edit Investor Capital
// Was: investor.capital = newCapital; saveData()
// Now: fsUpdateInvestor(userId, id, { capital: newCapital })
// ─────────────────────────────────────────────────────────────────
document.getElementById('editCapitalForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const newCapital = parseFloat(document.getElementById('newCapital').value);
    const investor   = appData.investors.find(inv => inv.id === currentEditingInvestorId);
    if (!investor) return showToast('Investor not found', 'error');

    if (newCapital < investor.invested) {
        return showToast('New capital cannot be less than currently invested amount', 'error');
    }

    const submitBtn = this.querySelector('[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Saving…';

    try {
        await fsUpdateInvestor(currentUserId, currentEditingInvestorId, { capital: newCapital });

        investor.capital = newCapital;   // mirror in local appData

        renderInvestors();
        updateCapitalOverview();
        closeEditCapitalDialog();
        showToast('Capital updated successfully');
    } catch (err) {
        console.error('editCapital failed:', err);
        showToast('Failed to update capital.', 'error');
    } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Update Capital';
    }
});

// ================================================================
// DELAY MANAGEMENT
// ================================================================

let currentDelayLoanId = null;

function addDelay(loanId) {
    currentDelayLoanId = loanId;
    const loan = appData.loans.find(l => l.id === loanId);
    if (!loan) return showToast('Loan not found', 'error');

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('delayDate').min = today;

    const currentDueDate = new Date(loan.startDate);
    const monthsToAdd    = loan.durationInMonths || loan.duration;
    currentDueDate.setMonth(currentDueDate.getMonth() + monthsToAdd);
    document.getElementById('delayDate').value = currentDueDate.toISOString().split('T')[0];

    document.getElementById('penaltyAmount').value    = 0;
    document.getElementById('penaltyFrequency').value = 'none';
    document.getElementById('delayReason').value      = '';
    document.getElementById('delayModal').classList.add('show');
}

function closeDelayDialog() {
    document.getElementById('delayModal').classList.remove('show');
    currentDelayLoanId = null;
}

// ─────────────────────────────────────────────────────────────────
// MUTATION SITE 10 — Add Loan Delay
// Was: loan.delays.push(entry); loan.dueDate=...; saveData()
// Now: fsAddLoanDelay(userId, loanId, delayEntry, updatedFields)
// ─────────────────────────────────────────────────────────────────
document.getElementById('delayForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const loan = appData.loans.find(l => l.id === currentDelayLoanId);
    if (!loan) return showToast('Loan not found', 'error');

    const newDueDate       = document.getElementById('delayDate').value;
    const penaltyAmount    = parseFloat(document.getElementById('penaltyAmount').value) || 0;
    const penaltyFrequency = document.getElementById('penaltyFrequency').value;
    const delayReason      = document.getElementById('delayReason').value.trim();

    const startDate = new Date(loan.startDate);
    const newDue    = new Date(newDueDate);
    const diffDays  = Math.ceil(Math.abs(newDue - startDate) / (1000 * 60 * 60 * 24));

    const delayEntry = {
        id:              generateId(),
        previousDueDate: loan.dueDate || calculateDueDate(loan),
        newDueDate,
        penaltyAmount,
        penaltyFrequency,
        reason:          delayReason,
        addedDate:       new Date().toISOString().split('T')[0]
    };

    // Compute updated loan fields
    const updatedFields = {
        durationInMonths: Math.ceil(diffDays / 30),
        dueDate:          newDueDate,
    };

    if (penaltyAmount > 0) {
        const penaltyCommission = penaltyAmount * 0.2;
        updatedFields.totalPayable     = (loan.totalPayable || (loan.amount + loan.totalInterest)) + penaltyAmount;
        updatedFields.totalInterest    = loan.totalInterest    + penaltyAmount;
        updatedFields.commissionAmount = loan.commissionAmount + penaltyCommission;
        updatedFields.investorShare    = loan.investorShare    + (penaltyAmount - penaltyCommission);
    }

    const submitBtn = this.querySelector('[type="submit"]');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Saving…';

    try {
        await fsAddLoanDelay(currentUserId, currentDelayLoanId, delayEntry, updatedFields);

        // Mirror into local appData
        if (!loan.delays) loan.delays = [];
        loan.delays.push(delayEntry);
        Object.assign(loan, updatedFields);

        renderLoans();
        closeDelayDialog();
        showToast('Delay added successfully');
    } catch (err) {
        console.error('addLoanDelay failed:', err);
        showToast('Failed to save delay.', 'error');
    } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Apply Delay';
    }
});

function calculateDueDate(loan) {
    return calculateDueDateFromLoan(loan).toISOString().split('T')[0];
}

// ================================================================
// INVESTMENT & BORROWER DETAIL MODALS  — unchanged
// ================================================================

function showInvestorDetails(investorId) {
    const investor = appData.investors.find(inv => inv.id === investorId);
    if (!investor) return;

    const modal        = document.getElementById('investmentDetailsModal');
    const investorLoans = appData.loans.filter(l => l.investorId === investorId && l.status === 'active');

    document.getElementById('investmentPersonName').textContent    = investor.name;
    document.getElementById('investmentTotalAmount').textContent   = formatCurrency(investorLoans.reduce((s, l) => s + l.amount, 0));
    document.getElementById('investmentActiveLoans').textContent   = investorLoans.length;
    document.getElementById('investmentExpectedReturns').textContent = formatCurrency(investorLoans.reduce((s, l) => s + l.amount + l.investorShare, 0));

    const unitMap = { days:'days', '15days':'15-day periods', weeks:'wks', months:'mos', years:'yrs' };

    document.getElementById('investmentDetailsList').innerHTML = investorLoans.length === 0
        ? '<div class="empty-state"><p>No active investments</p></div>'
        : investorLoans.map(loan => {
            const dueDate      = calculateDueDateFromLoan(loan);
            const durDisplay   = loan.durationUnit ? `${loan.duration} ${unitMap[loan.durationUnit]}` : `${loan.duration} months`;
            const roi          = ((loan.investorShare / loan.amount) * 100).toFixed(2);
            return `
                <div class="investment-detail-card">
                    <div class="investment-detail-header">
                        <div>
                            <h4>Loan to: ${loan.borrowerName}</h4>
                            <span class="investment-detail-date">Started: ${formatDate(loan.startDate)}</span>
                        </div>
                        <span class="status-badge ${loan.status}">${loan.status}</span>
                    </div>
                    <div class="investment-detail-stats">
                        <div class="investment-detail-row"><span class="detail-label">Amount Invested:</span><span class="detail-value">${formatCurrency(loan.amount)}</span></div>
                        <div class="investment-detail-row"><span class="detail-label">Interest Rate:</span><span class="detail-value">${loan.investorRate}% (${loan.frequency})</span></div>
                        <div class="investment-detail-row"><span class="detail-label">Duration:</span><span class="detail-value">${durDisplay}</span></div>
                        <div class="investment-detail-row"><span class="detail-label">Due Date:</span><span class="detail-value highlight">${dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div>
                        <div class="investment-detail-row"><span class="detail-label">Interest Earned:</span><span class="detail-value profit">${formatCurrency(loan.investorShare)}</span></div>
                        <div class="investment-detail-row total"><span class="detail-label">Expected Return:</span><span class="detail-value">${formatCurrency(loan.amount + loan.investorShare)}</span></div>
                        <div class="investment-detail-row"><span class="detail-label">ROI:</span><span class="detail-value roi">${roi}%</span></div>
                    </div>
                </div>`;
        }).join('');

    modal.classList.add('show');
}

function closeInvestmentDetailsDialog() {
    document.getElementById('investmentDetailsModal').classList.remove('show');
}

function showBorrowerDetails(borrowerId) {
    const borrower = appData.borrowers.find(b => b.id === borrowerId);
    if (!borrower) return;

    const modal         = document.getElementById('borrowerLoansModal');
    const borrowerLoans = appData.loans.filter(l => l.borrowerId === borrowerId && l.status === 'active');

    document.getElementById('borrowerPersonName').textContent  = borrower.name;
    document.getElementById('borrowerTotalBorrowed').textContent = formatCurrency(borrowerLoans.reduce((s, l) => s + l.amount, 0));
    document.getElementById('borrowerActiveLoans').textContent   = borrowerLoans.length;
    document.getElementById('borrowerTotalPayable').textContent  = formatCurrency(borrowerLoans.reduce((s, l) => s + l.totalPayable, 0));

    const unitMap = { days:'days', '15days':'15-day periods', weeks:'wks', months:'mos', years:'yrs' };

    document.getElementById('borrowerLoansList').innerHTML = borrowerLoans.length === 0
        ? '<div class="empty-state"><p>No active loans</p></div>'
        : borrowerLoans.map(loan => {
            const dueDate    = calculateDueDateFromLoan(loan);
            const durDisplay = loan.durationUnit ? `${loan.duration} ${unitMap[loan.durationUnit]}` : `${loan.duration} months`;
            return `
                <div class="borrower-loan-card">
                    <div class="borrower-loan-header">
                        <div>
                            <h4>Loan from: ${loan.investorName}</h4>
                            <span class="borrower-loan-date">Started: ${formatDate(loan.startDate)}</span>
                        </div>
                        <span class="status-badge ${loan.status}">${loan.status}</span>
                    </div>
                    <div class="borrower-loan-stats">
                        <div class="borrower-loan-row"><span class="detail-label">Amount Borrowed:</span><span class="detail-value">${formatCurrency(loan.amount)}</span></div>
                        <div class="borrower-loan-row"><span class="detail-label">Interest Rate:</span><span class="detail-value">${loan.borrowerRate}% (${loan.frequency})</span></div>
                        <div class="borrower-loan-row"><span class="detail-label">Duration:</span><span class="detail-value">${durDisplay}</span></div>
                        <div class="borrower-loan-row"><span class="detail-label">Due Date:</span><span class="detail-value highlight">${dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div>
                        <div class="borrower-loan-row"><span class="detail-label">Interest Amount:</span><span class="detail-value cost">${formatCurrency(loan.totalInterest)}</span></div>
                        <div class="borrower-loan-row total"><span class="detail-label">Total Payable:</span><span class="detail-value">${formatCurrency(loan.totalPayable)}</span></div>
                    </div>
                </div>`;
        }).join('');

    modal.classList.add('show');
}

function closeBorrowerLoansDialog() {
    document.getElementById('borrowerLoansModal').classList.remove('show');
}

// ================================================================
// PORTFOLIO VIEW  — unchanged
// ================================================================

function viewInvestorPortfolio(investorId) {
    const investor      = appData.investors.find(inv => inv.id === investorId);
    if (!investor) return;

    const modal         = document.getElementById('portfolioModal');
    const investorLoans = appData.loans.filter(l => l.investorId === investorId && l.status === 'active');

    document.getElementById('portfolioInvestorName').textContent   = investor.name;
    document.getElementById('portfolioTotalInvested').textContent  = formatCurrency(investorLoans.reduce((s, l) => s + l.amount, 0));
    document.getElementById('portfolioActiveLoans').textContent    = investorLoans.length;
    document.getElementById('portfolioExpectedReturns').textContent = formatCurrency(investorLoans.reduce((s, l) => s + l.investorShare, 0));

    const freqLabels = { '15days':'15 Days', daily:'Daily', weekly:'Weekly', monthly:'Monthly', yearly:'Yearly' };

    document.getElementById('portfolioInvestmentsList').innerHTML = investorLoans.length === 0
        ? '<div class="empty-state"><span class="empty-icon">📊</span><p>No active investments</p></div>'
        : investorLoans.map(loan => {
            const borrower = appData.borrowers.find(b => b.id === loan.borrowerId);
            return `
                <div class="portfolio-investment-item">
                    <div class="portfolio-loan-header">
                        <div>
                            <h4>👤 ${borrower ? borrower.name : loan.borrowerName}</h4>
                            <p class="portfolio-loan-meta">Loan #${loan.id.substr(0, 8)}</p>
                        </div>
                        <div class="portfolio-status ${loan.status}">${loan.status}</div>
                    </div>
                    <div class="portfolio-loan-details">
                        <div class="portfolio-detail-row"><span class="detail-label">Loan Amount:</span><span class="detail-value">${formatCurrency(loan.amount)}</span></div>
                        <div class="portfolio-detail-row"><span class="detail-label">Investor Rate:</span><span class="detail-value">${loan.investorRate}% ${freqLabels[loan.frequency] || loan.frequency}</span></div>
                        <div class="portfolio-detail-row"><span class="detail-label">Expected Returns:</span><span class="detail-value success">${formatCurrency(loan.investorShare)}</span></div>
                        <div class="portfolio-detail-row"><span class="detail-label">Due Date:</span><span class="detail-value">${formatDate(loan.dueDate || calculateDueDateFromLoan(loan).toISOString().split('T')[0])}</span></div>
                        <div class="portfolio-detail-row"><span class="detail-label">Start Date:</span><span class="detail-value">${formatDate(loan.startDate)}</span></div>
                    </div>
                </div>`;
        }).join('');

    modal.classList.add('show');
}

function closePortfolioDialog() {
    document.getElementById('portfolioModal').classList.remove('show');
}

// ================================================================
// GLOBAL WINDOW EXPORTS (needed for inline onclick handlers in HTML)
// ================================================================

window.toggleInvestorForm          = toggleInvestorForm;
window.toggleBorrowerForm          = toggleBorrowerForm;
window.deleteInvestor              = deleteInvestor;
window.deleteBorrower              = deleteBorrower;
window.completeLoan                = completeLoan;
window.deleteLoan                  = deleteLoan;
window.showDueDatesDialog          = showDueDatesDialog;
window.closeDueDatesDialog         = closeDueDatesDialog;
window.dismissAlerts               = dismissAlerts;
window.downloadDataReport          = downloadDataReport;
window.editInvestorCapital         = editInvestorCapital;
window.closeEditCapitalDialog      = closeEditCapitalDialog;
window.addDelay                    = addDelay;
window.closeDelayDialog            = closeDelayDialog;
window.showInvestorDetails         = showInvestorDetails;
window.closeInvestmentDetailsDialog = closeInvestmentDetailsDialog;
window.showBorrowerDetails         = showBorrowerDetails;
window.closeBorrowerLoansDialog    = closeBorrowerLoansDialog;
window.viewInvestorPortfolio       = viewInvestorPortfolio;
window.closePortfolioDialog        = closePortfolioDialog;

// ================================================================
// INITIALIZATION  — replaces DOMContentLoaded + loadData()
//
// onAuthChange fires as soon as Firebase resolves the session.
// • Not logged in  → redirect to login.html
// • Logged in      → load all Firestore data, then render everything
// ================================================================

onAuthChange(async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    currentUserId = user.uid;

    // Show user info in header (from Step 1's index.html)
    const userEmailEl = document.getElementById('userEmail');
    const userInfoEl  = document.getElementById('userInfo');
    if (userEmailEl) userEmailEl.textContent = user.email || user.displayName || '';
    if (userInfoEl)  userInfoEl.style.display = 'flex';

    // Wire logout button (Step 1)
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.onclick = async () => {
            await logout();
            // onAuthChange fires again with null → redirects to login.html
        };
    }

    // Show loading skeleton while Firestore fetches
    showAppLoading();

    try {
        // ── Single parallel fetch replaces localStorage.getItem() ──
        appData = await loadAllData(currentUserId);

        await cleanupOldAlerts();   // prune stale dismiss keys

        // ── Step 4: start notification system ──
        await initNotifications(currentUserId);

        // Render everything exactly as before
        renderInvestors();
        renderBorrowers();
        renderLoans();
        updateLoanDropdowns();
        updateStats();
        updateCapitalOverview();

        setTimeout(() => checkUrgentAlerts(), 800);

    } catch (err) {
        console.error('Initial data load failed:', err);
        showToast('Failed to load data. Check your connection.', 'error');
        document.getElementById('loansTableBody').innerHTML =
            '<tr><td colspan="9" style="text-align:center;padding:32px;color:#ef4444;">⚠ Could not load data. Please refresh.</td></tr>';
    } finally {
        hideAppLoading();
        document.body.style.visibility = 'visible';
    }
});
