# Notification System Design

## Stage 1

### REST API Design for Campus Notification Platform

#### Core Endpoints

**GET /api/notifications**
Fetch all notifications for logged-in user sorted by priority.

Headers:

````
Authorization: Bearer < eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlv...>

Response:
```json
{
  "total": 100,
  "unreadCount": 5,
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "CSX Corporation hiring",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:30Z"
    }
  ]
}
````

**GET /api/notifications/:id**
Get single notification by ID.

Response:

```json
{
  "notification": {
    "id": "uuid",
    "type": "Placement",
    "message": "CSX Corporation hiring",
    "isRead": false,
    "createdAt": "2026-04-22T17:51:30Z"
  }
}
```

**PATCH /api/notifications/:id/read**
Mark single notification as read.

Response:

```json
{ "success": true }
```

**PATCH /api/notifications/read-all**
Mark all notifications as read.

Response:

```json
{ "success": true, "updatedCount": 5 }
```

**DELETE /api/notifications/:id**
Delete a notification.

Response:

```json
{ "success": true }
```

**GET /api/notifications/priority?top=10**
Get top N priority notifications.

Response:

```json
{
  "top": 10,
  "total": 100,
  "notifications": []
}
```

**GET /api/notifications/type/:type**
Filter notifications by type - Placement, Result or Event.

Response:

```json
{
  "type": "Placement",
  "total": 20,
  "notifications": []
}
```

#### Real-Time Mechanism

Use WebSockets via Socket.io for real-time push notifications.

- Server emits notification:new event when a new notification is created
- Client subscribes after login using JWT authenticated socket connection
- Fallback to SSE (Server-Sent Events) for clients that do not support WebSocket

---

## Stage 2

### Database Choice: PostgreSQL

#### Why PostgreSQL

- Structured data with clear relationships between students and notifications
- Strong ACID guarantees ensure no notification is ever lost
- Excellent indexing capabilities for our query patterns
- Native UUID support
- Supports table partitioning for very large scale data

#### Schema

```sql
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  rollNo VARCHAR(50) UNIQUE NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studentId UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('Placement', 'Result', 'Event')),
  message TEXT NOT NULL,
  isRead BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_student
  ON notifications(studentId);

CREATE INDEX idx_notifications_student_read
  ON notifications(studentId, isRead);

CREATE INDEX idx_notifications_created
  ON notifications(createdAt DESC);

CREATE INDEX idx_notifications_type
  ON notifications(type);

CREATE INDEX idx_notifications_student_read_time
  ON notifications(studentId, isRead, createdAt DESC);
```

#### Key Queries

Fetch unread notifications for a student:

```sql
SELECT id, type, message, isRead, createdAt
FROM notifications
WHERE studentId = $1 AND isRead = false
ORDER BY createdAt DESC;
```

Fetch placement notifications in last 7 days:

```sql
SELECT id, type, message, createdAt
FROM notifications
WHERE type = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days'
ORDER BY createdAt DESC;
```

Mark all as read:

```sql
UPDATE notifications
SET isRead = true
WHERE studentId = $1 AND isRead = false;
```

Batch insert notifications:

```sql
INSERT INTO notifications (studentId, type, message)
SELECT unnest($1::uuid[]), $2, $3;
```

#### Scalability Problems and Solutions

As data volume increases the following problems arise and can be solved as follows.

Problem 1 - Table grows to billions of rows.
Solution - Partition table by month using RANGE partitioning on createdAt column.

Problem 2 - Slow reads on large unindexed tables.
Solution - Add composite indexes on studentId, isRead and createdAt columns.

Problem 3 - Write bottleneck when sending mass notifications.
Solution - Use async message queue via BullMQ or RabbitMQ for DB inserts.

Problem 4 - Single database gets overloaded with read requests.
Solution - Add read replicas for SELECT queries, keep primary DB for writes only.

Problem 5 - Storage costs increase over time.
Solution - Archive notifications older than 6 months to cold storage.

---

## Stage 3

### Query Analysis

Original slow query:

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

Is it accurate? Yes it is functionally correct.

Why is it slow? With 50000 students and 5000000 notifications there is no
index on the combination of studentId and isRead columns. This causes a
full table scan of millions of rows every time the query runs.
The computation cost is O(N) where N equals 5000000 rows.

Fix by adding a composite index:

```sql
CREATE INDEX idx_notif_student_read_time
ON notifications(studentId, isRead, createdAt DESC);
```

Optimized query:

```sql
SELECT id, type, message, createdAt
FROM notifications
WHERE studentId = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

Avoid SELECT star and fetch only needed columns to reduce disk I/O.

