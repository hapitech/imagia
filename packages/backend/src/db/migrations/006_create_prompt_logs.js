exports.up = function (knex) {
  return knex.schema.createTable('prompt_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('SET NULL');
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');

    // Request
    table.string('provider', 50).notNullable();
    table.string('model', 255).notNullable();
    table.string('task_type', 100).notNullable();
    table.text('system_message');
    table.text('prompt').notNullable();

    // Response
    table.text('response');
    table.string('response_format', 50);

    // Instrumentation
    table.integer('input_tokens').defaultTo(0);
    table.integer('output_tokens').defaultTo(0);
    table.integer('total_tokens').defaultTo(0);
    table.decimal('input_cost', 10, 8).defaultTo(0);
    table.decimal('output_cost', 10, 8).defaultTo(0);
    table.decimal('total_cost', 10, 8).defaultTo(0);
    table.integer('latency_ms').defaultTo(0);

    // Status
    table.string('status', 50).defaultTo('success');
    table.text('error_message');
    table.boolean('cache_hit').defaultTo(false);
    table.integer('retry_count').defaultTo(0);

    // Correlation
    table.string('correlation_id', 255);

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['project_id', 'created_at']);
    table.index(['user_id', 'created_at']);
    table.index(['provider', 'model', 'created_at']);
    table.index(['task_type', 'created_at']);
    table.index('created_at');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('prompt_logs');
};
