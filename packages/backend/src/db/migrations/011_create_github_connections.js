exports.up = function (knex) {
  return knex.schema.createTable('github_connections', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');

    // Repo info
    table.string('repo_full_name', 500).notNullable(); // owner/repo
    table.string('default_branch', 255).defaultTo('main');
    table.string('last_commit_sha', 100);

    // Sync state
    table.string('sync_status', 30).defaultTo('synced');
    // synced | ahead | behind | diverged | error
    table.timestamp('last_synced_at');
    table.text('sync_error');

    table.timestamps(true, true);

    table.unique('project_id');
    table.index('repo_full_name');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('github_connections');
};
