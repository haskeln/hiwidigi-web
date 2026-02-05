/**
 * Checkout Demo - Multi-Vertical Orchestration MVP
 * Shows same intent executing differently across contexts
 */

import {
  Executor,
  CapabilityRegistry,
  RecipeRegistry,
  Orchestrator,
  ALL_CAPABILITIES,
  ALL_RECIPES,
} from '../../packages/runtime/src';
import type { ConstraintContext } from '../../packages/runtime/src';
import { InMemoryDataStore } from '../../packages/protocols/datastore/src';

/**
 * Demo Contexts
 */

// 🇩🇪 German Restaurant (online, card payment, fiscal compliance)
const germanRestaurantContext: ConstraintContext = {
  core: {
    country: 'DE',
    currency: 'EUR',
    store_type: 'restaurant',
    payment_method: 'card',
    online_state: 'online',
    inventory_mode: 'realtime',
    device_type: 'pos',
  },
};

// 🇮🇩 Indonesian Retail (offline, cash payment, batch inventory)
const indonesianRetailContext: ConstraintContext = {
  core: {
    country: 'ID',
    currency: 'IDR',
    tax_regime: 'PPN',
    store_type: 'retail',
    payment_method: 'cash',
    online_state: 'offline',
    inventory_mode: 'batch',
    device_type: 'pos',
  },
};

// 🇺🇸 US Cloud Kitchen (online, card payment, no inventory)
const usCloudKitchenContext: ConstraintContext = {
  core: {
    country: 'US',
    currency: 'USD',
    store_type: 'restaurant',
    payment_method: 'card',
    online_state: 'online',
    inventory_mode: 'none',
    device_type: 'web',
  },
};

/**
 * Run demo for a specific context
 */
async function runCheckoutDemo(
  name: string,
  context: ConstraintContext,
  params: any
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Context:`, JSON.stringify(context.core, null, 2));

  // Setup
  const dataStore = new InMemoryDataStore();
  const executor = new Executor(dataStore, 'system');

  const capabilityRegistry = new CapabilityRegistry();
  capabilityRegistry.registerAll(ALL_CAPABILITIES);

  const recipeRegistry = new RecipeRegistry();
  recipeRegistry.registerAll(ALL_RECIPES);

  const orchestrator = new Orchestrator(capabilityRegistry, recipeRegistry);

  // Execute checkout
  try {
    const result = await orchestrator.orchestrate('checkout', params, context, executor);

    console.log(`\n✅ Orchestration: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`\n📊 Selected Capabilities:`);

    result.trace.selections.forEach((selection) => {
      const status = selection.selected ? '✅' : '❌';
      console.log(`  ${status} ${selection.vertical}: ${selection.capabilityId || 'NONE'}`);
      if (selection.explanation.length > 0) {
        selection.explanation.forEach((exp) => console.log(`     - ${exp}`));
      }
    });

    console.log(`\n🔄 Executions:`);
    result.trace.executions.forEach((execution) => {
      const status = execution.success ? '✅' : '❌';
      console.log(`  ${status} ${execution.vertical} (${execution.capabilityId})`);
      if (execution.error) {
        console.log(`     Error: ${execution.error}`);
      }
    });

    if (result.errors.size > 0) {
      console.log(`\n⚠️  Errors:`);
      result.errors.forEach((error, vertical) => {
        console.log(`  - ${vertical}: ${error}`);
      });
    }

    console.log(`\n📋 Results Summary:`);
    console.log(`  - Total verticals: ${result.recipe.requiredVerticals.length}`);
    console.log(`  - Successful: ${result.results.size}`);
    console.log(`  - Failed: ${result.errors.size}`);
  } catch (error: any) {
    console.error(`\n❌ Orchestration failed:`, error.message);
  }
}

/**
 * Main demo runner
 */
export async function runAllDemos(): Promise<void> {
  console.log('\n🎪 HIWI ORCHESTRATION MVP DEMO');
  console.log('Showing how ONE intent (checkout) executes differently across contexts\n');

  const orderParams = {
    amount: 100,
    items: [
      { id: 'item1', name: 'Product A', quantity: 2, price: 30 },
      { id: 'item2', name: 'Product B', quantity: 1, price: 40 },
    ],
    customerId: 'customer_123',
    email: 'customer@example.com',
    phone: '+1234567890',
  };

  // Run all three scenarios
  await runCheckoutDemo('🇩🇪 German Restaurant', germanRestaurantContext, orderParams);
  await runCheckoutDemo('🇮🇩 Indonesian Retail', indonesianRetailContext, orderParams);
  await runCheckoutDemo('🇺🇸 US Cloud Kitchen', usCloudKitchenContext, orderParams);

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ All demos complete!');
  console.log(`${'='.repeat(60)}\n`);
}

// Run if executed directly
if (require.main === module) {
  runAllDemos().catch(console.error);
}
