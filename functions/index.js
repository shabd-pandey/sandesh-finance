// ================================================================
// functions/index.js — Sandesh Finance · Cloud Functions v2
//
// FUNCTIONS EXPORTED
//   scheduleDailyLoanAlerts   — runs every day at 08:00 IST
//                               loops all users → all active loans
//                               creates loan_due / loan_overdue
//                               notifications in Firestore, with
//                               server-side dedup so no duplicate
//                               notifications are ever stored.
//
//   onLoanStatusChange        — Firestore trigger: fires when a loan
//                               document's `status` field changes.
//                               Creates loan_completed notification
//                               automatically, without any client call.
//
// DEPLOY
//   firebase deploy --only functions
//
// EMULATE LOCALLY
//   firebase emulators:start --only functions,firestore
//   # Then call the scheduler via the Emulator UI or:
//   firebase functions:shell
//   > scheduleDailyLoanAlerts()
// ================================================================

const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions }  = require('firebase-functions/v2');
const { logger }            = require('firebase-functions');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

// ── Init ──────────────────────────────────────────────────────────
initializeApp();
const db = getFirestore();

// All functions run in Mumbai (asia-south1) — closest to India
setGlobalOptions({ region: 'asia-south1' });


// ================================================================
// CONSTANTS
// ================================================================

const DUE_SOON_DAYS   = 5;    // fire "due soon" alert when ≤ 5 days remain
const OVERDUE_WINDOW  = 30;   // stop firing overdue alerts after 30 days past due

// Notification types — must match notifications.js on the frontend
const TYPE = {
    DUE:       'loan_due',
    OVERDUE:   'loan_overdue',
    COMPLETED: 'loan_completed',
};


// ================================================================
// HELPER: Calculate due date from a loan document
// Mirrors calculateDueDateFromLoan() in script.js exactly so
// results are always consistent between client and server.
// ================================================================
function calcDueDate(loan) {
    // If a dueDate string was explicitly stored (after a delay), use it directly.
    if (loan.dueDate && typeof loan.dueDate === 'string') {
        return new Date(loan.dueDate);
    }

    const start = new Date(loan.startDate);

    switch (loan.durationUnit) {
        case 'days':
            start.setDate(start.getDate() + Number(loan.duration));
            break;
        case '15days':
            start.setDate(start.getDate() + Number(loan.duration) * 15);
            break;
        case 'weeks':
            start.setDate(start.getDate() + Number(loan.duration) * 7);
            break;
        case 'years':
            start.setFullYear(start.getFullYear() + Number(loan.duration));
            break;
        default:
            // months (or fallback)
            start.setMonth(start.getMonth() + Math.round(Number(loan.durationInMonths || loan.duration)));
    }

    return start;
}

// ── Days remaining (negative = overdue) ──────────────────────────
function daysRemaining(dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due - today) / 86_400_000);
}

// ── ISO date string for today (YYYY-MM-DD) ───────────────────────
function todayISO() {
    return new Date().toISOString().split('T')[0];
}

