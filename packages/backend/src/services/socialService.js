/**
 * Social Service
 *
 * OAuth flows and API integration for Twitter, LinkedIn, Instagram, Facebook.
 * Handles token management, post publishing, and engagement polling.
 */

const axios = require('axios');
const { db } = require('../config/database');
const config = require('../config/environment');
const logger = require('../config/logger');
const { encrypt, decrypt } = require('../utils/encryption');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// Platform character limits
const PLATFORM_LIMITS = {
  twitter: { maxChars: 280, maxMedia: 4, mediaTypes: ['image', 'video', 'gif'] },
  linkedin: { maxChars: 3000, maxMedia: 9, mediaTypes: ['image', 'video'] },
  instagram: { maxChars: 2200, maxMedia: 10, mediaTypes: ['image', 'video'] },
  facebook: { maxChars: 63206, maxMedia: 10, mediaTypes: ['image', 'video'] },
};

// OAuth configuration per platform
const OAUTH_CONFIG = {
  twitter: {
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    apiBase: 'https://api.twitter.com/2',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    apiBase: 'https://api.linkedin.com/v2',
    scopes: ['openid', 'profile', 'w_member_social'],
  },
  instagram: {
    authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    apiBase: 'https://graph.facebook.com/v18.0',
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    apiBase: 'https://graph.facebook.com/v18.0',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
  },
};

function getClientCredentials(platform) {
  const map = {
    twitter: { clientId: config.twitterClientId, clientSecret: config.twitterClientSecret },
    linkedin: { clientId: config.linkedinClientId, clientSecret: config.linkedinClientSecret },
    instagram: { clientId: config.facebookAppId, clientSecret: config.facebookAppSecret },
    facebook: { clientId: config.facebookAppId, clientSecret: config.facebookAppSecret },
  };
  return map[platform] || {};
}

function getCallbackUrl(platform) {
  const base = config.socialOauthCallbackUrl || `${config.frontendUrl}/api/social/oauth/callback`;
  return `${base}/${platform}`;
}

// ---------- OAuth flows --------------------------------------------------------

