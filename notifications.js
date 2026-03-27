// ================================================================
// notifications.js — Sandesh Finance Step 4
// Notification System: load, render, mark-read, badge, auto-create
//
// IMPORTS  — consumed by script.js after auth resolves:
//   import { initNotifications, triggerNotification } from './notifications.js';
//
// PUBLIC API
//   initNotifications(userId)        — call once after login
//   triggerNotification(uid, data)   — call after any business event
//   loadNotifications()              — refresh list from Firestore
//   markNotificationRead(id)         — mark one notification read
//   updateNotificationCount()        — re-sync badge from appData cache
// ================================================================

import {
    getNotifications      as fsGetNotifications,
    markNotificationRead  as fsMarkRead,
    markAllNotificationsRead as fsMarkAllRead,
    addNotification       as fsAddNotification,
    deleteNotification    as fsDeleteNotif,
} from './firestore.js';

// ── Module-level state ────────────────────────────────────────────
let _userId       = null;
let _notifications = [];     // in-memory cache (newest first)
let _dropdownOpen  = false;
let _autoRefreshTimer = null;

// ── DOM refs (resolved once after DOMContentLoaded) ──────────────
const $  = id => document.getElementById(id);

// ================================================================
// PUBLIC: initNotifications(userId)
// Call once inside onAuthChange after the user is confirmed.
// Wires all DOM events, loads initial data, starts auto-refresh.
// ================================================================
export async function initNotifications(userId) {
    _userId = userId;

    _wireBellToggle();
    _wireMarkAll();
    _wireClearRead();
    _wireOutsideClick();
    _wireKeyboardClose();

    await loadNotifications();

    // Auto-refresh every 2 minutes — catches server-side notifications
    _autoRefreshTimer = setInterval(loadNotifications, 2 * 60 * 1000);
}

// ================================================================
// PUBLIC: loadNotifications()
// Fetches all notifications for the current user from Firestore,
// updates the in-memory cache, re-renders the list, and syncs the badge.
// ================================================================
export async function loadNotifications() {
    if (!_userId) return;

    _showSkeleton(true);

    try {
        _notifications = await fsGetNotifications(_userId);   // newest-first
        _renderList();
        updateNotificationCount();
    } catch (err) {
        console.error('loadNotifications failed:', err);
        _showError();
    } finally {
        _showSkeleton(false);
    }
}

// ================================================================
// PUBLIC: markNotificationRead(notifId)
// Marks a single notification as read in Firestore + local cache,
// then re-renders and re-syncs the badge.
// ================================================================
export async function markNotificationRead(notifId) {
    try {
        await fsMarkRead(_userId, notifId);

        // Update local cache immediately (no re-fetch needed)
        const n = _notifications.find(n => n.id === notifId);
        if (n) n.isRead = true;

        _renderList();
        updateNotificationCount();
    } catch (err) {
        console.error('markNotificationRead failed:', err);
    }
}

// ================================================================
// PUBLIC: updateNotificationCount()
// Counts unread notifications in the local cache and updates the
// badge + the unread pill inside the dropdown header.
// ================================================================
export function updateNotificationCount() {
    const unreadCount = _notifications.filter(n => !n.isRead).length;

    const badge     = $('notifBadge');
    const bell      = $('notifBellBtn');
    const pill      = $('notifUnreadPill');
    const footerCnt = $('notifFooterCount');

    // Badge number
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);

    if (unreadCount > 0) {
        badge.classList.add('visible');
        bell.classList.add('has-unread');
        pill.textContent = `${unreadCount} unread`;
        pill.classList.add('visible');
    } else {
        badge.classList.remove('visible');
        bell.classList.remove('has-unread');
        pill.classList.remove('visible');
    }

    // Footer count
    if (footerCnt) {
        footerCnt.textContent = _notifications.length === 0
            ? 'No notifications'
            : `${_notifications.length} total · ${unreadCount} unread`;
    }
}

// ================================================================
// PUBLIC: triggerNotification(userId, data)
// Call this from business logic (script.js) after events like
// loan creation, completion, etc. Writes to Firestore and refreshes.
//
//  USAGE EXAMPLES (from script.js):
//
//   After addLoan:
//     await triggerNotification(uid, {
//         type:    'new_loan',
//         title:   'Loan Created',
//         message: `₹${formatAmount} to ${borrowerName} via ${investorName}`,
//         loanId:  newLoanId
//     });
//
//   After completeLoan:
//     await triggerNotification(uid, {
//         type:    'loan_completed',
//         title:   'Loan Completed',
//         message: `Loan of ₹${amount} by ${borrowerName} marked complete. Profit: ₹${commission}`,
//         loanId:  loanId
//     });
// ================================================================
export async function triggerNotification(userId, data) {
    try {
        await fsAddNotification(userId, data);
        await loadNotifications();   // reload so new item appears immediately
    } catch (err) {
        console.warn('triggerNotification failed (non-critical):', err);
    }
}