// ── Indian Rupee formatter (no Intl needed on Node) ──────────────
function fmtRupee(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── Plural helper ────────────────────────────────────────────────
function plural(n, word) {
    return `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
}


// ================================================================
// DEDUP LOGIC
//
// Before writing a notification, we query the user's notifications
// sub-collection for an existing document with the same:
//   • loanId
//   • type
//   • dedupeDate  (today's YYYY-MM-DD)
//
// If one exists, we skip. This guarantees exactly one notification
// per loan per type per calendar day, even if the function is
// re-triggered or retried by Cloud Scheduler.
// ================================================================
async function alreadyNotified(userId, loanId, type) {
    const today = todayISO();

    const snap = await db
        .collection('users').doc(userId)
        .collection('notifications')
        .where('loanId',     '==', loanId)
        .where('type',       '==', type)
        .where('dedupeDate', '==', today)
        .limit(1)
        .get();

    return !snap.empty;
}


// ================================================================
// WRITE NOTIFICATION
// Matches the shape expected by the frontend (notifications.js)
// ================================================================
async function writeNotification(userId, payload) {
    await db
        .collection('users').doc(userId)
        .collection('notifications')
        .add({
            loanId:     payload.loanId,
            type:       payload.type,
            title:      payload.title,
            message:    payload.message,
            isRead:     false,
            dedupeDate: todayISO(),     // used for server-side dedup query above
            createdAt:  FieldValue.serverTimestamp(),
        });
}


// ================================================================
// PROCESS ONE LOAN
// Decides whether a notification is needed and writes it.
// Returns: 'due' | 'overdue' | 'skipped'
// ================================================================
async function processLoan(userId, loanId, loan) {
    const dueDate = calcDueDate(loan);
    const days    = daysRemaining(dueDate);

    // ── Case 1: Loan due within DUE_SOON_DAYS (not yet overdue) ──
    if (days >= 0 && days <= DUE_SOON_DAYS) {
        const type = TYPE.DUE;
        if (await alreadyNotified(userId, loanId, type)) return 'skipped';

        const dayLabel = days === 0 ? 'TODAY' : plural(days, 'day');
        await writeNotification(userId, {
            loanId,
            type,
            title:   '⚠️ Loan Due Soon',
            message: `${loan.borrowerName}'s loan of ${fmtRupee(loan.amount)} is due in ${dayLabel}. `
                   + `Total repayment: ${fmtRupee(loan.totalPayable)}. `
                   + `Investor: ${loan.investorName}.`,
        });
        return 'due';
    }

    // ── Case 2: Loan is overdue (within OVERDUE_WINDOW days) ─────
    if (days < 0 && Math.abs(days) <= OVERDUE_WINDOW) {
        const type = TYPE.OVERDUE;
        if (await alreadyNotified(userId, loanId, type)) return 'skipped';

        await writeNotification(userId, {
            loanId,
            type,
            title:   '🚨 Loan Overdue!',
            message: `${loan.borrowerName}'s loan of ${fmtRupee(loan.amount)} is `
                   + `${plural(Math.abs(days), 'day')} overdue. `
                   + `Total due: ${fmtRupee(loan.totalPayable)}. `
                   + `Please follow up immediately. Investor: ${loan.investorName}.`,
        });
        return 'overdue';
    }

    // No action needed (too far away or past the overdue window)
    return 'skipped';
}


// ================================================================
// PROCESS ONE USER
// Fetches all active loans and runs processLoan() on each.
// ================================================================
async function processUser(userId) {
    const loansSnap = await db
        .collection('users').doc(userId)
        .collection('loans')
        .where('status', '==', 'active')
        .get();

    if (loansSnap.empty) {
        logger.info(`  [${userId.slice(0, 8)}…] No active loans — skipping`);
        return { due: 0, overdue: 0, skipped: 0 };
    }

    const counts = { due: 0, overdue: 0, skipped: 0 };

    // Process loans in parallel (up to 10 concurrent) to stay within
    // Firestore read quotas and function timeout limits
    const BATCH_SIZE = 10;
    const loans      = loansSnap.docs;

    for (let i = 0; i < loans.length; i += BATCH_SIZE) {
        const batch   = loans.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
            batch.map(doc => processLoan(userId, doc.id, doc.data()))
        );
        results.forEach(r => counts[r]++);
    }

    logger.info(
        `  [${userId.slice(0, 8)}…] ${loans.size} loans → `
        + `${counts.due} due, ${counts.overdue} overdue, ${counts.skipped} skipped`
    );

    return counts;
}


