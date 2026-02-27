exports.up = function (knex) {
  return knex.schema.createTable('projects', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('status', 50).defaultTo('draft');
    table.string('app_type', 100);
    table.jsonb('settings').defaultTo('{}');

    // Cost tracking
    table.decimal('estimated_cost', 10, 6).defaultTo(0);
    table.jsonb('cost_breakdown').defaultTo('{"llm": 0, "deployment": 0, "storage": 0}');

    // Build progress
    table.integer('build_progress').defaultTo(0);
    table.string('current_build_stage', 100);
    table.text('error_message');

    // Deployment
    table.text('deployment_url');
    table.string('railway_project_id', 255);
    table.string('railway_service_id', 255);

    // GitHub
    table.text('github_repo_url');
    table.string('github_repo_owner', 255);
    table.string('github_repo_name', 255);
    table.string('github_branch', 255);

    // Context memory for the app builder
    table.text('context_md');

    // Timing
    table.timestamp('queued_at');
    table.timestamp('build_started_at');
    table.timestamp('deployed_at');

    table.timestamps(true, true);

    table.index('user_id');
    table.index('status');
    table.index(['user_id', 'status', 'created_at']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('projects');
};