// ================================================================
// RENDER: builds the notification list HTML
// ================================================================
function _renderList() {
    const list = $('notifList');
    if (!list) return;

    if (_notifications.length === 0) {
        list.innerHTML = `
            <div class="notif-empty">
                <span class="notif-empty-icon">🔔</span>
                <span class="notif-empty-text">All caught up!</span>
                <span class="notif-empty-sub">New alerts will appear here</span>
            </div>`;
        return;
    }

    list.innerHTML = _notifications.map(n => _buildItemHTML(n)).join('');

    // Wire mark-read buttons
    list.querySelectorAll('.notif-read-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.id;
            _animateRead(id);
            markNotificationRead(id);
        });
    });
}

// ── Build one notification item ───────────────────────────────────
function _buildItemHTML(n) {
    const readClass    = n.isRead ? 'read' : 'unread';
    const urgentClass  = _isUrgent(n) ? ' urgent' : '';
    const icon         = _typeIcon(n.type);
    const timeStr      = _relativeTime(n.createdAt);

    return `
    <div class="notif-item ${readClass}${urgentClass}" id="notif-${n.id}" data-id="${n.id}">
        <span class="notif-dot"></span>
        <div class="notif-icon-bubble type-${n.type || 'general'}">${icon}</div>
        <div class="notif-body">
            <div class="notif-item-title">${_escHtml(n.title)}</div>
            <div class="notif-item-msg">${_escHtml(n.message)}</div>
            <div class="notif-item-time">${timeStr}</div>
        </div>
        ${!n.isRead
            ? `<button class="notif-read-btn" data-id="${n.id}" title="Mark as read">✓</button>`
            : ''}
    </div>`;
}

// ================================================================
// HELPERS
// ================================================================

// Animate a notification item to "read" state before Firestore resolves
function _animateRead(notifId) {
    const el = document.getElementById(`notif-${notifId}`);
    if (!el) return;
    el.classList.remove('unread');
    el.classList.add('read');
    const btn = el.querySelector('.notif-read-btn');
    if (btn) btn.remove();
    const dot = el.querySelector('.notif-dot');
    if (dot) dot.style.opacity = '0';
}

// Pulse the badge when a new unread count lands
function _pulseBadge() {
    const badge = $('notifBadge');
    if (!badge) return;
    badge.classList.remove('pulse');
    void badge.offsetWidth;   // reflow to retrigger animation
    badge.classList.add('pulse');
}

// Decide if a notification should be styled "urgent"
function _isUrgent(n) {
    return n.type === 'loan_overdue' || n.type === 'loan_due';
}

// Return the right emoji for each notification type
function _typeIcon(type) {
    const icons = {
        new_loan:       '💸',
        loan_due:       '⚠️',
        loan_overdue:   '🚨',
        loan_completed: '✅',
        general:        '🔔',
    };
    return icons[type] || '🔔';
}

// Convert a Firestore Timestamp or ISO string → "2 min ago" style
function _relativeTime(ts) {
    if (!ts) return '';

    let date;
    if (ts?.toDate) {
        date = ts.toDate();                          // Firestore Timestamp
    } else if (typeof ts === 'string') {
        date = new Date(ts);                         // ISO string
    } else if (ts?.seconds) {
        date = new Date(ts.seconds * 1000);          // raw seconds object
    } else {
        return '';
    }

    const diff  = Math.floor((Date.now() - date.getTime()) / 1000);  // seconds

    if (diff < 60)                return 'Just now';
    if (diff < 3600)              return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400)             return `${Math.floor(diff / 3600)} hr ago`;
    if (diff < 86400 * 2)         return 'Yesterday';
    if (diff < 86400 * 7)         return `${Math.floor(diff / 86400)} days ago`;

    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Prevent XSS in notification text