function getOAuthUrl(platform, state) {
  const oauthConfig = OAUTH_CONFIG[platform];
  if (!oauthConfig) throw new Error(`Unsupported platform: ${platform}`);

  const { clientId } = getClientCredentials(platform);
  if (!clientId) throw new Error(`OAuth credentials not configured for ${platform}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(platform),
    response_type: 'code',
    scope: oauthConfig.scopes.join(' '),
    state,
  });

  // Twitter uses PKCE
  if (platform === 'twitter') {
    params.set('code_challenge', 'challenge');
    params.set('code_challenge_method', 'plain');
  }

  return `${oauthConfig.authorizeUrl}?${params.toString()}`;
}

const _exchangeToken = createCircuitBreaker(
  async (platform, code) => {
    const oauthConfig = OAUTH_CONFIG[platform];
    const { clientId, clientSecret } = getClientCredentials(platform);

    const params = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: getCallbackUrl(platform),
      client_id: clientId,
    };

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    // Twitter uses Basic auth
    if (platform === 'twitter') {
      params.code_verifier = 'challenge';
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    } else {
      params.client_secret = clientSecret;
    }

    const response = await axios.post(oauthConfig.tokenUrl, new URLSearchParams(params).toString(), { headers });
    return response.data;
  },
  'social-token-exchange'
);

async function handleOAuthCallback(platform, code, userId) {
  const tokenData = await _exchangeToken.fire(platform, code);

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresIn = tokenData.expires_in;
  const tokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  // Fetch user profile from platform
  const profile = await fetchPlatformProfile(platform, accessToken);

  // Upsert social account
  const existing = await db('social_accounts')
    .where({ user_id: userId, platform, platform_account_id: profile.id })
    .first();

  const accountData = {
    user_id: userId,
    platform,
    platform_account_id: profile.id,
    platform_username: profile.username,
    access_token: encrypt(accessToken),
    refresh_token: refreshToken ? encrypt(refreshToken) : null,
    token_expires_at: tokenExpiresAt,
    account_metadata: JSON.stringify(profile.metadata),
    status: 'active',
    updated_at: db.fn.now(),
  };

  let account;
  if (existing) {
    [account] = await db('social_accounts')
      .where({ id: existing.id })
      .update(accountData)
      .returning('*');
  } else {
    [account] = await db('social_accounts')
      .insert(accountData)
      .returning('*');
  }

  logger.info('Social account connected', { platform, userId, accountId: account.id });
  return sanitizeAccount(account);
}

// ---------- Platform profile fetching ------------------------------------------

const _fetchProfile = createCircuitBreaker(
  async (platform, accessToken) => {
    const oauthConfig = OAUTH_CONFIG[platform];
    const headers = { Authorization: `Bearer ${accessToken}` };

    if (platform === 'twitter') {
      const { data } = await axios.get(`${oauthConfig.apiBase}/users/me`, {
        headers,
        params: { 'user.fields': 'profile_image_url,public_metrics,description' },
      });
      return {
        id: data.data.id,
        username: data.data.username,
        metadata: {
          name: data.data.name,
          handle: `@${data.data.username}`,
          profile_pic: data.data.profile_image_url,
          followers: data.data.public_metrics?.followers_count || 0,
          description: data.data.description,
        },
      };
    }

    if (platform === 'linkedin') {
      const { data } = await axios.get(`${oauthConfig.apiBase}/userinfo`, { headers });
      return {
        id: data.sub,
        username: data.name,
        metadata: {
          name: data.name,
          handle: data.name,
          profile_pic: data.picture,
          email: data.email,
        },
      };
    }

    if (platform === 'facebook') {
      const { data } = await axios.get(`${oauthConfig.apiBase}/me`, {
        headers,
        params: { fields: 'id,name,picture,accounts' },
      });
      return {
        id: data.id,
        username: data.name,
        metadata: {
          name: data.name,
          handle: data.name,
          profile_pic: data.picture?.data?.url,
          pages: data.accounts?.data?.map((p) => ({ id: p.id, name: p.name })) || [],
        },
      };
    }

    if (platform === 'instagram') {
      // Instagram via Facebook Graph API - get IG business account
      const { data } = await axios.get(`${oauthConfig.apiBase}/me`, {
        headers,
        params: { fields: 'id,name,accounts{instagram_business_account{id,username,profile_picture_url,followers_count}}' },
      });
      const page = data.accounts?.data?.[0];
      const igAccount = page?.instagram_business_account;
      return {
        id: igAccount?.id || data.id,
        username: igAccount?.username || data.name,
        metadata: {
          name: data.name,
          handle: igAccount?.username ? `@${igAccount.username}` : data.name,
          profile_pic: igAccount?.profile_picture_url,
          followers: igAccount?.followers_count || 0,
          facebook_page_id: page?.id,
        },
      };
    }

    throw new Error(`Unsupported platform: ${platform}`);
  },
  'social-profile-fetch'
);

async function fetchPlatformProfile(platform, accessToken) {
  return _fetchProfile.fire(platform, accessToken);
}

// ---------- Token refresh ------------------------------------------------------

async function refreshTokenIfNeeded(account) {
  if (!account.token_expires_at) return account;

  const expiresAt = new Date(account.token_expires_at);
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > fiveMinutes) return account;

  if (!account.refresh_token) {
    await db('social_accounts').where({ id: account.id }).update({ status: 'expired' });
    throw new Error(`Token expired and no refresh token for ${account.platform}`);
  }

  const oauthConfig = OAUTH_CONFIG[account.platform];
  const { clientId, clientSecret } = getClientCredentials(account.platform);

  const params = {
    grant_type: 'refresh_token',
    refresh_token: decrypt(account.refresh_token),
    client_id: clientId,
  };

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (account.platform === 'twitter') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    params.client_secret = clientSecret;
  }

  const { data } = await axios.post(oauthConfig.tokenUrl, new URLSearchParams(params).toString(), { headers });

  const updated = {
    access_token: encrypt(data.access_token),
    token_expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
    updated_at: db.fn.now(),
  };
  if (data.refresh_token) {
    updated.refresh_token = encrypt(data.refresh_token);
  }

  await db('social_accounts').where({ id: account.id }).update(updated);

  logger.info('Social token refreshed', { platform: account.platform, accountId: account.id });
  return { ...account, access_token: encrypt(data.access_token) };
}

// ---------- Account management -------------------------------------------------

async function getAccounts(userId) {
  const accounts = await db('social_accounts')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');

  return accounts.map(sanitizeAccount);
}

async function disconnectAccount(userId, accountId) {
  const account = await db('social_accounts')
    .where({ id: accountId, user_id: userId })
    .first();

  if (!account) throw new Error('Account not found');

  // Cancel any scheduled posts for this account
  await db('scheduled_posts')
    .where({ social_account_id: accountId, status: 'scheduled' })
    .update({ status: 'draft', updated_at: db.fn.now() });

  await db('social_accounts').where({ id: accountId }).delete();

  logger.info('Social account disconnected', { platform: account.platform, accountId });
}

// ---------- Post publishing ----------------------------------------------------

const _publishPost = createCircuitBreaker(
  async (platform, accessToken, content, mediaUrls) => {
    if (platform === 'twitter') {
      const payload = { text: content };
      // Media would require upload to Twitter's media endpoint first
      // Simplified: text-only for now, media support requires multi-step upload
      const { data } = await axios.post('https://api.twitter.com/2/tweets', payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      return { platform_post_id: data.data.id, url: `https://twitter.com/i/status/${data.data.id}` };
    }

    if (platform === 'linkedin') {
      // LinkedIn UGC API
      const payload = {
        author: `urn:li:person:${accessToken._linkedinId}`, // needs account metadata
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: content },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };
      const { data } = await axios.post('https://api.linkedin.com/v2/ugcPosts', payload, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      return { platform_post_id: data.id, url: null };
    }

    if (platform === 'facebook') {
      // Post to page (requires page access token from account metadata)
      const { data } = await axios.post(
        `https://graph.facebook.com/v18.0/me/feed`,
        { message: content },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return { platform_post_id: data.id, url: null };
    }

    if (platform === 'instagram') {
      // Instagram requires media - text-only posts are not supported
      // For text posts, we'd need to create an image first
      if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('Instagram requires at least one image or video');
      }

      // Step 1: Create media container
      const { data: container } = await axios.post(
        `https://graph.facebook.com/v18.0/me/media`,
        { image_url: mediaUrls[0], caption: content },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      // Step 2: Publish
      const { data } = await axios.post(
        `https://graph.facebook.com/v18.0/me/media_publish`,
        { creation_id: container.id },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return { platform_post_id: data.id, url: null };
    }

    throw new Error(`Unsupported platform: ${platform}`);
  },
  'social-publish',
  { timeout: 30000 }
);

async function publishPost(postId) {
  const post = await db('scheduled_posts').where({ id: postId }).first();
  if (!post) throw new Error('Post not found');

  const account = await db('social_accounts').where({ id: post.social_account_id }).first();
  if (!account) throw new Error('Social account not found');

  // Refresh token if needed
  const refreshedAccount = await refreshTokenIfNeeded(account);
  const accessToken = decrypt(refreshedAccount.access_token);

  const mediaUrls = typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : post.media_urls;

  // Publish
  const result = await _publishPost.fire(post.platform, accessToken, post.content, mediaUrls);

  // Update post
  await db('scheduled_posts').where({ id: postId }).update({
    status: 'posted',
    posted_at: db.fn.now(),
    platform_post_id: result.platform_post_id,
    updated_at: db.fn.now(),
  });

  logger.info('Social post published', { postId, platform: post.platform, platformPostId: result.platform_post_id });
  return result;
}

// ---------- Engagement polling --------------------------------------------------

const _fetchEngagement = createCircuitBreaker(
  async (platform, accessToken, platformPostId) => {
    if (platform === 'twitter') {
      const { data } = await axios.get(
        `https://api.twitter.com/2/tweets/${platformPostId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { 'tweet.fields': 'public_metrics' },
        }
      );
      const m = data.data?.public_metrics || {};
      return {
        likes: m.like_count || 0,
        shares: m.retweet_count || 0,
        comments: m.reply_count || 0,
        impressions: m.impression_count || 0,
      };
    }

    if (platform === 'linkedin') {
      // LinkedIn share statistics
      return { likes: 0, shares: 0, comments: 0, impressions: 0 };
    }

    if (platform === 'facebook' || platform === 'instagram') {
      const { data } = await axios.get(
        `https://graph.facebook.com/v18.0/${platformPostId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { fields: 'likes.summary(true),comments.summary(true),shares' },
        }
      );
      return {
        likes: data.likes?.summary?.total_count || 0,
        comments: data.comments?.summary?.total_count || 0,
        shares: data.shares?.count || 0,
        impressions: 0,
      };
    }

    return { likes: 0, shares: 0, comments: 0, impressions: 0 };
  },
  'social-engagement-fetch'
);

