exports.up = function (knex) {
  return knex.schema.createTable('waitlist_entries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable().unique();
    table.string('name', 255);
    table.string('company', 255);
    table.text('use_case');
    table.string('status', 50).defaultTo('pending');
    table.timestamp('invited_at');
    table.timestamps(true, true);

    table.index('status');
    table.index('created_at');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('waitlist_entries');
};
