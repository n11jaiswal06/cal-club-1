# Onboarding System Documentation

## Overview
The onboarding system allows users to answer a series of questions during their initial app setup. This system includes question management, user answer storage, and soft deletion capabilities.

## Database Schemas

### questions Collection
Stores the onboarding questions that users can answer.

```javascript
{
  _id: ObjectId,
  text: String,           // The question text
  subtext: String,        // Optional explanatory text or instructions
  type: String,           // Type of input (text, number, select, multiselect, radio, checkbox, textarea, date, email, phone)
  options: [String],      // Available options for select/radio/multiselect inputs
  sequence: Number,       // Order of questions (enforced uniqueness)
  isActive: Boolean,      // Whether the question is currently active
  createdAt: Date,
  updatedAt: Date
}
```

### userQuestions Collection
Stores user answers to onboarding questions.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,       // Reference to User
  questionId: ObjectId,   // Reference to Question
  values: [Mixed],        // Array of user's answers (can be strings, numbers, etc.)
  deletedAt: Date,        // Soft deletion timestamp (null if active)
  createdAt: Date,
  updatedAt: Date
}
```

## API Endpoints

### 1. Get Active Questions
**GET** `/onboarding/questions`

Returns all active questions ordered by sequence.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "question_id",
      "text": "What's your primary fitness goal?",
      "subtext": "This helps us personalize your nutrition recommendations",
      "type": "radio",
      "options": ["Weight Loss", "Weight Gain", "Muscle Building"],
      "sequence": 1
    }
  ],
  "count": 15
}
```

### 2. Save User Answers
**POST** `/onboarding/answers`

Saves user answers to onboarding questions. Requires authentication.

**Note:** The userId is automatically extracted from the JWT token, no need to include it in the request body.

**Request Body:**
```json
{
  "answers": [
    {
      "questionId": "question_id",
      "values": ["Weight Loss"]
    },
    {
      "questionId": "question_id_2",
      "values": [75]
    },
    {
      "questionId": "question_id_3", 
      "values": ["Lack of time", "Don't know what to eat"]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully processed 2 answers",
  "data": [
    {
      "action": "created",
      "answer": { /* UserQuestion object */ }
    },
    {
      "action": "updated", 
      "answer": { /* UserQuestion object */ }
    }
  ]
}
```

### 3. Get User Answers
**GET** `/onboarding/answers`

Retrieves all answers for the authenticated user. Requires authentication.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "answer_id",
      "questionId": {
        "_id": "question_id",
        "text": "What's your primary fitness goal?",
        "subtext": "This helps us personalize your nutrition recommendations",
        "type": "radio",
        "options": ["Weight Loss", "Weight Gain"],
        "sequence": 1
      },
      "values": ["Weight Loss"],
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 15
}
```

## Input Types

The system supports various input types for different question formats:

- **text**: Single line text input
- **number**: Numeric input
- **select**: Dropdown selection (single choice)
- **multiselect**: Multiple choice selection
- **radio**: Radio button selection (single choice)
- **checkbox**: Checkbox selection (multiple choices)
- **textarea**: Multi-line text input
- **date**: Date picker
- **email**: Email input with validation
- **phone**: Phone number input

## Soft Deletion

The system implements soft deletion for data integrity:

### User Deletion
When a user is deleted:
1. User account is deactivated (`isActive: false`)
2. All user answers are soft deleted (`deletedAt` set to current timestamp)
3. All user meals are soft deleted (`deletedAt` set to current timestamp)

### Meal Deletion
- Individual meals can be soft deleted
- All meal queries automatically filter out deleted meals
- `deletedAt` field is added to Meal schema

## Usage Examples

### Frontend Integration

```javascript
// Fetch onboarding questions
const response = await fetch('/onboarding/questions');
const { data: questions } = await response.json();

// Render questions in order
questions.forEach(question => {
  renderQuestion(question);
});

// Submit answers
const answers = [
  { userId: currentUserId, questionId: 'q1', value: 'Weight Loss' },
  { userId: currentUserId, questionId: 'q2', value: 75 }
];

