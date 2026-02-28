exports.up = async function (knex) {
  await knex.schema.createTable('llm_models', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('provider', 50).notNullable(); // fireworks, anthropic, openai
    table.string('model_id', 255).notNullable(); // API model identifier
    table.string('display_name', 100).notNullable(); // Human-friendly name
    table.jsonb('capabilities').notNullable().defaultTo('[]'); // ["code","text","image","reasoning"]
    table.decimal('pricing_input', 10, 4).defaultTo(0); // per million tokens
    table.decimal('pricing_output', 10, 4).defaultTo(0); // per million tokens
    table.decimal('pricing_per_image', 10, 4).nullable(); // for image models
    table.integer('context_window').defaultTo(0);
    table.integer('quality_score').defaultTo(50); // 1-100
    table.boolean('is_active').defaultTo(true);
    table.boolean('is_default').defaultTo(false);
    table.string('default_for', 50).nullable(); // capability this model is default for: code, text, image
    table.text('notes');
    table.timestamp('last_verified_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['provider', 'model_id']);
    table.index('is_active');
    table.index('is_default');
  });

  // Seed initial models
  await knex('llm_models').insert([
    {
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
      display_name: 'Qwen3 Coder 480B',
      capabilities: JSON.stringify(['code', 'reasoning']),
      pricing_input: 0.45,
      pricing_output: 1.80,
      context_window: 262144,
      quality_score: 92,
      is_active: true,
      is_default: true,
      default_for: 'code',
      notes: 'Best code model on Fireworks. MoE 480B with 35B active params.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/deepseek-v3',
      display_name: 'DeepSeek V3',
      capabilities: JSON.stringify(['code', 'text', 'reasoning']),
      pricing_input: 0.56,
      pricing_output: 1.68,
      context_window: 163840,
      quality_score: 88,
      is_active: true,
      is_default: false,
      notes: 'Strong general reasoning. 671B MoE. Good for complex tasks.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      display_name: 'Llama 3.3 70B',
      capabilities: JSON.stringify(['code', 'text', 'reasoning']),
      pricing_input: 0.90,
      pricing_output: 0.90,
      context_window: 131072,
      quality_score: 78,
      is_active: true,
      is_default: false,
      notes: 'Good balance of quality and speed. Budget option.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'openai',
      model_id: 'gpt-4o',
      display_name: 'GPT-4o',
      capabilities: JSON.stringify(['code', 'text', 'reasoning']),
      pricing_input: 2.50,
      pricing_output: 10.00,
      context_window: 128000,
      quality_score: 85,
      is_active: true,
      is_default: true,
      default_for: 'text',
      notes: 'Strong for marketing copy and general content.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'anthropic',
      model_id: 'claude-sonnet-4-6',
      display_name: 'Claude Sonnet 4.6',
      capabilities: JSON.stringify(['code', 'text', 'reasoning']),
      pricing_input: 3.00,
      pricing_output: 15.00,
      context_window: 200000,
      quality_score: 95,
      is_active: true,
      is_default: false,
      notes: 'Premium code model. Requires ANTHROPIC_API_KEY.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/flux-1-dev-fp8',
      display_name: 'FLUX.1 Dev',
      capabilities: JSON.stringify(['image']),
      pricing_input: 0,
      pricing_output: 0,
      pricing_per_image: 0.014,
      context_window: 0,
      quality_score: 90,
      is_active: true,
      is_default: true,
      default_for: 'image',
      notes: 'High quality image generation. ~28 steps, $0.014/image.',
      last_verified_at: knex.fn.now(),
    },
    {
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/flux-1-schnell-fp8',
      display_name: 'FLUX.1 Schnell',
      capabilities: JSON.stringify(['image']),
      pricing_input: 0,
      pricing_output: 0,
      pricing_per_image: 0.001,
      context_window: 0,
      quality_score: 75,
      is_active: true,
      is_default: false,
      notes: 'Fast image generation. 4 steps, $0.001/image. Good for previews.',
      last_verified_at: knex.fn.now(),
    },
  ]);
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('llm_models');
};
