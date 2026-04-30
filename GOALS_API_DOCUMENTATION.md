# Goals API Documentation

## Overview
The Goals API provides endpoints to calculate personalized calorie and macro targets based on user inputs, using scientifically-backed formulas.

## Endpoints

### 1. Calculate Goals (v1 - Legacy)
**POST** `/goals/calculate`

Calculate goals using the v1 algorithm.

### 2. Calculate Goals (v2 - Unified Energy Model)
**POST** `/goals/calculate/v2`

Calculate goals using the improved v2 algorithm with separate NEAT and EAT calculations.

### 3. Calculate and Save Goals ⭐ NEW
**POST** `/goals/calculate-and-save`

Calculate goals using v2 algorithm and automatically save to user profile.

---

## `/goals/calculate-and-save` - Detailed Documentation

### Authentication
**Required**: Yes (JWT Bearer Token)

```bash
Authorization: Bearer <your_jwt_token>
```

### Request Body

```json
{
  "sex_at_birth": "male",              // Required: "male" or "female"
  "age_years": 29,                     // Required: 13-80
  "height_cm": 173,                    // Required: 120-220
  "weight_kg": 82,                     // Required: 35-250
  "goal_type": "lose",                 // Required: "lose", "maintain", or "gain"
  "pace_kg_per_week": -0.5,           // Required: -1.0 to 0.5 (negative for loss, positive for gain)
  "desired_weight_kg": 75,            // Optional: Target weight
  "activity_level": "active",          // Optional: "sedentary", "light", "active", "very_active", "dynamic"
  "workouts_per_week": 5,             // Optional: 0-14
  "avg_workout_duration_min": 45,     // Optional: Workout duration in minutes
  "avg_workout_intensity": "moderate", // Optional: "low", "moderate", "high"
  "apple_active_kcal_day": 612        // Optional: Apple Health active calories
}
```

### Field Details

| Field | Type | Required | Values/Range | Description |
|-------|------|----------|--------------|-------------|
| `sex_at_birth` | string | ✅ | `"male"`, `"female"` | Biological sex for RMR calculation |
| `age_years` | number | ✅ | 13-80 | User's age in years |
| `height_cm` | number | ✅ | 120-220 | Height in centimeters |
| `weight_kg` | number | ✅ | 35-250 | Current weight in kilograms |
| `goal_type` | string | ✅ | `"lose"`, `"maintain"`, `"gain"` | Primary fitness goal |
| `pace_kg_per_week` | number | ✅ | -1.0 to 0.5 | Weekly weight change rate (negative = loss) |
| `desired_weight_kg` | number | ❌ | 30-250 | Target weight for goal calculation |
| `activity_level` | string | ❌ | `"sedentary"`, `"light"`, `"active"`, `"very_active"`, `"dynamic"` | Daily activity level (default: `"active"`) |
| `workouts_per_week` | number | ❌ | 0-14 | Number of structured workouts per week |
| `avg_workout_duration_min` | number | ❌ | Any positive number | Average workout duration (default: 45) |
| `avg_workout_intensity` | string | ❌ | `"low"`, `"moderate"`, `"high"` | Workout intensity level (default: `"moderate"`) |
| `apple_active_kcal_day` | number | ❌ | 0+ | Active calories from Apple Health (overrides activity calculations) |

### Activity Level Guide

| Level | Description | Steps Range | NEAT Multiplier |
|-------|-------------|-------------|-----------------|
| `sedentary` | Desk job, minimal movement | <3k steps/day | +10% of RMR |
| `light` | Light daily activity | 3k-7k steps/day | +20% of RMR |
| `active` | Regular daily movement | 7k-10k steps/day | +30% of RMR |
| `very_active` | High activity job/lifestyle | >10k steps/day | +40% of RMR |
| `dynamic` | Varies daily | 5k-20k+ steps/day | +30% of RMR |

### Workout Intensity Guide

| Intensity | Examples | MET Value |
|-----------|----------|-----------|
| `low` | Yoga, Pilates, Walking | 3.5 |
| `moderate` | Strength training, Cycling, Circuit training | 7.0 |
| `high` | CrossFit, HIIT, Running | 9.5 |

### Response Format

```json
{
  "success": true,
  "data": {
    "rmr": 1761,
    "neat_kcal": 528,
    "eat_kcal": 308,
    "tdee": 2597,
    "daily_kcal_delta": -550,
    "calorie_target": 2050,
    "macros": {
      "protein_g": 165,
      "fat_g": 55,
      "carb_g": 220
    },
    "version": "v2",
    "warnings": [],
    "planData": {
      "goal": "Lose 7.0 kg by March 15",
      "calories": 2050,
      "protein": 165,
      "fat": 55,
      "carbs": 220
    },
    "inputs": {
      "sex_at_birth": "male",
      "age_years": 29,
      "height_cm": 173,
      "weight_kg": 82,
      "goal_type": "lose",
      "pace_kg_per_week": -0.5,
      "activity_level": "active",
      "workouts_per_week": 5,
      "avg_workout_duration_min": 45,
      "avg_workout_intensity": "moderate"
    }
  },
  "message": "Goals calculated and saved successfully"
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `rmr` | Resting Metabolic Rate (Mifflin-St Jeor) |
| `neat_kcal` | Non-Exercise Activity Thermogenesis |
| `eat_kcal` | Exercise Activity Thermogenesis (structured workouts) |
| `tdee` | Total Daily Energy Expenditure |
| `daily_kcal_delta` | Daily calorie adjustment for goal |
| `calorie_target` | Target daily calories (rounded to nearest 25) |
| `macros.protein_g` | Daily protein target in grams |
| `macros.fat_g` | Daily fat target in grams |
| `macros.carb_g` | Daily carbohydrate target in grams |
| `planData.goal` | Human-readable goal description |
| `planData.calories` | Same as calorie_target |
| `planData.protein` | Same as macros.protein_g |
| `planData.fat` | Same as macros.fat_g |
| `planData.carbs` | Same as macros.carb_g |

---

## Sample cURL Commands

### Example 1: Lose Weight (Male)
```bash
curl -X POST http://localhost:3000/goals/calculate-and-save \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sex_at_birth": "male",
    "age_years": 29,
    "height_cm": 173,
    "weight_kg": 82,
    "goal_type": "lose",
    "pace_kg_per_week": -0.5,
    "desired_weight_kg": 75,
    "activity_level": "active",
    "workouts_per_week": 5,
    "avg_workout_duration_min": 45,
    "avg_workout_intensity": "moderate"
  }'
