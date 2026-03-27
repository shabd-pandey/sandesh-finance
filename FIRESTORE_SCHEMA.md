# Sandesh Finance — Firestore Schema Reference

## Collection Tree

```
users/
└── {userId}/                           ← Firebase Auth UID
    ├── investors/
    │   └── {investorId}/               ← auto-ID
    │       ├── name:         string
    │       ├── phone:        string
    │       ├── capital:      number    ← total available (₹)
    │       ├── invested:     number    ← currently deployed (₹)
    │       ├── activeLoans:  number    ← running count
    │       └── createdAt:   timestamp
    │
    ├── borrowers/
    │   └── {borrowerId}/               ← auto-ID
    │       ├── name:         string
    │       ├── phone:        string
    │       ├── address:      string    ← optional
    │       ├── borrowed:     number    ← total currently borrowed (₹)
    │       ├── activeLoans:  number
    │       └── createdAt:   timestamp
    │
    ├── loans/
    │   └── {loanId}/                   ← auto-ID
    │       ├── investorId:       string     ← FK → investors/{id}
    │       ├── borrowerId:       string     ← FK → borrowers/{id}
    │       ├── investorName:     string     ← denormalised for display
    │       ├── borrowerName:     string     ← denormalised for display
    │       ├── amount:           number
    │       ├── borrowerRate:     number     ← % borrower pays
    │       ├── investorRate:     number     ← % investor earns
    │       ├── frequency:        string     ← daily|weekly|15days|monthly|yearly
    │       ├── duration:         number
    │       ├── durationUnit:     string     ← days|weeks|months|years
    │       ├── durationInMonths: number
    │       ├── startDate:        string     ← "YYYY-MM-DD"
    │       ├── dueDate:          string     ← "YYYY-MM-DD"
    │       ├── totalInterest:    number
    │       ├── investorShare:    number
    │       ├── commissionAmount: number     ← spread = borrowerRate − investorRate
    │       ├── totalPayable:     number     ← amount + totalInterest
    │       ├── status:           string     ← active|completed|defaulted
    │       ├── completedDate:    string?    ← set on completion
    │       ├── delays:           array      ← see delay entry shape below
    │       └── createdAt:       timestamp
    │
    ├── notifications/
    │   └── {notifId}/                  ← auto-ID
    │       ├── type:      string       ← new_loan|loan_due|loan_overdue|loan_completed
    │       ├── title:     string
    │       ├── message:   string
    │       ├── loanId:    string?      ← FK → loans/{id}
    │       ├── isRead:    boolean
    │       └── createdAt: timestamp
    │
    └── meta/
        └── appMeta/                    ← single fixed document
            ├── totalCommissionEarned: number
            ├── dismissedAlerts:       map    ← { "loanId_YYYY-MM-DD": true }
            └── updatedAt:            timestamp
```

## Delay Entry Shape (embedded in loans[].delays array)

```
{
  id:               string,     ← generateId()
  previousDueDate:  "YYYY-MM-DD",
  newDueDate:       "YYYY-MM-DD",
  penaltyAmount:    number,
  penaltyFrequency: string,     ← none|daily|weekly|monthly
  reason:           string,
  addedDate:        "YYYY-MM-DD"
}
```

## Function → Collection Map

| Function                  | Collection(s) touched                         |
|---------------------------|-----------------------------------------------|
| addInvestor               | investors                                     |
| getInvestors              | investors (read)                              |
| updateInvestor            | investors                                     |
| deleteInvestor            | investors                                     |
| addBorrower               | borrowers                                     |
| getBorrowers              | borrowers (read)                              |
| updateBorrower            | borrowers                                     |
| deleteBorrower            | borrowers                                     |
| addLoan                   | loans + investors + borrowers (batch)         |
| getLoans                  | loans (read)                                  |
| updateLoanStatus          | loans + investors + borrowers + meta (batch)  |
| addLoanDelay              | loans                                         |
| deleteLoan                | loans + investors + borrowers (batch)         |
| addNotification           | notifications                                 |
| getNotifications          | notifications (read)                          |
| markNotificationRead      | notifications                                 |
| markAllNotificationsRead  | notifications (batch)                         |
| deleteNotification        | notifications                                 |
| getAppMeta                | meta (read)                                   |
| updateAppMeta             | meta                                          |
| loadAllData               | investors + borrowers + loans + meta (read)   |
