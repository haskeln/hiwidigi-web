import { Executor } from '../../packages/runtime/src/executor';
import { ExecutionContext } from '../../packages/runtime/src/context';
import { Orchestrator } from '../../packages/runtime/src/orchestrator';
import { CapabilityRegistry } from '../../packages/runtime/src/capability-registry';
import { RecipeRegistry } from '../../packages/runtime/src/recipe';
import { EventBus } from '../../packages/events/src/event-bus';
import { EventLog, createEventLogHandler } from '../../packages/logs/src/event-log';
import { InMemoryDataStore } from '../../packages/protocols/datastore/src/in-memory';
import { MockBridgeAdapter } from '../../packages/hiwibridge/src/adapters/mock-adapter';
import type { Capability } from '../../packages/runtime/src/capability-registry';
import {
  stripePaymentCapability,
  walletPaymentCapability,
  emailNotificationCapability,
  indonesianPPNCapability,
} from '../../packages/runtime/src/capabilities';

const euVatComplianceCapability: Capability = {
  id: 'eu_vat_compliance',
  name: 'EU VAT Compliance',
  vertical: 'compliance',
  verbs: ['validate', 'report'],
  constraints: [
    { op: 'in', key: 'core.country', values: ['DE', 'FR', 'NL', 'ES', 'IT'] },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'Avalara', priority: 12 },
  execute: async (executor, params) => {
    await executor.trace('capability.vat', 'EU VAT check', { orderId: params.orderId });
    return { success: true, regime: 'EU_VAT' };
  },
};

const logisticsFedexPreferred: Capability = {
  id: 'logistics_fedex_pref',
  name: 'FedEx Priority (Preferred)',
  vertical: 'logistics',
  verbs: ['ship'],
  constraints: [
    { op: 'eq', key: 'ext.preferred_logistics', value: 'fedex' },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'FedEx', priority: 100 },
  execute: async (executor, params) => {
    await executor.trace('capability.logistics', 'FedEx priority shipment', { orderId: params.orderId });
    return { success: true, carrier: 'FedEx', service: 'Priority' };
  },
};

const logisticsDhl: Capability = {
  id: 'logistics_dhl',
  name: 'DHL EU',
  vertical: 'logistics',
  verbs: ['ship'],
  constraints: [
    { op: 'in', key: 'core.country', values: ['DE', 'FR', 'NL', 'ES', 'IT'] },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'DHL', priority: 20 },
  execute: async (executor, params) => {
    await executor.trace('capability.logistics', 'DHL shipment', { orderId: params.orderId });
    return { success: true, carrier: 'DHL', service: 'EU' };
  },
};

const logisticsLocal: Capability = {
  id: 'logistics_local',
  name: 'Local Courier',
  vertical: 'logistics',
  verbs: ['ship'],
  constraints: [
    { op: 'eq', key: 'core.country', value: 'ID' },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'Local', priority: 10 },
  execute: async (executor, params) => {
    await executor.trace('capability.logistics', 'Local courier', { orderId: params.orderId });
    return { success: true, carrier: 'Local', service: 'SameDay' };
  },
};

const crmSalesforce: Capability = {
  id: 'crm_salesforce',
  name: 'Salesforce Sync',
  vertical: 'crm',
  verbs: ['sync'],
  constraints: [
    { op: 'in', key: 'ext.customer_tier', values: ['enterprise'] },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'Salesforce', priority: 12 },
  execute: async (executor, params) => {
    await executor.trace('capability.crm', 'Salesforce sync', { customerId: params.customer?.id });
    return { success: true, crm: 'Salesforce' };
  },
};

const crmHubspot: Capability = {
  id: 'crm_hubspot',
  name: 'HubSpot Sync',
  vertical: 'crm',
  verbs: ['sync'],
  constraints: [
    { op: 'in', key: 'ext.customer_tier', values: ['startup', 'mid'] },
    { op: 'eq', key: 'core.online_state', value: 'online' },
  ],
  metadata: { provider: 'HubSpot', priority: 10 },
  execute: async (executor, params) => {
    await executor.trace('capability.crm', 'HubSpot sync', { customerId: params.customer?.id });
    return { success: true, crm: 'HubSpot' };
  },
};

const inventoryRealtime: Capability = {
  id: 'inventory_realtime',
  name: 'Realtime Inventory',
  vertical: 'inventory',
  verbs: ['reserve'],
  constraints: [{ op: 'eq', key: 'core.online_state', value: 'online' }],
  metadata: { provider: 'Realtime', priority: 10 },
  execute: async (executor, params) => {
    await executor.trace('capability.inventory', 'Inventory reserved', { orderId: params.orderId });
    return { success: true, reserved: true };
  },
};

const datastoreFirestore: Capability = {
  id: 'datastore_firestore',
  name: 'Firestore',
  vertical: 'datastore',
  verbs: ['write'],
  constraints: [{ op: 'eq', key: 'ext.datastore', value: 'firestore' }],
  metadata: { provider: 'Firestore', priority: 10 },
  execute: async (executor, params) => {
    await executor.trace('capability.datastore', 'Stored in Firestore', { orderId: params.orderId });
    return { success: true, datastore: 'firestore' };
  },
};