```

### Example 2: Gain Muscle (Female)
```bash
curl -X POST http://localhost:3000/goals/calculate-and-save \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sex_at_birth": "female",
    "age_years": 25,
    "height_cm": 165,
    "weight_kg": 58,
    "goal_type": "gain",
    "pace_kg_per_week": 0.25,
    "desired_weight_kg": 63,
    "activity_level": "very_active",
    "workouts_per_week": 6,
    "avg_workout_duration_min": 60,
    "avg_workout_intensity": "high"
  }'
```

### Example 3: Maintain Weight with Apple Health Data
```bash
curl -X POST http://localhost:3000/goals/calculate-and-save \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sex_at_birth": "male",
    "age_years": 35,
    "height_cm": 178,
    "weight_kg": 75,
    "goal_type": "maintain",
    "pace_kg_per_week": 0,
    "apple_active_kcal_day": 550,
    "workouts_per_week": 4,
    "avg_workout_duration_min": 45,
    "avg_workout_intensity": "moderate"
  }'
```

### Example 4: Sedentary Desk Job (Lose Weight)
```bash
curl -X POST http://localhost:3000/goals/calculate-and-save \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sex_at_birth": "female",
    "age_years": 32,
    "height_cm": 160,
    "weight_kg": 70,
    "goal_type": "lose",
    "pace_kg_per_week": -0.3,
    "desired_weight_kg": 62,
    "activity_level": "sedentary",
    "workouts_per_week": 2,
    "avg_workout_duration_min": 30,
    "avg_workout_intensity": "low"
  }'
```

### Example 5: Very Active Lifestyle (Maintain)
```bash
curl -X POST http://localhost:3000/goals/calculate-and-save \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "sex_at_birth": "male",
    "age_years": 27,
    "height_cm": 180,
    "weight_kg": 78,
    "goal_type": "maintain",
    "pace_kg_per_week": 0,
    "activity_level": "very_active",
    "workouts_per_week": 7,
    "avg_workout_duration_min": 60,
    "avg_workout_intensity": "high"
  }'
```

---

## Error Responses

### 400 - Bad Request (Validation Error)
```json
{
  "success": false,
  "error": "Invalid input parameters",
  "validation": {
    "valid": false,
    "errors": [
      "age_years must be between 13 and 80",
      "goal_type must be one of: lose, maintain, gain"
    ],
    "warnings": []
  }
}
```

### 401 - Unauthorized
```json
{
  "error": "No token provided"
}
```

### 404 - User Not Found
```json
{
  "success": false,
  "error": "User not found"
}
```

### 500 - Server Error
```json
{
  "success": false,
  "error": "Failed to calculate and save goals",
  "details": "Error message here"
}
```

---

## Macro Distribution by Goal Type

| Goal Type | Protein (g/kg) | Fat (% of kcal) | Carbs |
|-----------|----------------|-----------------|-------|
| `lose` (Fat Loss) | 2.0 | 25% | Remainder (~45-50%) |
| `maintain` (Lifestyle) | 1.6 | 30% | Remainder (~50-55%) |
| `gain` (Muscle Gain) | 1.8 | 25% | Remainder (~50-55%) |

### Guardrails
- **Calorie Floor (v2)**: Male ≥1400 kcal, Female ≥1200 kcal
- **Protein Minimum**: ≥1.4 g/kg body weight
- **Fat Minimum**: ≥0.6 g/kg body weight

---

## User Profile Integration

After successful calculation, the following fields are updated in the User model:

```javascript
user.goals = {
  goal: "Lose 7.0 kg by March 15",
  dailyCalories: 2050,
  dailyProtein: 165,
  dailyCarbs: 220,
  dailyFats: 55
}
```

These values can then be used throughout the app for:
- Meal tracking comparisons
- Daily progress monitoring
- Notification triggers
- Dashboard displays

---

## Testing

### Get Your JWT Token
First, authenticate to get your JWT token:

```bash
# Request OTP
curl -X POST http://localhost:3000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15715367519"}'

# Verify OTP
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15715367519", "otp": "367519"}'
```

Copy the token from the response and use it in the Authorization header.

### Verify Goals Were Saved
```bash
curl -X GET http://localhost:3000/users/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Notes

1. The `planData` object is specifically formatted for UI display on the onboarding flow
2. All calculations use the v2 unified energy model (no double-counting of steps/exercise)
3. Calories are rounded to nearest 25, macros to nearest 5g
4. The `goal` description is auto-generated based on current weight, target weight, and pace
5. If `apple_active_kcal_day` is provided, it overrides the activity level and workout calculations

---

## Support

For questions or issues:
- Check `services/goalService.js` for calculation logic
- Review `controllers/goalController.js` for API implementation
- See `models/schemas/User.js` for data structure

