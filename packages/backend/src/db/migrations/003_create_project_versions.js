exports.up = function (knex) {
  return knex.schema.createTable('project_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.jsonb('snapshot').notNullable();
    table.text('prompt_summary');
    table.text('diff_summary');
    table.string('git_commit_sha', 40);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['project_id', 'version_number']);
    table.index(['project_id', 'version_number']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('project_versions');
};
