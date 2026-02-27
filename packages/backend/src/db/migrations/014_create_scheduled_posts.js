exports.up = function (knex) {
  return knex.schema.createTable('scheduled_posts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('social_account_id').references('id').inTable('social_accounts').onDelete('CASCADE').notNullable();
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();

    // Content
    table.text('content').notNullable();
    table.jsonb('media_urls').defaultTo('[]'); // array of image/video URLs
    table.string('platform', 50).notNullable(); // denormalized for quick queries

    // Scheduling
    table.timestamp('scheduled_at');
    table.timestamp('posted_at');

    // Status
    table.string('status', 50).defaultTo('draft'); // draft, scheduled, posting, posted, failed
    table.string('platform_post_id', 255);
    table.text('error_message');

    // Engagement tracking
    table.jsonb('engagement').defaultTo('{}'); // likes, shares, comments, impressions, clicks
    table.timestamp('engagement_updated_at');

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index(['user_id', 'status']);
    table.index(['project_id', 'created_at']);
    table.index(['social_account_id', 'status']);
    table.index(['status', 'scheduled_at']); // for the posting cron
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('scheduled_posts');
};
