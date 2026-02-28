const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');
const cloudflareService = require('../services/cloudflareService');

const router = express.Router();
router.use(requireUser);

const customDomainSchema = Joi.object({
  domain: Joi.string().hostname().required(),
});

// Helper: verify project ownership
async function verifyOwnership(projectId, userId) {
  return db('projects').where({ id: projectId, user_id: userId }).first();
}

// GET /:projectId/domains - List all domains for a project
router.get('/:projectId/domains', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const domains = await db('project_domains')
      .where({ project_id: req.params.projectId })
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc');

    res.json({ domains });
  } catch (err) {
    next(err);
  }
});

// POST /:projectId/domains/custom - Add a custom domain
router.post('/:projectId/domains/custom', validate(customDomainSchema), async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { domain } = req.body;

    // Check if domain already exists
    const existing = await db('project_domains').where({ domain }).first();
    if (existing) {
      return res.status(409).json({ error: 'Domain is already in use' });
    }

    // Get the project's subdomain to use as routing target
    const subdomainEntry = await db('project_domains')
      .where({ project_id: req.params.projectId, domain_type: 'subdomain' })
      .first();

    const targetUrl = subdomainEntry?.target_url || project.deployment_url;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Project has not been deployed yet' });
    }

    // Create Custom Hostname in Cloudflare for SSL provisioning
    let hostnameResult;
    try {
      hostnameResult = await cloudflareService.createCustomHostname(domain);
    } catch (cfError) {
      return res.status(502).json({
        error: 'Failed to configure custom domain with Cloudflare',
        detail: cfError.message,
      });
    }

    // Also write to KV so the Worker can route this custom domain
    const slug = subdomainEntry?.subdomain_slug;
    if (slug) {
      await cloudflareService.putKvEntry(domain, targetUrl);
    }

    // Store in database
    const [domainRecord] = await db('project_domains')
      .insert({
        project_id: req.params.projectId,
        domain_type: 'custom',
        domain,
        target_url: targetUrl,
        cloudflare_hostname_id: hostnameResult?.id || null,
        ssl_status: 'pending',
        is_primary: false,
      })
      .returning('*');

    res.status(201).json({
      domain: domainRecord,
      instructions: {
        message: `Point a CNAME record from "${domain}" to "imagia.net" in your DNS provider.`,
        record_type: 'CNAME',
        record_name: domain,
        record_value: 'imagia.net',
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /:projectId/domains/:domainId - Remove a domain
router.delete('/:projectId/domains/:domainId', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const domainRecord = await db('project_domains')
      .where({ id: req.params.domainId, project_id: req.params.projectId })
      .first();

    if (!domainRecord) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Don't allow deleting the primary subdomain
    if (domainRecord.domain_type === 'subdomain' && domainRecord.is_primary) {
      return res.status(400).json({ error: 'Cannot delete the primary subdomain' });
    }

    // Cleanup Cloudflare resources
    if (domainRecord.cloudflare_hostname_id) {
      try {
        await cloudflareService.deleteCustomHostname(domainRecord.cloudflare_hostname_id);
      } catch (cfError) {
        // Log but don't block deletion
        console.error('Failed to delete custom hostname:', cfError.message);
      }
    }

    if (domainRecord.cloudflare_record_id) {
      try {
        await cloudflareService.deleteDnsRecord(domainRecord.cloudflare_record_id);
      } catch (cfError) {
        console.error('Failed to delete DNS record:', cfError.message);
      }
    }

    // Remove KV entry for custom domains
    if (domainRecord.domain_type === 'custom') {
      try {
        await cloudflareService.deleteKvEntry(domainRecord.domain);
      } catch (cfError) {
        console.error('Failed to delete KV entry:', cfError.message);
      }
    }

    await db('project_domains').where({ id: req.params.domainId }).del();

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /:projectId/domains/:domainId/status - Check domain SSL status
router.get('/:projectId/domains/:domainId/status', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const domainRecord = await db('project_domains')
      .where({ id: req.params.domainId, project_id: req.params.projectId })
      .first();

    if (!domainRecord) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // For subdomains, SSL is always active (Cloudflare wildcard)
    if (domainRecord.domain_type === 'subdomain') {
      return res.json({
        domain: domainRecord.domain,
        ssl_status: 'active',
        verified: true,
      });
    }

    // For custom domains, check Cloudflare Custom Hostname status
    if (!domainRecord.cloudflare_hostname_id) {
      return res.json({
        domain: domainRecord.domain,
        ssl_status: domainRecord.ssl_status,
        verified: !!domainRecord.verified_at,
      });
    }

    try {
      const cfStatus = await cloudflareService.getCustomHostname(domainRecord.cloudflare_hostname_id);
      const sslStatus = cfStatus.ssl?.status === 'active' ? 'active' : 'pending';
      const verified = cfStatus.status === 'active';

      // Update local record if status changed
      if (sslStatus !== domainRecord.ssl_status || (verified && !domainRecord.verified_at)) {
        await db('project_domains').where({ id: domainRecord.id }).update({
          ssl_status: sslStatus,
          verified_at: verified ? db.fn.now() : domainRecord.verified_at,
          updated_at: db.fn.now(),
        });
      }

      res.json({
        domain: domainRecord.domain,
        ssl_status: sslStatus,
        verified,
        cloudflare_status: cfStatus.status,
        ssl_detail: cfStatus.ssl?.status,
      });
    } catch (cfError) {
      res.json({
        domain: domainRecord.domain,
        ssl_status: domainRecord.ssl_status,
        verified: !!domainRecord.verified_at,
        error: 'Failed to fetch live status from Cloudflare',
      });
    }
  } catch (err) {
    next(err);
  }
});

// POST /:projectId/domains/:domainId/verify - Trigger re-verification
router.post('/:projectId/domains/:domainId/verify', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const domainRecord = await db('project_domains')
      .where({ id: req.params.domainId, project_id: req.params.projectId })
      .first();

    if (!domainRecord) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    if (domainRecord.domain_type === 'subdomain') {
      return res.json({ message: 'Subdomain verification not needed', ssl_status: 'active' });
    }

    if (!domainRecord.cloudflare_hostname_id) {
      return res.status(400).json({ error: 'No Cloudflare hostname configured for this domain' });
    }

    // Re-check status from Cloudflare
    const cfStatus = await cloudflareService.getCustomHostname(domainRecord.cloudflare_hostname_id);
    const sslStatus = cfStatus.ssl?.status === 'active' ? 'active' : 'pending';
    const verified = cfStatus.status === 'active';

    await db('project_domains').where({ id: domainRecord.id }).update({
      ssl_status: sslStatus,
      verified_at: verified ? db.fn.now() : domainRecord.verified_at,
      updated_at: db.fn.now(),
    });

    res.json({
      domain: domainRecord.domain,
      ssl_status: sslStatus,
      verified,
      cloudflare_status: cfStatus.status,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
