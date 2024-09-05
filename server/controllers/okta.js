const axios = require('axios');
const { v4 } = require('uuid');

// Constants for Okta
// const OAUTH_ENDPOINT = 'https://dev-01324087.okta.com/oauth2/default/v1/authorize';
// const OAUTH_TOKEN_ENDPOINT = 'https://dev-01324087.okta.com/oauth2/default/v1/token';
// const OAUTH_USER_INFO_ENDPOINT = 'https://dev-01324087.okta.com/oauth2/default/v1/userinfo';
// const OAUTH_GRANT_TYPE = 'authorization_code';
// const OAUTH_RESPONSE_TYPE = 'code';
// const OAUTH_SCOPE = 'openid profile email'; // Adjust scopes as needed






const configValidation = () => {
   const config = strapi.config.get('plugin.strapi-plugin-sso');
  if (config['OKTA_OAUTH_CLIENT_ID'] && config['OKTA_OAUTH_CLIENT_SECRET']) {
    return config;
  }
  throw new Error('OKTA_OAUTH_CLIENT_ID and OKTA_OAUTH_CLIENT_SECRET are required');
};

/**
 * Redirect to Okta with state parameter for CSRF protection
 * @param ctx
 * @return {Promise<*>}
 */
async function oktaSignIn(ctx) {
  const config = configValidation();
  const redirectUri = encodeURIComponent(config['OKTA_OAUTH_REDIRECT_URI']);
  
  // Generate a unique state value and store it in the session for later verification
  const state = v4();
  ctx.session.state = state; // Assuming session middleware is available
  
  const url = `${config['OAUTH_ENDPOINT']}?client_id=${config['OKTA_OAUTH_CLIENT_ID']}&redirect_uri=${redirectUri}&scope=${config['OAUTH_SCOPE']}&response_type=${config['OAUTH_RESPONSE_TYPE']}&state=${state}`;
  ctx.set('Location', url);
  return ctx.send({}, 302);
}

/**
 * Verify the token and if there is no account, create one and then log in
 * @param ctx
 * @return {Promise<*>}
 */
async function oktaSignInCallback(ctx) {
  const config = configValidation();
  const httpClient = axios.create();
  const userService = strapi.service('admin::user');
  const tokenService = strapi.service('admin::token');
  const oauthService = strapi.plugin('strapi-plugin-sso').service('oauth');
  const roleService = strapi.plugin('strapi-plugin-sso').service('role');

  // Verify the state parameter to ensure CSRF protection
  if (ctx.query.state !== ctx.session.state) {
    return ctx.send(oauthService.renderSignUpError('Invalid state parameter'));
  }

  if (!ctx.query.code) {
    return ctx.send(oauthService.renderSignUpError('Code Not Found'));
  }

  const params = new URLSearchParams();
  params.append('code', ctx.query.code);
  params.append('client_id', config['OKTA_OAUTH_CLIENT_ID']);
  params.append('client_secret', config['OKTA_OAUTH_CLIENT_SECRET']);
  params.append('redirect_uri', config['OKTA_OAUTH_REDIRECT_URI']);
  params.append('grant_type', config['OAUTH_GRANT_TYPE']);

  try {
    const response = await httpClient.post(config['OAUTH_TOKEN_ENDPOINT'], params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const userInfoEndpoint = config['OAUTH_USER_INFO_ENDPOINT']; // No need to append the access token to the URL
    const userResponse = await httpClient.get(userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${response.data.access_token}` // Pass the token in the Authorization header
      }
    });

    // Handle user info
    const email = config['OKTA_ALIAS'] ? oauthService.addAlias(userResponse.data.email, config['OKTA_ALIAS']) : userResponse.data.email;
    const dbUser = await userService.findOneByEmail(email);
    let activateUser;
    let jwtToken;

    if (dbUser) {
      // Already registered
      activateUser = dbUser;
      jwtToken = await tokenService.createJwtToken(dbUser);
    } else {
      // Register a new account
      const oktaRoles = await roleService.oktaRoles();
      const roles = oktaRoles && oktaRoles['roles'] ? oktaRoles['roles'].map(role => ({
        id: role,
      })) : [];

      const defaultLocale = oauthService.localeFindByHeader(ctx.request.headers);
      activateUser = await oauthService.createUser(
        email,
        userResponse.data.family_name,
        userResponse.data.given_name,
        defaultLocale,
        roles
      );
      jwtToken = await tokenService.createJwtToken(activateUser);

      // Trigger webhook
      await oauthService.triggerWebHook(activateUser);
    }

    // Login Event Call
    oauthService.triggerSignInSuccess(activateUser);

    // Client-side authentication persistence and redirection
    const nonce = v4();
    const html = oauthService.renderSignUpSuccess(jwtToken, activateUser, nonce);
    ctx.set('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
    ctx.send(html);
  } catch (e) {
    console.error(e);
    ctx.send(oauthService.renderSignUpError(e.message));
  }
}

module.exports = {
  oktaSignIn,
  oktaSignInCallback
};
