export const statusCodes = {
  400: 'INVALID_REQUEST', 401: 'AUTHENTICATION_REQUIRED', 403: 'ACCESS_DENIED', 404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE',
};

const readRoutes = [
  /^(?:healthz|readyz|website|sitemap\.xml|session|activity|exports|inbox|records|records\/doubts|student|student\/questions|staff|site-admin|question-bank|materials|exams|tutorial|student\/photo)$/,
  /^(?:website|page)\/(?:courses|resources)\/[a-z0-9-]{1,120}$/,
  /^forms\/(?:admission|enquiry|counselling|contact)$/,
  /^legacy\/(?:public|private)\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/,
  /^exports\/(?:all\.zip|[a-z_]+\.xlsx)$/,
  /^(?:inbox\/export\.csv|tutorial\/template\.xlsx|people\/students\/template\.csv|people\/(?:students|teachers))$/,
  /^records\/receipt\/\d+$/,
  /^(?:materials|exams)\/[\da-f-]{36}$/,
  /^site-admin\/[a-z_]+$/,
];
const writeRoutes = [
  /^(?:enquiry|forgot|reset|login|logout|password|documents\/extract|materials|student\/photo|exams|tutorial)$/,
  /^forms\/(?:admission|enquiry|counselling|contact)$/,
  /^materials\/[\da-f-]{36}$/,
  /^exams\/[\da-f-]{36}\/(?:start|update)$/,
  /^inbox\/(?:\d+|[\da-f-]{36})(?:\/(?:status|assign|note|delete))?$/,
  /^records\/(?:enrollment|attendance|attendance\/batch|payment|doubts)$/,
  /^records\/enrollment\/\d+\/(?:edit|delete)$/,
  /^records\/payment\/\d+\/delete$/,
  /^records\/doubts\/(?:\d+|[\da-f-]{36})(?:\/close)?$/,
  /^people\/(?:students|teachers)(?:\/\d+(?:\/(?:reset|delete))?)?$/,
  /^people\/students\/import$/,
  /^question-bank\/(?:save|share|\d+\/(?:answer|delete))$/,
  /^tutorial\/(?:release|\d+\/(?:edit|delete))$/,
  /^site-admin\/[a-z_]+(?:\/\d+(?:\/delete)?)?$/,
];

export function allowedMethods(action) {
  const allowed = [];
  if (readRoutes.some(pattern => pattern.test(action))) allowed.push('GET', 'HEAD');
  if (writeRoutes.some(pattern => pattern.test(action))) allowed.push('POST');
  return allowed;
}

export function jsonResponder(requestId) {
  return (result, status = 200, headers = {}) => {
    const details = status >= 400 ? { ...result, code: statusCodes[status] || 'REQUEST_FAILED', status, requestId } : result;
    return Response.json(details, {
      status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Request-ID': requestId, ...(status === 429 ? { 'Retry-After': '900' } : {}), ...headers },
    });
  };
}

export function databaseErrorStatus(error) {
  if (error?.code === 11000) return 409;
  if ([6, 7, 13, 18, 50, 89, 91, 11600, 11602, 13435].includes(error?.code)) return 503;
  if (['DatabaseConfigurationError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError',
    'MongoOperationTimeoutError', 'MongoPoolClearedError', 'MongoTopologyClosedError', 'MongoNotConnectedError'].includes(error?.name)) return 503;
  return 500;
}
