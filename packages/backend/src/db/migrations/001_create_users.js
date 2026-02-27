exports.up = function (knex) {
  return knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('clerk_id', 255).unique().notNullable();
    table.string('email', 255).unique().notNullable();
    table.string('name', 255);
    table.text('avatar_url');
    table.string('plan', 50).defaultTo('free');
    table.jsonb('usage_limits').defaultTo('{}');
    table.text('github_access_token'); // encrypted
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);

    table.index('clerk_id');
    table.index('email');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('users');
};