const submitResponse = await fetch('/onboarding/answers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ answers })
});
```

### Populating Sample Questions

Run the sample questions script to populate the database:

```bash
node sample_questions.js
```

This will insert 15 sample onboarding questions covering fitness goals, personal information, dietary preferences, and tracking preferences.

## Database Indexes

### questions Collection
- `{ sequence: 1 }` - For ordering questions
- `{ isActive: 1, sequence: 1 }` - For fetching active questions in order

### userQuestions Collection  
- `{ userId: 1, questionId: 1 }` - For finding user's answer to specific question
- `{ userId: 1, deletedAt: 1 }` - For fetching user's active answers
- `{ questionId: 1, deletedAt: 1 }` - For question analytics
- `{ userId: 1, questionId: 1, deletedAt: 1 }` - Unique constraint for active answers

### Meals Collection
- `{ userId: 1, capturedAt: -1 }` - For user's meal history
- `{ userId: 1, deletedAt: 1 }` - For soft deletion queries

## Error Handling

All endpoints include comprehensive error handling:
- Input validation
- Database error handling
- Proper HTTP status codes
- Detailed error messages

## Security Considerations

- Authentication required for answer submission and retrieval
- Input validation and sanitization
- Soft deletion prevents data loss
- Unique constraints prevent duplicate answers

## Conditional Branching: `skipIf` Semantics

Each question may carry a `skipIf` array of rules that hide the question when a prior answer matches. The rules are **data**, evaluated server-side so every consumer (Flutter, web, agent, internal tools) shares one implementation.

### Rule shape

```javascript
skipIf: [
  {
    questionId: ObjectId,   // a previously-answered question
    valueIn:    [String],   // semantic match against option.value (preferred)
    textIn:     [String]    // legacy fallback: matches option.text
  }
]
```

### Evaluation rules

1. **OR across the array.** A question is skipped if **any** rule matches. (There is no AND, NOT, or numeric comparison — see CAL-32 out-of-scope notes.)
2. **`valueIn` precedence.** Within a single rule, when `valueIn` is non-empty it is the only matcher consulted. `textIn` is ignored on that rule. Rules authored before semantic option values existed used `textIn` only; those continue to work.
3. **`textIn` resolution (legacy fallback).** When a rule has only `textIn`, each prior `value` is mapped to its `option.text` via the referenced question's `options`. The mapped text is then tested against `textIn`. If no option carries the prior value (truly legacy data where the stored value is itself display text), the raw value is tested against `textIn` directly.
4. **Missing prior answer.** If the user has not yet answered the rule's `questionId` (or submitted an empty `values` array), no rule on it can match → the question stays applicable.

### Examples (from current seeds)

| Question | Rule | Effect |
| --- | --- | --- |
| Target weight (Q11) | `valueIn: ['maintain', 'recomp']` against goal | Hidden for maintain & recomp users |
| Loss-rate (13.3) | `valueIn: ['gain', 'recomp', 'maintain']` against goal | Shown only for `lose` |
| Gain-rate (13.5) | `valueIn: ['lose', 'recomp', 'maintain']` against goal | Shown only for `gain` |
| Recomp expectation (13.7) | `valueIn: ['lose', 'gain', 'maintain']` against goal | Shown only for `recomp` |
| Health priming / Data import | `valueIn: ['static']` against the dynamic-vs-static choice | Hidden when the user picks the static plan |

## Applicability Endpoint (CAL-32)

A stateless evaluator that returns the active question list annotated with `applicable` per question, computed against the answers the client is currently carrying. Use this in place of re-implementing `skipIf` on the client.

**POST** `/onboarding/questions/applicability` — **public** (no auth). Onboarding runs before sign-up, so the server cannot read stored answers; the client carries them in the request body.

**Request body:**
```json
{
  "type": "PLAN_CREATION",
  "answers": [
    { "questionId": "6908fe66896ccf24778c907d", "values": ["maintain"] }
  ]
}
```
- `type` (optional) — one of `PLAN_CREATION`, `NOTIFICATIONS`, or omit to receive every active question.
- `answers` (required) — the in-progress answer draft. Each entry has a string `questionId` (valid ObjectId hex) and an array `values`.

**Response:**
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "_id": "...",
      "slug": "goal_type",
      "text": "What's your primary goal?",
      "skipIf": [],
      "applicable": true
    },
    {
      "_id": "...",
      "slug": "target_weight",
      "text": "What's your target weight?",
      "skipIf": [{ "questionId": "...", "valueIn": ["maintain", "recomp"] }],
      "applicable": false
    }
  ]
}
```
The fields per question are exactly what `GET /onboarding/questions` returns, plus `applicable: boolean`.

**Errors:** `400` for non-array `answers`, missing/invalid `questionId`, non-array `values`, or unknown `type`. `500` for unexpected failures.

**When to call.** Client should call the endpoint whenever the in-progress answer set changes (i.e. after each answered question), then advance to the next question with `applicable: true` in `sequence` order. The endpoint is idempotent and side-effect-free, so it is safe to call as often as the UI demands.

**Offline.** Clients may keep a thin local fallback evaluator for offline scenarios; the documented semantics above are the contract.