### Why indexing every column is bad advice

Adding indexes on every column is not effective because it slows down
INSERT, UPDATE and DELETE operations significantly. It also wastes disk
space and most of the indexes are never used by the query planner.
Only index columns that are used in WHERE, ORDER BY and JOIN clauses.

### Query for placement notifications in last 7 days

```sql
SELECT id, type, message, createdAt
FROM notifications
WHERE type = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days'
ORDER BY createdAt DESC;
```

---

## Stage 4

### Problem

Fetching all notifications from the database on every single page load
for every student causes millions of database hits and overwhelms the
database leading to bad user experience.

### Solutions

#### Option 1 - Redis Cache (Recommended)

Cache the notifications list per student in Redis with a TTL of 60 seconds.
When a new notification arrives, invalidate that student's cache key.
This gives a 99 percent reduction in database load.
Tradeoff is a maximum of 60 seconds of data staleness.

#### Option 2 - Cursor Based Pagination

Never load all notifications at once.
Use cursor based pagination like GET /notifications?cursor=lastId&limit=20.
This dramatically reduces the payload size and database work per request.
Tradeoff is that you cannot jump to arbitrary pages.

#### Option 3 - WebSocket Push

Push new notifications to the client in real time via WebSocket.
Client maintains local state so there is no database hit on page navigation.
This is the best long term solution.
Tradeoff is more complex infrastructure to maintain.

#### Option 4 - HTTP Caching

Add Cache-Control max-age=30 header on the notifications list endpoint.
Simple to implement but hard to invalidate on a per user basis.

#### Recommended Combination

Use Redis cache combined with cursor pagination and WebSocket for new arrivals.
This handles both read performance and real time delivery efficiently.

---

## Stage 5

### Shortcomings of notify_all

```
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)
```

Problem 1 - Sequential loop over 50000 students is extremely slow.
If each student takes 100ms the total time would be 83 minutes.

Problem 2 - No error handling at all. If send_email fails at student 200
then the remaining 49800 students are silently skipped with no retry.

Problem 3 - Tight coupling means email, database and push are all
synchronous and blocking each other in a single function.

Problem 4 - No retry mechanism so failed emails are permanently lost.

Problem 5 - 50000 individual INSERT statements are used instead of
one single efficient batch insert.

Problem 6 - If the database is slow then email sending is also blocked
because they are coupled together.

### Redesigned Solution

```javascript
async function notify_all(student_ids, message) {
  await db.bulk_insert(
    student_ids.map((id) => ({
      studentId: id,
      message: message,
      type: "Placement",
      isRead: false,
      createdAt: new Date(),
    })),
  );
  await websocket.broadcast(student_ids, message);

  await messageQueue.enqueue_bulk(
    "email_notifications",
    student_ids.map((id) => ({ studentId: id, message: message })),
  );
}
async function email_worker() {
  while (true) {
    const batch = await messageQueue.dequeue("email_notifications", 100);
    const results = await Promise.allSettled(
      batch.map((job) => send_email(job.studentId, job.message)),
    );
    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);
    if (failed.length > 0) {
      await messageQueue.requeue(failed, { delay: 30000, maxRetries: 3 });
    }
  }
}
```

Key improvements made:

- Database save happens first so the source of truth is always safe
- Emails go through a message queue using BullMQ or RabbitMQ
- Promise.allSettled processes 100 emails concurrently instead of one by one
- Failed emails are retried automatically with exponential backoff
- Database and email sending are fully decoupled from each other

---

## Stage 6

### Priority Inbox Design

#### Priority Formula

```
priority_score = type_weight + recency_score

type_weight values:
  Placement = 30
  Result    = 20
  Event     = 10

recency_score = max(0, 10 - hours_since_notification)
```

Placement always ranks above Result which always ranks above Event.
Within the same type newer notifications rank higher than older ones.

#### Maintaining Top 10 Efficiently

Use a Redis Sorted Set with priority_score as the score value.
When a new notification arrives use ZADD notifications:userId score notificationId.
Use ZREVRANGE notifications:userId 0 9 to get top 10 results in O(log N) time.
New high priority notifications automatically push out lower priority ones.
There is no need to re-sort the entire list on each new insert.

#### Implementation

The full working code is available in notification_app_be/index.js.
The app fetches notifications from the provided API, scores each one
using the priority formula above, sorts them in memory and returns top N.

Endpoints implemented:

- GET /notifications returns all notifications sorted by priority score
- GET /notifications/priority?top=10 returns top N priority inbox
- GET /notifications/type/:type filters by Placement, Result or Event
- GET /notifications/:id returns a single notification by ID
