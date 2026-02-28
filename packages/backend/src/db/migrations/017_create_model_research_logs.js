exports.up = function (knex) {
  return knex.schema.createTable('model_research_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.timestamp('run_at').defaultTo(knex.fn.now());
    table.integer('models_checked').defaultTo(0);
    table.jsonb('new_models_found').defaultTo('[]');
    table.jsonb('pricing_changes').defaultTo('[]');
    table.jsonb('deprecated_models').defaultTo('[]');
    table.text('recommendations');
    table.jsonb('raw_response');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('run_at');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('model_research_logs');
};
