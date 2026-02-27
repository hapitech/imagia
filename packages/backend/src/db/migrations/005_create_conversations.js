exports.up = function (knex) {
  return knex.schema
    .createTable('conversations', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      table.string('title', 255);
      table.string('status', 50).defaultTo('active');
      table.integer('message_count').defaultTo(0);
      table.timestamps(true, true);

      table.index('project_id');
    })
    .then(() => {
      return knex.schema.createTable('messages', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
        table.string('role', 20).notNullable();
        table.text('content').notNullable();
        table.jsonb('metadata').defaultTo('{}');
        table.uuid('prompt_log_id');
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.index(['conversation_id', 'created_at']);
      });
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('messages')
    .then(() => knex.schema.dropTableIfExists('conversations'));
};