const datastorePostgres: Capability = {
  id: 'datastore_postgres',
  name: 'Postgres',
  vertical: 'datastore',
  verbs: ['write'],
  constraints: [{ op: 'eq', key: 'ext.datastore', value: 'postgres' }],
  metadata: { provider: 'Postgres', priority: 12 },
  execute: async (executor, params) => {
    await executor.trace('capability.datastore', 'Stored in Postgres', { orderId: params.orderId });
    return { success: true, datastore: 'postgres' };
  },
};

const baseParams = () => ({
  orderId: `ord_${Date.now()}`,
  total: 125.5,
  customer: { id: 'cust_001', tier: 'enterprise' },
});

type ScenarioConfig = {
  id: string;
  core: { country: string; currency: string; payment_method: string; online_state: 'online' | 'offline' };
  ext: { customer_tier: string; preferred_logistics?: string; risk_level?: string; datastore: 'firestore' | 'postgres' };
};

const scenarios: Record<string, ScenarioConfig> = {
  'context-us': {
    id: 'context-us',
    core: { country: 'US', currency: 'USD', payment_method: 'card', online_state: 'online' },
    ext: { customer_tier: 'enterprise', preferred_logistics: 'fedex', datastore: 'firestore' },
  },
  'context-id': {
    id: 'context-id',
    core: { country: 'ID', currency: 'IDR', payment_method: 'wallet', online_state: 'online' },
    ext: { customer_tier: 'mid', preferred_logistics: 'local', datastore: 'firestore' },
  },
  'context-de': {
    id: 'context-de',
    core: { country: 'DE', currency: 'EUR', payment_method: 'card', online_state: 'online' },
    ext: { customer_tier: 'enterprise', preferred_logistics: 'fedex', datastore: 'postgres' },
  },
  'provider-stripe-firestore': {
    id: 'provider-stripe-firestore',
    core: { country: 'US', currency: 'USD', payment_method: 'card', online_state: 'online' },
    ext: { customer_tier: 'enterprise', preferred_logistics: 'fedex', datastore: 'firestore' },
  },
  'provider-wallet-firestore': {
    id: 'provider-wallet-firestore',
    core: { country: 'ID', currency: 'IDR', payment_method: 'wallet', online_state: 'online' },
    ext: { customer_tier: 'mid', preferred_logistics: 'local', datastore: 'firestore' },
  },
  'provider-stripe-postgres': {
    id: 'provider-stripe-postgres',
    core: { country: 'DE', currency: 'EUR', payment_method: 'card', online_state: 'online' },
    ext: { customer_tier: 'enterprise', preferred_logistics: 'fedex', datastore: 'postgres' },
  },
};

function createOrchestrator() {
  const capabilityRegistry = new CapabilityRegistry();
  capabilityRegistry.register(stripePaymentCapability);
  capabilityRegistry.register(walletPaymentCapability);
  capabilityRegistry.register(emailNotificationCapability);
  capabilityRegistry.register(euVatComplianceCapability);
  capabilityRegistry.register(indonesianPPNCapability);
  capabilityRegistry.register(logisticsFedexPreferred);
  capabilityRegistry.register(logisticsDhl);
  capabilityRegistry.register(logisticsLocal);
  capabilityRegistry.register(crmSalesforce);
  capabilityRegistry.register(crmHubspot);
  capabilityRegistry.register(inventoryRealtime);
  capabilityRegistry.register(datastoreFirestore);
  capabilityRegistry.register(datastorePostgres);

  const recipeRegistry = new RecipeRegistry();
  recipeRegistry.register({
    intentName: 'fulfillOrder',
    name: 'Global Fulfillment',
    description: 'Payment + inventory + compliance + notification + logistics + CRM + datastore',
    requiredVerticals: ['payment', 'inventory', 'compliance', 'notification', 'logistics', 'crm', 'datastore'],
    executionOrder: 'sequential',
  });

  return new Orchestrator(capabilityRegistry, recipeRegistry);
}

function createExecutor() {
  const eventBus = new EventBus();
  const eventLog = EventLog.create();
  eventBus.onAll(createEventLogHandler(eventLog));
  const bridge = new MockBridgeAdapter({ latency: 20, failureRate: 0 });
  const executor = new Executor(new InMemoryDataStore(), { bridge, enableProcessTracking: true, eventBus });
  return { executor, eventLog };
}

export async function runScenario(scenarioId: string) {
  const config = scenarios[scenarioId] || scenarios['context-us'];
  const orchestrator = createOrchestrator();
  const { executor, eventLog } = createExecutor();

  const context = ExecutionContext.create({}, { core: config.core, ext: config.ext });

  const result = await executor.runWithContext(context, async () =>
    orchestrator.orchestrate('fulfillOrder', baseParams(), executor)
  );

  const selections = Array.from(result.selectedCapabilities.entries()).reduce<Record<string, string | null>>(
    (acc, [vertical, match]) => {
      acc[vertical] = match?.capability.id || null;
      return acc;
    },
    {}
  );

  return {
    scenarioId: config.id,
    selections,
    trace: result.trace,
    eventLog: eventLog.getEntries?.() || [],
    context: config,
  };
}
