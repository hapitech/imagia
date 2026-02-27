const { db } = require('../config/database');
const logger = require('../config/logger');

class ContextService {
  /**
   * Read the context_md for a project.
   * @param {string} projectId
   * @returns {Promise<string|null>}
   */
  async getContext(projectId) {
    try {
      const project = await db('projects')
        .where('id', projectId)
        .select('context_md')
        .first();

      if (!project) {
        logger.warn('Project not found for context retrieval', { projectId });
        return null;
      }

      return project.context_md || '';
    } catch (error) {
      logger.error('Failed to get project context', {
        projectId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update the context_md for a project (full replacement).
   * @param {string} projectId
   * @param {string} newContext
   */
  async updateContext(projectId, newContext) {
    try {
      const updated = await db('projects')
        .where('id', projectId)
        .update({
          context_md: newContext,
          updated_at: db.fn.now(),
        });

      if (!updated) {
        logger.warn('Project not found for context update', { projectId });
        return false;
      }

      logger.info('Project context updated', {
        projectId,
        contextLength: newContext.length,
      });

      return true;
    } catch (error) {
      logger.error('Failed to update project context', {
        projectId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Build a context.md from conversation history and project state using the LLM router.
   * Uses task_type 'code-generation' to leverage Claude for summarization.
   *
   * @param {string} projectId
   * @returns {Promise<string>} The generated context markdown
   */
  async buildContextFromHistory(projectId) {
    try {
      // Gather project data
      const project = await db('projects')
        .where('id', projectId)
        .first();

      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      // Gather conversation history
      const messages = await db('messages')
        .where('project_id', projectId)
        .orderBy('created_at', 'asc')
        .select('role', 'content', 'created_at')
        .limit(100);

      // Gather project files
      const files = await db('project_files')
        .where('project_id', projectId)
        .select('path', 'language')
        .limit(50);

      // Build the prompt for context generation
      const conversationSummary = messages
        .map((m) => `[${m.role}]: ${(m.content || '').substring(0, 500)}`)
        .join('\n');

      const fileList = files
        .map((f) => `- ${f.path} (${f.language || 'unknown'})`)
        .join('\n');

      const prompt = `You are summarizing the state of a software project for use as persistent context.

Project: ${project.name || 'Untitled'}
Description: ${project.description || 'No description'}
Tech Stack: ${project.tech_stack || 'Not specified'}
Framework: ${project.framework || 'Not specified'}
Status: ${project.status || 'unknown'}

Files in project:
${fileList || 'No files yet'}

Recent conversation history:
${conversationSummary || 'No conversation history'}

Generate a structured context.md that summarizes:
1. **App Description** - What this app does
2. **Tech Stack** - Languages, frameworks, and tools being used
3. **Key Files** - Important files and their purposes
4. **Current State** - What has been built so far
5. **Known Issues** - Any bugs or problems mentioned in conversations

Format the output as clean markdown. Be concise but thorough.`;

      // Lazy-require llmRouter to avoid circular dependency
      const llmRouter = require('./llmRouter');

      const result = await llmRouter.route('code-generation', {
        systemMessage: 'You are a technical documentation assistant. Generate concise project context summaries.',
        prompt,
        maxTokens: 2048,
        temperature: 0.3,
      });

      const contextMd = result.content;

      // Save the generated context
      await this.updateContext(projectId, contextMd);

      logger.info('Context built from history', {
        projectId,
        contextLength: contextMd.length,
        model: result.model,
      });

      return contextMd;
    } catch (error) {
      logger.error('Failed to build context from history', {
        projectId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Append a new section to the existing context_md.
   * @param {string} projectId
   * @param {string} section - Section heading (e.g. 'Known Issues')
   * @param {string} content - Content to append under the section
   */
  async appendToContext(projectId, section, content) {
    try {
      const currentContext = await this.getContext(projectId);

      if (currentContext === null) {
        logger.warn('Project not found for context append', { projectId });
        return false;
      }

      const sectionHeader = `\n\n## ${section}\n`;
      const newContext = currentContext + sectionHeader + content;

      await this.updateContext(projectId, newContext);

      logger.info('Context section appended', {
        projectId,
        section,
        addedLength: sectionHeader.length + content.length,
      });

      return true;
    } catch (error) {
      logger.error('Failed to append to project context', {
        projectId,
        section,
        error: error.message,
      });
      throw error;
    }
  }
}

// Singleton instance
const contextService = new ContextService();

module.exports = contextService;
