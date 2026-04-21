const OnboardingService = require('../services/onboardingService');
const parseBody = require('../utils/parseBody');
const { reportError } = require('../utils/sentryReporter');

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
  // ==================== V2 ENDPOINTS ====================

  static async getV2Screens(req, res) {
    try {
      const config = OnboardingService.getV2Config();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: config
      }));
    } catch (error) {
      reportError(error, { req });
      console.error('Error fetching V2 screens:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Failed to fetch V2 screen config',
        error: error.message
      }));
    }
  }

  static async submitV2Answers(req, res) {
    parseBody(req, async (err, data) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }

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
      if (!answers || typeof answers !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Answers object is required'
        }));
        return;
      }

      try {
        const result = await OnboardingService.saveV2Answers(userId, answers);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: result.message
        }));
      } catch (error) {
        reportError(error, { req });
        console.error('Error submitting V2 answers:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Failed to submit V2 answers',
          error: error.message
        }));
      }
    });
  }

  static async getV2Status(req, res) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'User ID not found in token'
        }));
        return;
      }

      const status = await OnboardingService.getOnboardingStatus(userId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: status
      }));
    } catch (error) {
      reportError(error, { req });
      console.error('Error fetching V2 status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Failed to fetch onboarding status',
        error: error.message
      }));
    }
  }
}

module.exports = OnboardingController;