async function fetchEngagement(postId) {
  const post = await db('scheduled_posts').where({ id: postId }).first();
  if (!post || !post.platform_post_id) return null;

  const account = await db('social_accounts').where({ id: post.social_account_id }).first();
  if (!account) return null;

  const refreshedAccount = await refreshTokenIfNeeded(account);
  const accessToken = decrypt(refreshedAccount.access_token);

  const engagement = await _fetchEngagement.fire(post.platform, accessToken, post.platform_post_id);

  await db('scheduled_posts').where({ id: postId }).update({
    engagement: JSON.stringify(engagement),
    engagement_updated_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return engagement;
}

// ---------- Post management ----------------------------------------------------

async function schedulePost({ userId, projectId, socialAccountId, content, mediaUrls, scheduledAt }) {
  const account = await db('social_accounts')
    .where({ id: socialAccountId, user_id: userId })
    .first();

  if (!account) throw new Error('Social account not found');
  if (account.status !== 'active') throw new Error(`Account is ${account.status}`);

  // Validate content length
  const limits = PLATFORM_LIMITS[account.platform];
  if (limits && content.length > limits.maxChars) {
    throw new Error(`Content exceeds ${account.platform} limit of ${limits.maxChars} characters`);
  }

  const [post] = await db('scheduled_posts')
    .insert({
      user_id: userId,
      project_id: projectId || null,
      social_account_id: socialAccountId,
      platform: account.platform,
      content,
      media_urls: JSON.stringify(mediaUrls || []),
      scheduled_at: scheduledAt || null,
      status: scheduledAt ? 'scheduled' : 'draft',
    })
    .returning('*');

  logger.info('Social post scheduled', { postId: post.id, platform: account.platform, scheduledAt });
  return post;
}

async function getPosts(userId, { projectId, status, page = 1, limit = 20 }) {
  const query = db('scheduled_posts')
    .leftJoin('social_accounts', 'scheduled_posts.social_account_id', 'social_accounts.id')
    .where('scheduled_posts.user_id', userId)
    .select(
      'scheduled_posts.*',
      'social_accounts.platform_username',
      'social_accounts.account_metadata'
    );

  if (projectId) query.andWhere('scheduled_posts.project_id', projectId);
  if (status) query.andWhere('scheduled_posts.status', status);

  const [{ count }] = await query.clone().count('scheduled_posts.id as count');
  const total = parseInt(count, 10);

  const posts = await query
    .orderBy('scheduled_posts.created_at', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    posts,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

async function updatePost(userId, postId, updates) {
  const post = await db('scheduled_posts').where({ id: postId, user_id: userId }).first();
  if (!post) throw new Error('Post not found');

  if (post.status === 'posted') throw new Error('Cannot edit a posted post');
  if (post.status === 'posting') throw new Error('Post is currently being published');

  const allowed = {};
  if (updates.content !== undefined) allowed.content = updates.content;
  if (updates.media_urls !== undefined) allowed.media_urls = JSON.stringify(updates.media_urls);
  if (updates.scheduled_at !== undefined) {
    allowed.scheduled_at = updates.scheduled_at;
    allowed.status = updates.scheduled_at ? 'scheduled' : 'draft';
  }
  allowed.updated_at = db.fn.now();

  const [updated] = await db('scheduled_posts').where({ id: postId }).update(allowed).returning('*');
  return updated;
}

async function deletePost(userId, postId) {
  const post = await db('scheduled_posts').where({ id: postId, user_id: userId }).first();
  if (!post) throw new Error('Post not found');
  if (post.status === 'posting') throw new Error('Cannot delete a post that is being published');

  await db('scheduled_posts').where({ id: postId }).delete();
}

async function publishNow(userId, postId) {
  const post = await db('scheduled_posts').where({ id: postId, user_id: userId }).first();
  if (!post) throw new Error('Post not found');
  if (post.status === 'posted') throw new Error('Post already published');

  await db('scheduled_posts').where({ id: postId }).update({ status: 'posting', updated_at: db.fn.now() });
  return post;
}

// ---------- Validation ---------------------------------------------------------

function validatePostContent(content, platform) {
  const limits = PLATFORM_LIMITS[platform];
  if (!limits) return { valid: false, error: `Unsupported platform: ${platform}` };

  if (!content || content.trim().length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }
  if (content.length > limits.maxChars) {
    return { valid: false, error: `Content exceeds ${limits.maxChars} character limit (${content.length})`, remaining: limits.maxChars - content.length };
  }

  return { valid: true, remaining: limits.maxChars - content.length };
}

// ---------- Helpers ------------------------------------------------------------

function sanitizeAccount(account) {
  const { access_token, refresh_token, ...safe } = account;
  safe.account_metadata = typeof safe.account_metadata === 'string'
    ? (() => { try { return JSON.parse(safe.account_metadata); } catch { return {}; } })()
    : safe.account_metadata || {};
  return safe;
}

module.exports = {
  PLATFORM_LIMITS,
  getOAuthUrl,
  handleOAuthCallback,
  getAccounts,
  disconnectAccount,
  publishPost,
  fetchEngagement,
  schedulePost,
  getPosts,
  updatePost,
  deletePost,
  publishNow,
  validatePostContent,
};
