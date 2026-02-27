exports.up = function (knex) {
  return knex.schema.createTable('marketing_assets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');

    // Asset type: screenshot, video_demo, landing_page, social_post, ad_copy, email_template
    table.string('asset_type', 50).notNullable();

    // Content — HTML/copy/text body for generated content
    table.text('content');

    // File URL — S3 or local path for binary assets (screenshots, video)
    table.text('file_url');
    table.text('thumbnail_url');

    // Metadata (dimensions, platform, variant info, etc.)
    table.jsonb('metadata').defaultTo('{}');

    // Status: pending | generating | completed | failed
    table.string('status', 30).notNullable().defaultTo('pending');

    // Cost tracking
    table.decimal('generation_cost', 10, 6).defaultTo(0);
    table.uuid('prompt_log_id').references('id').inTable('prompt_logs').onDelete('SET NULL');

    table.timestamps(true, true);

    table.index('project_id');
    table.index(['project_id', 'asset_type']);
    table.index('status');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('marketing_assets');
};
