const mongoose = require('mongoose');
require('dotenv').config();

const Recipe = require('../models/schemas/Recipe');

/**
 * Curated recipes for composite dishes
 * Covers Indian, international, breakfast, and quick meals
 */
const curatedRecipes = [
  // ===== INDIAN COMPOSITE DISHES (20 recipes) =====

  {
    name: 'Butter Chicken',
    aliases: ['Murgh Makhani', 'Chicken Makhani', 'Butter Chicken Curry'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Butter chicken gravy', category: 'sauce', gramsPerServing: 200 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Tikka Masala',
    aliases: ['Tikka Masala', 'Chicken Tikka Curry'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Tikka masala gravy', category: 'sauce', gramsPerServing: 200 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Paneer Tikka Masala',
    aliases: ['Paneer Tikka', 'Paneer Masala'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'dairy', gramsPerServing: 120 },
      { name: 'Tikka masala gravy', category: 'sauce', gramsPerServing: 180 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Palak Paneer',
    aliases: ['Spinach Paneer', 'Saag Paneer'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'dairy', gramsPerServing: 100 },
      { name: 'Palak gravy', category: 'sauce', gramsPerServing: 200 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Shahi Paneer',
    aliases: ['Paneer Shahi', 'Royal Paneer'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'dairy', gramsPerServing: 120 },
      { name: 'Shahi paneer gravy', category: 'sauce', gramsPerServing: 180 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Korma',
    aliases: ['Korma', 'Chicken Shahi Korma'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Korma gravy', category: 'sauce', gramsPerServing: 200 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Biryani',
    aliases: ['Biryani', 'Chicken Dum Biryani', 'Hyderabadi Biryani'],
    servingUnit: 'plate',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 180 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 120 },
      { name: 'Yogurt', category: 'dairy', gramsPerServing: 30 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Vegetable Biryani',
    aliases: ['Veg Biryani', 'Vegetarian Biryani'],
    servingUnit: 'plate',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 200 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Yogurt', category: 'dairy', gramsPerServing: 30 },
      { name: 'Oil', category: 'fat', gramsPerServing: 12 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chole (Chickpea Curry)',
    aliases: ['Chana Masala', 'Chole Masala', 'Chickpea Masala'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chickpeas', category: 'legumes', gramsPerServing: 150 },
      { name: 'Chole masala gravy base', category: 'sauce', gramsPerServing: 100 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Rajma (Kidney Bean Curry)',
    aliases: ['Rajma Masala', 'Kidney Bean Curry'],
    servingUnit: 'bowl',
    components: [
      { name: 'Kidney beans', category: 'legumes', gramsPerServing: 150 },
      { name: 'Rajma masala gravy base', category: 'sauce', gramsPerServing: 100 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Dal Makhani',
    aliases: ['Makhani Dal', 'Black Lentil Dal'],
    servingUnit: 'bowl',
    components: [
      { name: 'Black lentils', category: 'legumes', gramsPerServing: 120 },
      { name: 'Dal makhani gravy base', category: 'sauce', gramsPerServing: 130 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Dal Tadka',
    aliases: ['Tadka Dal', 'Yellow Dal'],
    servingUnit: 'bowl',
    components: [
      { name: 'Lentils', category: 'legumes', gramsPerServing: 140 },
      { name: 'Dal tadka base', category: 'sauce', gramsPerServing: 110 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Kadai Chicken',
    aliases: ['Kadhai Chicken', 'Karahi Chicken'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Kadai gravy', category: 'sauce', gramsPerServing: 150 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Kadai Paneer',
    aliases: ['Kadhai Paneer', 'Karahi Paneer'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'dairy', gramsPerServing: 120 },
      { name: 'Kadai gravy', category: 'sauce', gramsPerServing: 150 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Malai Kofta',
    aliases: ['Veg Kofta', 'Vegetable Kofta'],
    servingUnit: 'bowl',
    components: [
      { name: 'Paneer', category: 'dairy', gramsPerServing: 80 },
      { name: 'Potato', category: 'vegetable', gramsPerServing: 60 },
      { name: 'Malai kofta gravy', category: 'sauce', gramsPerServing: 160 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Curry',
    aliases: ['Indian Chicken Curry', 'Chicken Masala'],
    servingUnit: 'bowl',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Chicken curry gravy', category: 'sauce', gramsPerServing: 180 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Fish Curry',
    aliases: ['Meen Curry', 'Fish Masala'],
    servingUnit: 'bowl',
    components: [
      { name: 'Fish', category: 'protein', gramsPerServing: 150 },
      { name: 'Fish curry gravy', category: 'sauce', gramsPerServing: 150 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Egg Curry',
    aliases: ['Anda Curry', 'Boiled Egg Curry'],
    servingUnit: 'bowl',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Egg curry gravy', category: 'sauce', gramsPerServing: 150 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Aloo Gobi',
    aliases: ['Potato Cauliflower Curry', 'Aloo Gobhi'],
    servingUnit: 'bowl',
    components: [
      { name: 'Potato', category: 'vegetable', gramsPerServing: 120 },
      { name: 'Cauliflower', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Tomato gravy', category: 'sauce', gramsPerServing: 80 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Masala Dosa',
    aliases: ['Dosa', 'Potato Dosa'],
    servingUnit: 'piece',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 60 },
      { name: 'Lentils', category: 'legumes', gramsPerServing: 20 },
      { name: 'Potato', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // ===== INTERNATIONAL DISHES (20 recipes) =====

  {
    name: 'Burrito Bowl',
    aliases: ['Mexican Bowl', 'Chipotle Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Black beans', category: 'legumes', gramsPerServing: 100 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 },
      { name: 'Sour cream', category: 'dairy', gramsPerServing: 30 },
      { name: 'Salsa', category: 'sauce', gramsPerServing: 50 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Caesar Salad',
    aliases: ['Caesar Salad with Chicken', 'Grilled Chicken Caesar'],
    servingUnit: 'bowl',
    components: [
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 120 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 },
      { name: 'Bread', category: 'grain', gramsPerServing: 30 },
      { name: 'Mayonnaise', category: 'sauce', gramsPerServing: 40 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pasta Carbonara',
    aliases: ['Carbonara', 'Spaghetti Carbonara'],
    servingUnit: 'plate',
    components: [
      { name: 'Pasta', category: 'grain', gramsPerServing: 150 },
      { name: 'Bacon', category: 'protein', gramsPerServing: 60 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 40 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pasta Alfredo',
    aliases: ['Fettuccine Alfredo', 'Chicken Alfredo'],
    servingUnit: 'plate',
    components: [
      { name: 'Pasta', category: 'grain', gramsPerServing: 150 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'White sauce', category: 'sauce', gramsPerServing: 120 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pasta Marinara',
    aliases: ['Spaghetti Marinara', 'Tomato Pasta'],
    servingUnit: 'plate',
    components: [
      { name: 'Pasta', category: 'grain', gramsPerServing: 150 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Cheeseburger',
    aliases: ['Burger', 'Cheese Burger', 'Hamburger with Cheese'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 80 },
      { name: 'Beef', category: 'protein', gramsPerServing: 110 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 20 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 30 },
      { name: 'Mayonnaise', category: 'sauce', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Burger',
    aliases: ['Grilled Chicken Burger', 'Chicken Sandwich'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 80 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 20 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 30 },
      { name: 'Mayonnaise', category: 'sauce', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Tacos',
    aliases: ['Chicken Tacos', 'Beef Tacos', 'Soft Tacos'],
    servingUnit: 'piece',
    components: [
      { name: 'Tortilla', category: 'grain', gramsPerServing: 40 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 60 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 20 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 20 },
      { name: 'Salsa', category: 'sauce', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Quesadilla',
    aliases: ['Chicken Quesadilla', 'Cheese Quesadilla'],
    servingUnit: 'piece',
    components: [
      { name: 'Tortilla', category: 'grain', gramsPerServing: 80 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 80 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 60 },
      { name: 'Sour cream', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Fried Rice',
    aliases: ['Chicken Fried Rice', 'Vegetable Fried Rice', 'Chinese Fried Rice'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 180 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 80 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Noodles',
    aliases: ['Hakka Noodles', 'Chow Mein', 'Stir Fry Noodles'],
    servingUnit: 'bowl',
    components: [
      { name: 'Noodles', category: 'grain', gramsPerServing: 150 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 80 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pizza Slice',
    aliases: ['Pizza', 'Cheese Pizza', 'Margherita Pizza'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 80 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 40 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 40 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Greek Salad',
    aliases: ['Mediterranean Salad', 'Greek Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Cucumber', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 80 },
      { name: 'Onion', category: 'vegetable', gramsPerServing: 30 },
      { name: 'Feta cheese', category: 'dairy', gramsPerServing: 40 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Poke Bowl',
    aliases: ['Hawaiian Poke', 'Tuna Poke Bowl', 'Salmon Poke'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Fish', category: 'protein', gramsPerServing: 120 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Avocado', category: 'fruit', gramsPerServing: 60 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Stir Fry Vegetables',
    aliases: ['Veggie Stir Fry', 'Mixed Vegetable Stir Fry'],
    servingUnit: 'bowl',
    components: [
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 250 },
      { name: 'Oil', category: 'fat', gramsPerServing: 12 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Grilled Chicken Breast',
    aliases: ['Grilled Chicken', 'Chicken Breast'],
    servingUnit: 'piece',
    components: [
      { name: 'Chicken breast', category: 'protein', gramsPerServing: 150 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 8 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Grilled Fish',
    aliases: ['Pan Seared Fish', 'Baked Fish'],
    servingUnit: 'piece',
    components: [
      { name: 'Fish', category: 'protein', gramsPerServing: 150 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Roasted Vegetables',
    aliases: ['Oven Roasted Veggies', 'Baked Vegetables'],
    servingUnit: 'serving',
    components: [
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 250 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Wings',
    aliases: ['Buffalo Wings', 'Hot Wings', 'Fried Chicken Wings'],
    servingUnit: 'serving',
    components: [
      { name: 'Chicken', category: 'protein', gramsPerServing: 150 },
      { name: 'Oil', category: 'fat', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'French Fries',
    aliases: ['Fries', 'Potato Fries', 'Chips'],
    servingUnit: 'serving',
    components: [
      { name: 'Potato', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Oil', category: 'fat', gramsPerServing: 25 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // ===== BREAKFAST ITEMS (15 recipes) =====

  {
    name: 'One Egg Omelet',
    aliases: ['1 Egg Omelet', 'Single Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Oil', category: 'fat', gramsPerServing: 5 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Two Egg Omelet',
    aliases: ['2 Egg Omelet', 'Double Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Oil', category: 'fat', gramsPerServing: 8 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Three Egg Omelet',
    aliases: ['3 Egg Omelet', 'Triple Egg Omelet'],
    servingUnit: 'piece',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 150 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Scrambled Eggs',
    aliases: ['Egg Bhurji', 'Anda Bhurji'],
    servingUnit: 'serving',
    components: [
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Butter', category: 'fat', gramsPerServing: 10 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Pancakes',
    aliases: ['Buttermilk Pancakes', 'Fluffy Pancakes'],
    servingUnit: 'serving',
    components: [
      { name: 'Flour', category: 'grain', gramsPerServing: 80 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 120 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Butter', category: 'fat', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Oatmeal Bowl',
    aliases: ['Oats Bowl', 'Oatmeal', 'Porridge'],
    servingUnit: 'bowl',
    components: [
      { name: 'Oats', category: 'grain', gramsPerServing: 60 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 200 },
      { name: 'Banana', category: 'fruit', gramsPerServing: 60 },
      { name: 'Nuts', category: 'nuts', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Greek Yogurt Parfait',
    aliases: ['Yogurt Parfait', 'Yogurt Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Greek yogurt', category: 'dairy', gramsPerServing: 200 },
      { name: 'Granola', category: 'grain', gramsPerServing: 40 },
      { name: 'Berries', category: 'fruit', gramsPerServing: 80 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Smoothie Bowl',
    aliases: ['Acai Bowl', 'Fruit Smoothie Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Banana', category: 'fruit', gramsPerServing: 100 },
      { name: 'Berries', category: 'fruit', gramsPerServing: 80 },
      { name: 'Yogurt', category: 'dairy', gramsPerServing: 100 },
      { name: 'Granola', category: 'grain', gramsPerServing: 30 },
      { name: 'Nuts', category: 'nuts', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Protein Smoothie',
    aliases: ['Whey Protein Shake', 'Protein Shake'],
    servingUnit: 'cup',
    components: [
      { name: 'Whey protein powder', category: 'protein', gramsPerServing: 30 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 250 },
      { name: 'Banana', category: 'fruit', gramsPerServing: 100 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Fruit Smoothie',
    aliases: ['Mixed Fruit Smoothie', 'Berry Smoothie'],
    servingUnit: 'cup',
    components: [
      { name: 'Banana', category: 'fruit', gramsPerServing: 100 },
      { name: 'Berries', category: 'fruit', gramsPerServing: 80 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 150 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Poha',
    aliases: ['Beaten Rice', 'Aval'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice flakes', category: 'grain', gramsPerServing: 60 },
      { name: 'Potato', category: 'vegetable', gramsPerServing: 50 },
      { name: 'Peanuts', category: 'nuts', gramsPerServing: 15 },
      { name: 'Oil', category: 'fat', gramsPerServing: 8 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Upma',
    aliases: ['Rava Upma', 'Semolina Upma'],
    servingUnit: 'bowl',
    components: [
      { name: 'Semolina', category: 'grain', gramsPerServing: 60 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 60 },
      { name: 'Peanuts', category: 'nuts', gramsPerServing: 10 },
      { name: 'Oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Idli',
    aliases: ['Steamed Rice Cake', 'Idly'],
    servingUnit: 'piece',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 40 },
      { name: 'Lentils', category: 'legumes', gramsPerServing: 15 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Breakfast Burrito',
    aliases: ['Egg Burrito', 'Morning Burrito'],
    servingUnit: 'piece',
    components: [
      { name: 'Tortilla', category: 'grain', gramsPerServing: 60 },
      { name: 'Scrambled eggs', category: 'protein', gramsPerServing: 100 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 },
      { name: 'Salsa', category: 'sauce', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'French Toast',
    aliases: ['Eggy Bread', 'Bombay Toast'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 60 },
      { name: 'Egg', category: 'protein', gramsPerServing: 50 },
      { name: 'Milk', category: 'dairy', gramsPerServing: 40 },
      { name: 'Butter', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },

  // ===== QUICK MEALS (10 recipes) =====

  {
    name: 'Chicken Rice Bowl',
    aliases: ['Grilled Chicken with Rice', 'Chicken Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Rice', category: 'grain', gramsPerServing: 150 },
      { name: 'Chicken breast', category: 'protein', gramsPerServing: 120 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 100 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Quinoa Bowl',
    aliases: ['Quinoa Vegetable Bowl', 'Quinoa Salad'],
    servingUnit: 'bowl',
    components: [
      { name: 'Quinoa', category: 'grain', gramsPerServing: 120 },
      { name: 'Roasted vegetables', category: 'vegetable', gramsPerServing: 150 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Tuna Salad',
    aliases: ['Tuna Bowl', 'Tuna Lettuce Wrap'],
    servingUnit: 'bowl',
    components: [
      { name: 'Tuna', category: 'protein', gramsPerServing: 100 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 100 },
      { name: 'Cucumber', category: 'vegetable', gramsPerServing: 50 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Chicken Wrap',
    aliases: ['Grilled Chicken Wrap', 'Chicken Roll'],
    servingUnit: 'piece',
    components: [
      { name: 'Tortilla', category: 'grain', gramsPerServing: 60 },
      { name: 'Chicken', category: 'protein', gramsPerServing: 100 },
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 40 },
      { name: 'Mayonnaise', category: 'sauce', gramsPerServing: 20 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Veggie Wrap',
    aliases: ['Vegetable Wrap', 'Veg Roll'],
    servingUnit: 'piece',
    components: [
      { name: 'Tortilla', category: 'grain', gramsPerServing: 60 },
      { name: 'Mixed vegetables', category: 'vegetable', gramsPerServing: 120 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Grilled Chicken Salad',
    aliases: ['Chicken Garden Salad', 'Grilled Chicken Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Lettuce', category: 'vegetable', gramsPerServing: 120 },
      { name: 'Chicken breast', category: 'protein', gramsPerServing: 120 },
      { name: 'Cucumber', category: 'vegetable', gramsPerServing: 60 },
      { name: 'Tomato', category: 'vegetable', gramsPerServing: 60 },
      { name: 'Olive oil', category: 'fat', gramsPerServing: 12 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Buddha Bowl',
    aliases: ['Power Bowl', 'Macro Bowl'],
    servingUnit: 'bowl',
    components: [
      { name: 'Quinoa', category: 'grain', gramsPerServing: 100 },
      { name: 'Chickpeas', category: 'legumes', gramsPerServing: 80 },
      { name: 'Roasted vegetables', category: 'vegetable', gramsPerServing: 120 },
      { name: 'Avocado', category: 'fruit', gramsPerServing: 50 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Egg Sandwich',
    aliases: ['Fried Egg Sandwich', 'Egg Toast'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 60 },
      { name: 'Egg', category: 'protein', gramsPerServing: 100 },
      { name: 'Butter', category: 'fat', gramsPerServing: 8 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Grilled Cheese Sandwich',
    aliases: ['Cheese Toast', 'Cheese Sandwich'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 60 },
      { name: 'Cheese', category: 'dairy', gramsPerServing: 50 },
      { name: 'Butter', category: 'fat', gramsPerServing: 10 }
    ],
    verified: true,
    source: 'MANUAL'
  },
  {
    name: 'Peanut Butter Sandwich',
    aliases: ['PB Sandwich', 'Peanut Butter Toast'],
    servingUnit: 'piece',
    components: [
      { name: 'Bread', category: 'grain', gramsPerServing: 60 },
      { name: 'Peanut butter', category: 'nuts', gramsPerServing: 30 }
    ],
    verified: true,
    source: 'MANUAL'
  }
];

async function createCuratedRecipes() {
  try {
    console.log('Creating Curated Recipes');
    console.log('=======================\n');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const recipe of curatedRecipes) {
      const existing = await Recipe.findOne({ name: recipe.name });

      if (existing) {
        // Update existing recipe
        await Recipe.updateOne({ name: recipe.name }, { $set: recipe });
        console.log(`↻ UPDATE: ${recipe.name}`);
        updated++;
      } else {
        // Create new recipe
        await Recipe.create(recipe);
        console.log(`✓ CREATE: ${recipe.name}`);
        created++;
      }
    }

    console.log(`\n✓ Complete: ${created} created, ${updated} updated\n`);

    // Final stats
    const totalRecipes = await Recipe.countDocuments({ verified: true });
    const byServingUnit = await Recipe.aggregate([
      { $match: { verified: true } },
      { $group: { _id: '$servingUnit', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('Final Recipe Stats:');
    console.log(`  Total verified recipes: ${totalRecipes}`);
    console.log('\n  By serving unit:');
    byServingUnit.forEach(s => console.log(`    ${s._id}: ${s.count}`));

    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');

  } catch (error) {
    console.error('✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

createCuratedRecipes();
