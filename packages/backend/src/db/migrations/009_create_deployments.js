exports.up = function (knex) {
  return knex.schema.createTable('deployments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('version_id').references('id').inTable('project_versions').onDelete('SET NULL');

    // Railway identifiers
    table.string('railway_project_id', 255);
    table.string('railway_service_id', 255);
    table.string('railway_deployment_id', 255);
    table.string('railway_environment_id', 255);

    // Status tracking
    table.string('status', 50).notNullable().defaultTo('pending');
    // pending | queued | building | deploying | success | failed | cancelled
    table.text('url');
    table.text('custom_domain');

    // Environment variables (encrypted JSONB)
    table.text('environment_variables'); // encrypted JSON string

    // Timing
    table.timestamp('deployment_started_at');
    table.timestamp('deployment_completed_at');

    // Error tracking
    table.text('error_message');
    table.text('logs');

    // Cost
    table.decimal('cost', 10, 6).defaultTo(0);

    table.timestamps(true, true);

    table.index('project_id');
    table.index('status');
    table.index(['project_id', 'created_at']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('deployments');
};
