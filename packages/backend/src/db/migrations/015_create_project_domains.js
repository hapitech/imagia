exports.up = function (knex) {
  return knex.schema.createTable('project_domains', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');

    // Domain info
    table.string('domain_type', 20).notNullable().defaultTo('subdomain');
    // 'subdomain' (auto-assigned *.imagia.net) or 'custom' (user-provided)
    table.text('domain').notNullable().unique();
    // e.g. "myapp.imagia.net" or "app.usersite.com"
    table.string('subdomain_slug', 63).unique();
    // e.g. "myapp" — only set for subdomain type
    table.text('target_url');
    // Railway URL this domain routes to

    // Cloudflare identifiers for cleanup
    table.text('cloudflare_record_id');
    table.text('cloudflare_hostname_id');

    // SSL/verification status
    table.string('ssl_status', 20).notNullable().defaultTo('pending');
    // 'pending' | 'active' | 'error'
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.timestamp('verified_at');

    table.timestamps(true, true);

    table.index('project_id');
    table.index('subdomain_slug');
    table.index(['project_id', 'is_primary']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('project_domains');
};
