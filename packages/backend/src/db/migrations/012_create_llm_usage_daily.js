exports.up = function (knex) {
  return knex.schema.createTable('llm_usage_daily', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.date('date').notNullable();
    table.string('provider', 50).notNullable();
    table.string('model', 255).notNullable();

    table.integer('request_count').defaultTo(0);
    table.integer('total_input_tokens').defaultTo(0);
    table.integer('total_output_tokens').defaultTo(0);
    table.decimal('total_cost', 12, 8).defaultTo(0);
    table.decimal('avg_latency_ms', 10, 2).defaultTo(0);
    table.integer('error_count').defaultTo(0);
    table.integer('cache_hit_count').defaultTo(0);

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'date', 'provider', 'model']);
    table.index(['user_id', 'date']);
    table.index('date');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('llm_usage_daily');
};
