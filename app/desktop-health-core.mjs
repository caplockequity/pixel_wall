import { handleNativeTrafficRequest, CONTRACTS } from './native-traffic-core.mjs';
export const handleDesktopHealthRequest = (request, options) => handleNativeTrafficRequest(request, 'health', options);
export const OPERATIONS = CONTRACTS.health.operations;
