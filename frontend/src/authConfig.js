import {LogLevel} from '@azure/msal-browser';

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const apiClientId = import.meta.env.VITE_ENTRA_API_CLIENT_ID || clientId;
const redirectUri = import.meta.env.VITE_ENTRA_REDIRECT_URI || window.location.origin;

if (!tenantId || !clientId) {
  console.warn('VITE_ENTRA_TENANT_ID and VITE_ENTRA_CLIENT_ID must be configured.');
}

export const msalConfig = {
  auth: {
    clientId: clientId || '',
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

export const loginRequest = {
  scopes: [`api://${apiClientId}/access_as_user`],
};
