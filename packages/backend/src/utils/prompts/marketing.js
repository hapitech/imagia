/**
 * Marketing Prompt Templates
 *
 * Prompts for generating marketing collateral: landing pages, social posts,
 * ad copy, and email templates.
 */

function buildLandingPagePrompt(appName, description, features, screenshotUrls = []) {
  const screenshotsSection = screenshotUrls.length > 0
    ? `\nScreenshot URLs to include as images:\n${screenshotUrls.map((u) => `- ${u}`).join('\n')}`
    : '';

  return {
    systemMessage: `You are an expert landing page designer and copywriter. Generate complete, production-ready HTML with inline CSS and minimal JavaScript. The design should be modern, responsive, and conversion-optimized. Use a clean color scheme with a primary CTA button. Do NOT use any external CSS frameworks - write all styles inline or in a <style> tag.`,
    prompt: `Create a landing page for "${appName}".

Description: ${description}

Features:
${(features || ['Feature-rich application']).map((f) => `- ${f}`).join('\n')}
${screenshotsSection}

Generate a complete HTML file with:
1. Hero section with headline, subheadline, and CTA button
2. Features section with icons (use emoji or SVG)
3. Screenshots section (if URLs provided, use <img> tags)
4. Testimonials section (2-3 fictional testimonials)
5. Pricing section (free/pro tiers)
6. Footer with links

Return ONLY the complete HTML file, no explanation.`,
  };
}

function buildSocialPostsPrompt(appName, description, platform) {
  const constraints = {
    twitter: 'Maximum 280 characters. Use hashtags. Be punchy and engaging.',
    linkedin: '1-3 paragraphs. Professional tone. Include a call to action.',
    instagram: 'Engaging caption with emojis. Include 5-10 relevant hashtags at the end.',
    facebook: 'Conversational tone. 2-3 sentences plus a CTA. Can be longer form.',
  };

  return {
    systemMessage: 'You are a social media marketing expert. Write engaging posts that drive clicks and engagement. Return the posts as a JSON array.',
    prompt: `Write 3 ${platform} posts promoting "${appName}".

Description: ${description}

Platform constraints: ${constraints[platform] || constraints.twitter}

Return a JSON array of 3 post objects:
[
  { "content": "post text here", "hashtags": ["tag1", "tag2"] }
]

Return ONLY valid JSON, no explanation.`,
  };
}

function buildAdCopyPrompt(appName, description, platform) {
  const formats = {
    google: 'Google Ads: 3 headlines (max 30 chars each), 2 descriptions (max 90 chars each)',
    facebook: 'Facebook Ads: primary text (125 chars), headline (40 chars), description (30 chars)',
    linkedin: 'LinkedIn Ads: intro text (150 chars), headline (70 chars), description (100 chars)',
  };

  return {
    systemMessage: 'You are a performance marketing expert specializing in paid advertising. Create high-converting ad copy. Return as JSON.',
    prompt: `Create ad copy for "${appName}" on ${platform}.

Description: ${description}

Format: ${formats[platform] || formats.google}

Generate 3 ad variations as a JSON array:
[
  {
    "variant": "A",
    "headlines": ["...", "...", "..."],
    "descriptions": ["...", "..."]
  }
]

Return ONLY valid JSON, no explanation.`,
  };
}

function buildEmailTemplatePrompt(appName, description, emailType) {
  const types = {
    launch: 'Product launch announcement email',
    feature: 'Feature highlight email',
    onboarding: 'Welcome/onboarding email for new users',
  };

  return {
    systemMessage: 'You are an email marketing expert. Write engaging emails with high open and click rates. Return complete HTML email templates.',
    prompt: `Create a ${types[emailType] || types.launch} for "${appName}".

Description: ${description}

Generate a complete HTML email template with:
1. Engaging subject line
2. Preview text
3. Header with app name
4. Main content body
5. CTA button
6. Footer with unsubscribe link

Return as JSON:
{
  "subject": "...",
  "preview_text": "...",
  "html": "complete HTML here"
}

Return ONLY valid JSON, no explanation.`,
  };
}

function buildDemoScriptPrompt(appName, description, appType) {
  return {
    systemMessage: 'You are a product demo expert. Create step-by-step demo scripts that showcase an app\'s key features in 30-60 seconds. Return as JSON.',
    prompt: `Create a demo script for "${appName}" (${appType || 'web app'}).

Description: ${description}

Return a JSON array of demo steps:
[
  {
    "description": "what this step shows",
    "path": "/optional-url-path",
    "action": "click|fill|scroll|scrollToBottom|wait",
    "selector": "optional CSS selector",
    "value": "optional value for fill actions",
    "waitMs": 2000
  }
]

Include 4-8 steps that showcase the main features. Start with the landing/home page.

Return ONLY valid JSON, no explanation.`,
  };
}

module.exports = {
  buildLandingPagePrompt,
  buildSocialPostsPrompt,
  buildAdCopyPrompt,
  buildEmailTemplatePrompt,
  buildDemoScriptPrompt,
};