function _escHtml(str = '') {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Show / hide loading skeleton ─────────────────────────────────
function _showSkeleton(show) {
    const skel = $('notifSkeleton');
    const list = $('notifList');
    if (!skel || !list) return;

    if (show) {
        list.innerHTML = '';
        list.appendChild(skel);
        skel.style.display = 'flex';
    } else {
        if (skel.parentNode === list) list.removeChild(skel);
    }
}

function _showError() {
    const list = $('notifList');
    if (!list) return;
    list.innerHTML = `
        <div class="notif-empty">
            <span class="notif-empty-icon">⚠️</span>
            <span class="notif-empty-text">Could not load notifications</span>
            <span class="notif-empty-sub">Check your connection and try again</span>
        </div>`;
}

// ================================================================
// EVENT WIRING
// ================================================================

// Toggle dropdown open/closed
function _wireBellToggle() {
    const bell     = $('notifBellBtn');
    const dropdown = $('notifDropdown');
    if (!bell || !dropdown) return;

    bell.addEventListener('click', e => {
        e.stopPropagation();
        _dropdownOpen = !_dropdownOpen;
        dropdown.classList.toggle('open', _dropdownOpen);
        bell.setAttribute('aria-expanded', String(_dropdownOpen));

        if (_dropdownOpen) {
            // Refresh when opening so counts are always fresh
            loadNotifications();
        }
    });
}

// Mark-all button
function _wireMarkAll() {
    const btn = $('notifMarkAllBtn');
    if (!btn) return;

    btn.addEventListener('click', async e => {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = 'Marking…';
        try {
            await fsMarkAllRead(_userId);
            _notifications.forEach(n => (n.isRead = true));
            _renderList();
            updateNotificationCount();
        } catch (err) {
            console.error('markAll failed:', err);
        } finally {
            btn.disabled = false;
            btn.textContent = '✓ Mark all read';
        }
    });
}

// Clear-read button — deletes all read notifications from Firestore
function _wireClearRead() {
    const btn = $('notifClearReadBtn');
    if (!btn) return;

    btn.addEventListener('click', async e => {
        e.stopPropagation();
        const readOnes = _notifications.filter(n => n.isRead);
        if (!readOnes.length) return;

        btn.disabled    = true;
        btn.textContent = 'Clearing…';

        try {
            await Promise.all(readOnes.map(n => fsDeleteNotif(_userId, n.id)));
            _notifications = _notifications.filter(n => !n.isRead);
            _renderList();
            updateNotificationCount();
        } catch (err) {
            console.error('clearRead failed:', err);
        } finally {
            btn.disabled    = false;
            btn.textContent = '🗑 Clear read';
        }
    });
}

// Close when clicking outside
function _wireOutsideClick() {
    document.addEventListener('click', e => {
        const wrapper = $('notifWrapper');
        if (!wrapper) return;
        if (!wrapper.contains(e.target) && _dropdownOpen) {
            _dropdownOpen = false;
            $('notifDropdown')?.classList.remove('open');
            $('notifBellBtn')?.setAttribute('aria-expanded', 'false');
        }
    });
}

// Close on Escape key
function _wireKeyboardClose() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _dropdownOpen) {
            _dropdownOpen = false;
            $('notifDropdown')?.classList.remove('open');
            $('notifBellBtn')?.setAttribute('aria-expanded', 'false');
            $('notifBellBtn')?.focus();
        }
    });
}

// ================================================================
// AUTO-GENERATE NOTIFICATIONS FROM LOAN EVENTS
//
// These helpers are called from script.js at the relevant mutation
// sites so every business action produces an in-app notification.
//
// INTEGRATION CHECKLIST (add to script.js):
//
//  1. At top of script.js:
//       import { initNotifications, triggerNotification } from './notifications.js';
//
//  2. Inside onAuthChange, after loadAllData():
//       await initNotifications(currentUserId);
//
//  3. In loanForm submit handler, after fsAddLoan():
//       await notifyLoanCreated(currentUserId, loanData, newLoanId);
//
//  4. In completeLoan handler, after fsUpdateLoanStatus():
//       await notifyLoanCompleted(currentUserId, loan);
//
//  5. In checkUrgentAlerts(), after existing logic:
//       await notifyUrgentLoans(currentUserId, urgentLoans);
// ================================================================

export async function notifyLoanCreated(userId, loan, loanId) {
    await triggerNotification(userId, {
        type:    'new_loan',
        title:   '💸 New Loan Created',
        message: `₹${_fmt(loan.amount)} to ${loan.borrowerName} via ${loan.investorName}. Due: ${loan.dueDate}. Profit: ₹${_fmt(loan.commissionAmount)}`,
        loanId:  loanId,
    });
}

export async function notifyLoanCompleted(userId, loan) {
    await triggerNotification(userId, {
        type:    'loan_completed',
        title:   '✅ Loan Completed',
        message: `₹${_fmt(loan.amount)} from ${loan.borrowerName} marked complete. Commission earned: ₹${_fmt(loan.commissionAmount)}`,
        loanId:  loan.id,
    });
}

export async function notifyUrgentLoans(userId, urgentLoans) {
    // Only fire once per loan per day (avoid flooding)
    const today = new Date().toISOString().split('T')[0];

    for (const loan of urgentLoans) {
        const dedupeKey = `urgent_notif_${loan.id}_${today}`;
        if (sessionStorage.getItem(dedupeKey)) continue;   // already fired this session

        const isOverdue = loan.daysRemaining < 0;
        await triggerNotification(userId, {
            type:    isOverdue ? 'loan_overdue' : 'loan_due',
            title:   isOverdue ? '🚨 Loan Overdue!' : '⚠️ Loan Due Soon',
            message: isOverdue
                ? `${loan.borrowerName} is ${Math.abs(loan.daysRemaining)} days overdue. Total due: ₹${_fmt(loan.totalPayable)}`
                : `${loan.borrowerName}'s loan due in ${loan.daysRemaining} day${loan.daysRemaining === 1 ? '' : 's'}. Total: ₹${_fmt(loan.totalPayable)}`,
            loanId: loan.id,
        });

        sessionStorage.setItem(dedupeKey, '1');
    }
}

// Format a number with Indian commas (no import needed)
function _fmt(n) {
    return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
