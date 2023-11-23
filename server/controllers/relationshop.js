"use strict";
const axios = require("axios");
const { v4 } = require("uuid");
const openId = require("openid-client");
const NodeCache = require("node-cache");
const getService = (name) => {
  return strapi.plugin('users-permissions').service(name);
};
const nodeCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

const configValidation = () => {
  const config = strapi.config.get("plugin.strapi-plugin-sso");
  if (
    config["RS_OAUTH_CLIENT_ID"] &&
    config["RS_OAUTH_REDIRECT_URI"] &&
    config["RS_OAUTH_DOMAIN"]
  ) {
    return config;
  }
  throw new Error(
    "RS_OAUTH_CLIENT_ID, RS_OAUTH_REDIRECT_URI AND RS_OAUTH_DOMAIN are required"
  );
};

/**
 * Common constants
 */
const OAUTH_ENDPOINT = (domain) => {
  return `${domain}/connect/authorize`;
};
const OAUTH_TOKEN_ENDPOINT = (domain) => {
  return `${domain}/connect/token`;
};
const OAUTH_USER_INFO_ENDPOINT = (domain) => {
  return `${domain}/connect/userinfo`;
};
const OAUTH_GRANT_TYPE = "authorization_code";
const OAUTH_SCOPE = encodeURIComponent("openid offline_access");
const OAUTH_RESPONSE_TYPE = "code";
const OATH_CODE_CHALLENGE_METHOD = "S256";

async function relationshopSignIn(ctx) {
  const config = configValidation();
  const redirectUri = encodeURIComponent(config["RS_OAUTH_REDIRECT_URI"]);
  const endpoint = OAUTH_ENDPOINT(config["RS_OAUTH_DOMAIN"]);
  const codeVerifier = openId.generators.codeVerifier();
  const nonce = openId.generators.nonce();
  const codeChallenge = openId.generators.codeChallenge(codeVerifier);
  const state = openId.generators.state();

  // Store Code Verifier with key is State
  nodeCache.set(`sso:${state}`, codeVerifier, 5 * 60); // 5 mins
  
  const url = `${endpoint}?client_id=${config["RS_OAUTH_CLIENT_ID"]}&redirect_uri=${redirectUri}&scope=${OAUTH_SCOPE}&response_type=${OAUTH_RESPONSE_TYPE}&code_challenge_method=${OATH_CODE_CHALLENGE_METHOD}&code_challenge=${codeChallenge}&nonce=${nonce}&state=${state}`;
  ctx.set("Location", url);
  return ctx.send({}, 301);
}

async function relationshopSignInCallback(ctx) {
  const config = configValidation();
  const tokenService = getService("token");
  const userService = getService("user");
  const oauthService = strapi.plugin("strapi-plugin-sso").service("oauth");
  const roleService = strapi.plugin("strapi-plugin-sso").service("role");

  if (!ctx.query.code) {
    return ctx.send(oauthService.renderSignUpError(`Code Not Found`));
  }

  const codeVerifier = nodeCache.take(`sso:${ctx.query.state}`);
  
  // Invalid or user logged in
  if (!codeVerifier) {
    const url = "/admin";
    ctx.set("Location", url);
    return ctx.send({}, 301);
  }

  const params = new URLSearchParams();
  params.append("code", ctx.query.code);
  params.append("client_id", config["RS_OAUTH_CLIENT_ID"]);
  params.append("redirect_uri", config["RS_OAUTH_REDIRECT_URI"]);
  params.append("grant_type", OAUTH_GRANT_TYPE);
  params.append("code_verifier", codeVerifier);

  try {
    const tokenEndpoint = OAUTH_TOKEN_ENDPOINT(config["RS_OAUTH_DOMAIN"]);
    const userInfoEndpoint = OAUTH_USER_INFO_ENDPOINT(
      config["RS_OAUTH_DOMAIN"]
    );

    const response = await axios.post(tokenEndpoint, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const userResponse = await axios.get(userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${response.data.access_token}`,
      },
    });
    if (!userResponse.data) {
      throw new Error("User not found.");
    }

    const {
      Email,
      FirstName,
      LastName,
      email,
      given_name,
      family_name
    } = userResponse.data;

    const dbUser = await userService.findOneByEmail(Email || email);
    let activateUser;
    let jwtToken;

    if (dbUser) {
      activateUser = dbUser;
      jwtToken = await tokenService.createJwtToken(dbUser);
    } else {
      const relationshopRoles = await roleService.relationshopRoles();
      const roles =
        relationshopRoles && relationshopRoles["roles"]
          ? relationshopRoles["roles"].map((role) => ({
              id: role,
            }))
          : [];

      const defaultLocale = oauthService.localeFindByHeader(
        ctx.request.headers
      );

      activateUser = await oauthService.createUser(
        Email || email,
        FirstName || given_name,
        LastName || family_name,
        defaultLocale,
        roles
      );
      jwtToken = await tokenService.createJwtToken(activateUser);

      // Trigger webhook
      await oauthService.triggerWebHook(activateUser);
    }
    const nonce = v4();
    const html = oauthService.renderSignUpSuccess(
      jwtToken,
      activateUser,
      nonce
    );
    ctx.set("Content-Security-Policy", `script-src 'nonce-${nonce}'`);
    ctx.send(html);
  } catch (e) {
    console.error(e);
    ctx.send(oauthService.renderSignUpError(e.message));
  }
}

module.exports = {
  relationshopSignIn,
  relationshopSignInCallback,
};
