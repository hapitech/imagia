exports.up = function (knex) {
  return knex.schema.createTable('social_accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();

    table.string('platform', 50).notNullable(); // twitter, linkedin, instagram, facebook
    table.string('platform_account_id', 255);
    table.string('platform_username', 255);

    // Tokens (encrypted at application layer)
    table.text('access_token');
    table.text('refresh_token');
    table.timestamp('token_expires_at');

    // Account info
    table.jsonb('account_metadata').defaultTo('{}'); // name, handle, profile_pic, follower_count, etc.
    table.string('status', 50).defaultTo('active'); // active, expired, revoked, error

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index(['user_id', 'platform']);
    table.unique(['user_id', 'platform', 'platform_account_id']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('social_accounts');
};
