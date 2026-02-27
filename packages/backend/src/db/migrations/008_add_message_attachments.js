exports.up = function (knex) {
  return knex.schema.createTable('message_attachments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('message_id').references('id').inTable('messages').onDelete('CASCADE'); // nullable until linked
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');

    table.string('filename', 500).notNullable();
    table.string('mime_type', 255).notNullable();
    table.integer('file_size').notNullable();
    table.string('category', 20).notNullable(); // 'image', 'audio', 'video'

    // Storage - for now we store a local/S3 URL. In Phase 3 we'll use S3.
    table.text('storage_url').notNullable();
    table.text('thumbnail_url');

    table.timestamps(true, true);

    table.index('message_id');
    table.index('project_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('message_attachments');
};
