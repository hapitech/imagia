exports.up = async function (knex) {
  // Add Kimi K2.5 as the new default code model (idempotent)
  const exists = await knex('llm_models')
    .where({ provider: 'fireworks', model_id: 'accounts/fireworks/models/kimi-k2p5' })
    .first();

  if (!exists) {
    await knex('llm_models').insert({
      provider: 'fireworks',
      model_id: 'accounts/fireworks/models/kimi-k2p5',
      display_name: 'Kimi K2.5',
      capabilities: JSON.stringify(['code', 'text', 'reasoning']),
      pricing_input: 0.60,
      pricing_output: 3.00,
      context_window: 262144,
      quality_score: 96,
      is_active: true,
      is_default: true,
      default_for: 'code',
      notes: 'Moonshot AI flagship. 1T MoE (32B active). #2 AI Intelligence Index. Strong agentic + coding.',
      last_verified_at: knex.fn.now(),
    });
  }

  // Unset Qwen3 Coder as default for code (keep it active as an option)
  await knex('llm_models')
    .where({ model_id: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct' })
    .update({ is_default: false, default_for: null, updated_at: knex.fn.now() });
};

exports.down = async function (knex) {
  // Remove Kimi K2.5
  await knex('llm_models')
    .where({ model_id: 'accounts/fireworks/models/kimi-k2p5' })
    .del();

  // Restore Qwen3 Coder as default
  await knex('llm_models')
    .where({ model_id: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct' })
    .update({ is_default: true, default_for: 'code', updated_at: knex.fn.now() });
};
