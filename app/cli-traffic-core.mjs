import { handleNativeTrafficRequest } from './native-traffic-core.mjs';

export const handleCliTrafficRequest = (request, options) => handleNativeTrafficRequest(request, 'cli', options);
