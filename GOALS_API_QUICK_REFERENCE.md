# Goals API - Quick Reference Card

## 🚀 Endpoint
```
POST /goals/calculate-and-save
```

## 🔑 Authentication
```bash
Authorization: Bearer YOUR_JWT_TOKEN
```

## 📋 Minimal Request (Required Fields Only)
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
    "pace_kg_per_week": -0.5
  }'
```

## 📋 Full Request (All Fields)
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

---

## 🎯 Enum Values Reference

### sex_at_birth
```
"male" | "female"
```

### goal_type
```
"lose"      // Fat loss
"maintain"  // Weight maintenance
"gain"      // Muscle gain
"recomp"    // Recomposition (build muscle while losing fat) — pace_kg_per_week must be 0
```

### activity_level
```
"sedentary"    // <3k steps/day (Desk job)
"light"        // 3k-7k steps/day (Occasional activity)
"active"       // 7k-10k steps/day (Regular exercise)
"very_active"  // >10k steps/day (Intense activity)
"dynamic"      // 5k-20k+ steps/day (Varies daily)
```

### avg_workout_intensity
```
"low"       // Yoga, Pilates, Walking (MET: 3.5)
"moderate"  // Strength, Cycling, Circuit (MET: 7.0)
"high"      // CrossFit, HIIT, Running (MET: 9.5)
```

---

## 📊 Valid Ranges

| Field | Min | Max | Default |
|-------|-----|-----|---------|
| age_years | 13 | 80 | - |
| height_cm | 120 | 220 | - |
| weight_kg | 35 | 250 | - |
| pace_kg_per_week | -1.0 | 0.5 | - |
| workouts_per_week | 0 | 14 | 0 |
| avg_workout_duration_min | 1 | ∞ | 45 |

---

## ✅ Example Response
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
    "planData": {
      "goal": "Lose 7.0 kg by March 15",
      "calories": 2050,
      "protein": 165,
      "fat": 55,
      "carbs": 220
    }
  },
  "message": "Goals calculated and saved successfully"
}
```

---

## 🎨 Quick Copy-Paste Examples

### 1️⃣ Lose Weight (Male, Active)
```json
{
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
}
```

### 2️⃣ Gain Muscle (Female, Very Active)
```json
{
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
}
```

### 3️⃣ Maintain (Sedentary)
```json
{
  "sex_at_birth": "female",
  "age_years": 32,
  "height_cm": 160,
  "weight_kg": 65,
  "goal_type": "maintain",
  "pace_kg_per_week": 0,
  "activity_level": "sedentary",
  "workouts_per_week": 2,
  "avg_workout_duration_min": 30,
  "avg_workout_intensity": "low"
}
```

### 4️⃣ With Apple Health Data
```json
{
  "sex_at_birth": "male",
  "age_years": 35,
  "height_cm": 178,
  "weight_kg": 75,
  "goal_type": "lose",
  "pace_kg_per_week": -0.3,
  "apple_active_kcal_day": 550
}
```

---

## 🛡️ Safety Guardrails

- ✅ Male calorie floor (v2): **1400 kcal**
- ✅ Female calorie floor: **1200 kcal**
- ✅ Minimum protein: **1.4 g/kg**
- ✅ Minimum fat: **0.6 g/kg**

---

## 🔍 What Gets Saved to User Profile

```javascript
user.goals = {
  goal: "Lose 7.0 kg by March 15",  // Auto-generated
  dailyCalories: 2050,
  dailyProtein: 165,
  dailyCarbs: 220,
  dailyFats: 55
}
```

---

## 💡 Pro Tips

1. **Use `apple_active_kcal_day`** if available - it's more accurate than activity_level
2. **Set realistic pace**: -0.5 kg/week is sustainable for fat loss
3. **For muscle gain**: 0.25-0.5 kg/week is optimal
4. **Sedentary + no workouts** will have lowest TDEE
5. **Very active + high intensity** will have highest TDEE

---

## 🐛 Common Errors

### Missing JWT Token
```bash
# Fix: Add Authorization header
-H "Authorization: Bearer YOUR_TOKEN"
```

### Invalid Enum Value
```bash
# Wrong
"goal_type": "weight_loss"

# Correct
"goal_type": "lose"
```

### Pace Doesn't Match Goal
```bash
# Wrong (losing weight with positive pace)
"goal_type": "lose",
"pace_kg_per_week": 0.5

# Correct
"goal_type": "lose",
"pace_kg_per_week": -0.5
```

---

## 📚 See Full Documentation
For detailed explanations, see: `GOALS_API_DOCUMENTATION.md`

