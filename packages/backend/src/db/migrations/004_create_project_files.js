exports.up = function (knex) {
  return knex.schema.createTable('project_files', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('version_id').references('id').inTable('project_versions');
    table.string('file_path', 1000).notNullable();
    table.text('content').notNullable();
    table.string('language', 50);
    table.integer('file_size');
    table.string('checksum', 64);
    table.timestamps(true, true);

    table.index('project_id');
    table.index('version_id');
    table.index(['project_id', 'file_path']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('project_files');
};