// ================================================================
// SCHEDULED FUNCTION: scheduleDailyLoanAlerts
//
// Runs every day at 08:00 IST (02:30 UTC).
// Schedule uses standard cron syntax.
//
// Execution flow:
//   1. Enumerate all user IDs from the top-level `users` collection
//   2. For each user, fetch their active loans
//   3. For each active loan, check days remaining
//   4. Write loan_due / loan_overdue notification if needed
//   5. Dedup: skip if a notification with same loanId+type already
//      exists for today
// ================================================================
exports.scheduleDailyLoanAlerts = onSchedule(
    {
        schedule:        '30 2 * * *',    // 08:00 IST = 02:30 UTC
        timeZone:        'Asia/Kolkata',
        retryCount:      3,
        maxRetrySeconds: 300,             // give up after 5 min on retries
        memory:          '256MiB',
        timeoutSeconds:  540,             // 9 min (max for v2 scheduled)
    },
    async (event) => {
        logger.info('=== scheduleDailyLoanAlerts starting ===', {
            scheduledTime: event.scheduleTime,
            today:         todayISO(),
        });

        // ── Step 1: Get all user IDs ────────────────────────────
        // We page through users in batches of 100 to handle large
        // deployments without hitting memory limits.
        const totals       = { users: 0, due: 0, overdue: 0, skipped: 0 };
        let   lastDoc      = null;
        let   moreUsers    = true;

        while (moreUsers) {
            let query = db.collection('users').limit(100);
            if (lastDoc) query = query.startAfter(lastDoc);

            const usersSnap = await query.get();
            if (usersSnap.empty) break;

            logger.info(`Processing batch of ${usersSnap.size} users…`);

            // ── Step 2: Process each user sequentially to respect
            //           Firestore write rate limits (~500 writes/sec)
            for (const userDoc of usersSnap.docs) {
                try {
                    const counts = await processUser(userDoc.id);
                    totals.users++;
                    totals.due     += counts.due;
                    totals.overdue += counts.overdue;
                    totals.skipped += counts.skipped;
                } catch (err) {
                    // Log error for this user but don't abort other users
                    logger.error(`Error processing user ${userDoc.id}:`, err);
                }
            }

            lastDoc   = usersSnap.docs[usersSnap.docs.length - 1];
            moreUsers = usersSnap.size === 100;   // if < 100 returned, no more pages
        }

        logger.info('=== scheduleDailyLoanAlerts complete ===', totals);
    }
);


// ================================================================
// FIRESTORE TRIGGER: onLoanStatusChange
//
// Fires whenever any loan document is updated.
// If the `status` field changed to 'completed', writes a
// loan_completed notification automatically — so the client
// doesn't need to call triggerNotification() for completions
// (though the client-side call in script.js also works as a
// redundancy; the dedup query prevents double notifications).
// ================================================================
exports.onLoanStatusChange = onDocumentUpdated(
    {
        document:  'users/{userId}/loans/{loanId}',
        region:    'asia-south1',
        memory:    '128MiB',
    },
    async (event) => {
        const before = event.data.before.data();
        const after  = event.data.after.data();
        const { userId, loanId } = event.params;

        // Only act when status transitions to 'completed'
        if (before.status === after.status)            return null;
        if (after.status  !== 'completed')             return null;

        // Dedup: skip if a completed notification was already written today
        if (await alreadyNotified(userId, loanId, TYPE.COMPLETED)) {
            logger.info(`onLoanStatusChange: dedup skip for loan ${loanId}`);
            return null;
        }

        const loan = after;
        await writeNotification(userId, {
            loanId,
            type:    TYPE.COMPLETED,
            title:   '✅ Loan Completed',
            message: `Loan of ${fmtRupee(loan.amount)} to ${loan.borrowerName} `
                   + `(via ${loan.investorName}) marked as completed. `
                   + `Commission earned: ${fmtRupee(loan.commissionAmount)}.`,
        });

        logger.info(`onLoanStatusChange: wrote loan_completed for loan ${loanId}`);
        return null;
    }
);


// ================================================================
// HTTP TRIGGER: manualRunLoanAlerts  (admin-only, protected)
//
// For testing or manually forcing a run without waiting for the
// daily schedule. Call from Firebase console or curl with:
//
//   curl -X POST \
//     -H "Authorization: Bearer $(firebase login:ci)" \
//     https://asia-south1-YOUR_PROJECT.cloudfunctions.net/manualRunLoanAlerts
//
// REMOVE this export before going to production,
// or add proper Firebase App Check / Admin auth verification.
// ================================================================
const { onRequest } = require('firebase-functions/v2/https');

exports.manualRunLoanAlerts = onRequest(
    {
        region:  'asia-south1',
        memory:  '256MiB',
        invoker: 'private',    // only callable by project admins
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed — use POST');
            return;
        }

        logger.info('manualRunLoanAlerts triggered via HTTP');

        const totals = { users: 0, due: 0, overdue: 0, skipped: 0 };
        const usersSnap = await db.collection('users').get();

        for (const userDoc of usersSnap.docs) {
            try {
                const counts = await processUser(userDoc.id);
                totals.users++;
                totals.due     += counts.due;
                totals.overdue += counts.overdue;
                totals.skipped += counts.skipped;
            } catch (err) {
                logger.error(`manualRun: error for user ${userDoc.id}:`, err);
            }
        }

        logger.info('manualRunLoanAlerts complete', totals);
        res.status(200).json({ success: true, date: todayISO(), ...totals });
    }
);
