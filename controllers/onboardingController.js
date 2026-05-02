const mongoose = require('mongoose');
const OnboardingService = require('../services/onboardingService');
const { evaluateApplicability } = require('../services/skipIfEvaluator');
const parseBody = require('../utils/parseBody');
const { reportError } = require('../utils/sentryReporter');

const ALLOWED_QUESTION_TYPES = new Set(['PLAN_CREATION', 'NOTIFICATIONS']);

class OnboardingController {
  static async getQuestions(req, res) {
    try {
      // Extract type query parameter
      const url = new URL(req.url, `http://${req.headers.host}`);
      const type = url.searchParams.get('type');
      
      const questions = await OnboardingService.getActiveQuestions(type);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: questions,
        count: questions.length
      }));
    } catch (error) {
      reportError(error, { req });
      console.error('Error fetching questions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Failed to fetch questions',
        error: error.message
      }));
    }
  }

  static async saveAnswers(req, res) {
    parseBody(req, async (err, data) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }

      // Extract userId from JWT token (set by auth middleware)
      const userId = req.user?.userId;
      
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'User ID not found in token'
        }));
        return;
      }

      const { answers } = data;
      
      if (!answers) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Answers array is required'
        }));
        return;
      }

      // Add userId to each answer
      const answersWithUserId = answers.map(answer => ({
        ...answer,
        userId: userId
      }));

      try {
        const result = await OnboardingService.saveUserAnswers(answersWithUserId);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: result.message,
          data: result.results
        }));
      } catch (error) {
        reportError(error, { req });
        console.error('Error saving answers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Failed to save answers',
          error: error.message
        }));
      }
    });
  }

  static async getQuestionsApplicability(req, res) {
    parseBody(req, async (err, data) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Invalid request body' }));
        return;
      }

      const body = data || {};
      const { type, answers } = body;

      if (type !== undefined && type !== null && !ALLOWED_QUESTION_TYPES.has(type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: `Invalid type; expected one of ${[...ALLOWED_QUESTION_TYPES].join(', ')} or omitted`
        }));
        return;
      }

      if (!Array.isArray(answers)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'answers must be an array' }));
        return;
      }

      for (let i = 0; i < answers.length; i += 1) {
        const a = answers[i];
        if (!a || typeof a !== 'object') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: `answers[${i}] must be an object` }));
          return;
        }
        if (typeof a.questionId !== 'string' || !mongoose.Types.ObjectId.isValid(a.questionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: `answers[${i}].questionId must be a valid ObjectId hex string` }));
          return;
        }
        if (!Array.isArray(a.values)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: `answers[${i}].values must be an array` }));
          return;
        }
      }

      try {
        const questions = await OnboardingService.getActiveQuestions(type || null);
        const annotated = evaluateApplicability(questions, answers);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: annotated,
          count: annotated.length
        }));
      } catch (error) {
        reportError(error, { req });
        console.error('Error evaluating question applicability:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Failed to evaluate question applicability',
          error: error.message
        }));
      }
    });
  }

  static async getUserAnswers(req, res) {
    try {
      // Extract userId from JWT token (set by auth middleware)
      const userId = req.user?.userId;
      
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'User ID not found in token'
        }));
        return;
      }

      const answers = await OnboardingService.getUserAnswers(userId);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: answers,
        count: answers.length
      }));
    } catch (error) {
      reportError(error, { req });
      console.error('Error fetching user answers:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Failed to fetch user answers',
        error: error.message
      }));
    }
  }
}

module.exports = OnboardingController;
