import { handleNativeTrafficRequest, CONTRACTS } from './native-traffic-core.mjs';

export const handleDesktopTrafficRequest = (request, options) => handleNativeTrafficRequest(request, 'desktop_mcp', options);
export const OPERATIONS = CONTRACTS.desktop_mcp.operations;
export { MAX_BODY_BYTES, OUTCOMES, PRODUCTION_ORIGINS, posthogCaptureUrl } from './native-traffic-core.mjs';
