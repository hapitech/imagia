exports.up = function (knex) {
  return knex.schema.createTable('project_secrets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.string('key', 255).notNullable();
    table.text('encrypted_value').notNullable();
    table.string('type', 50).defaultTo('custom'); // api_key, database_url, auth_token, webhook_secret, custom
    table.string('description', 500);
    table.timestamps(true, true);

    table.unique(['project_id', 'key']);
    table.index('project_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('project_secrets');
};
