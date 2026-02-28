const modelRegistry = require('./modelRegistry');
const logger = require('../config/logger');

/**
 * Pattern definitions for intent classification.
 * Each pattern has a regex, a capability, and a weight.
 */
const IMAGE_PATTERNS = [
  { regex: /\b(logo|icon|favicon|avatar|badge|emblem)\b/i, weight: 0.95 },
  { regex: /\b(generate|create|make|design)\s+(an?\s+)?(image|picture|photo|illustration|graphic|banner|thumbnail)\b/i, weight: 0.95 },
  { regex: /\b(image|picture|illustration|graphic|visual)\s+(of|for|showing|depicting)\b/i, weight: 0.90 },
  { regex: /\b(draw|sketch|render|visualize)\b/i, weight: 0.80 },
  { regex: /\b(hero\s+image|background\s+image|profile\s+picture|cover\s+photo)\b/i, weight: 0.90 },
];

const CODE_PATTERNS = [
  { regex: /\b(build|create|add|implement|write|code|develop|scaffold)\s+(a|an|the|my)?\s*(app|application|website|page|component|feature|function|api|endpoint|route|form|modal|button|navbar|sidebar|footer|header|table|chart|dashboard)\b/i, weight: 0.90 },
  { regex: /\b(fix|debug|update|modify|change|refactor|optimize|improve)\s+(the|my|this|a)?\s*(code|bug|error|issue|component|function|style|layout|css)\b/i, weight: 0.90 },
  { regex: /\b(react|vue|angular|next\.?js|express|node|typescript|javascript|html|css|tailwind|python|java|rust|go)\b/i, weight: 0.75 },
  { regex: /\b(import|export|function|const|class|interface|useState|useEffect)\b/i, weight: 0.80 },
  { regex: /\b(install|npm|yarn|package|dependency|library)\b/i, weight: 0.70 },
  { regex: /\b(database|sql|query|migration|schema|table|crud)\b/i, weight: 0.80 },
  { regex: /\b(authentication|login|signup|oauth|jwt|session)\b/i, weight: 0.80 },
  { regex: /\b(test|spec|unit test|integration test)\b/i, weight: 0.75 },
];

const TEXT_PATTERNS = [
  { regex: /\b(write|draft|compose)\s+(a|an|the|my)?\s*(email|newsletter|blog|article|post|copy|description|bio|tagline|slogan)\b/i, weight: 0.90 },
  { regex: /\b(landing\s+page)\s+(copy|content|text)\b/i, weight: 0.90 },
  { regex: /\b(social\s+(media\s+)?post|tweet|linkedin\s+post|instagram\s+caption)\b/i, weight: 0.90 },
  { regex: /\b(marketing|advertisement|ad\s+copy|promotional|campaign)\b/i, weight: 0.85 },
  { regex: /\b(seo|meta\s+description|title\s+tag)\b/i, weight: 0.80 },
  { regex: /\b(translate|summarize|rewrite|paraphrase)\b/i, weight: 0.75 },
];

class RequestAnalyzer {
  /**
   * Analyze a user message to determine intent and recommend a model.
   *
   * @param {string} message - The user's message
   * @returns {Promise<{capability: string, recommendedModel: Object, confidence: number, alternativeModel?: Object}>}
   */
  async analyze(message) {
    if (!message || typeof message !== 'string') {
      const defaultModel = await modelRegistry.getDefaultModel('code');
      return {
        capability: 'code',
        recommendedModel: defaultModel,
        confidence: 0.5,
      };
    }

    const scores = {
      image: this._scorePatterns(message, IMAGE_PATTERNS),
      code: this._scorePatterns(message, CODE_PATTERNS),
      text: this._scorePatterns(message, TEXT_PATTERNS),
    };

    logger.debug('Request analysis scores', { scores, messagePreview: message.substring(0, 100) });

    // Find the highest-scoring capability
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topCapability, topScore] = sorted[0];
    const [secondCapability, secondScore] = sorted[1] || ['code', 0];

    const recommendedModel = await modelRegistry.getDefaultModel(topCapability);

    // If the top two scores are close, offer an alternative
    let alternativeModel = null;
    if (topScore > 0 && secondScore > 0 && (topScore - secondScore) < 0.15) {
      alternativeModel = await modelRegistry.getDefaultModel(secondCapability);
    }

    // Default to code if nothing matched
    if (topScore === 0) {
      const defaultCode = await modelRegistry.getDefaultModel('code');
      return {
        capability: 'code',
        recommendedModel: defaultCode,
        confidence: 0.5,
      };
    }

    return {
      capability: topCapability,
      recommendedModel,
      confidence: Math.min(topScore, 1.0),
      alternativeModel: alternativeModel || undefined,
    };
  }

  /**
   * Score a message against a set of patterns.
   * Returns the highest weight among matched patterns.
   * @private
   */
  _scorePatterns(message, patterns) {
    let maxWeight = 0;
    let matchCount = 0;

    for (const { regex, weight } of patterns) {
      if (regex.test(message)) {
        matchCount++;
        if (weight > maxWeight) maxWeight = weight;
      }
    }

    // Boost score slightly for multiple matches
    if (matchCount > 1) {
      maxWeight = Math.min(maxWeight + (matchCount - 1) * 0.03, 1.0);
    }

    return maxWeight;
  }
}

const requestAnalyzer = new RequestAnalyzer();
module.exports = requestAnalyzer;
