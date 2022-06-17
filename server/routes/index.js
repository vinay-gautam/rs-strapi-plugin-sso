module.exports = [
  {
    method: 'GET',
    path: '/google',
    handler: 'google.googleSignIn',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/google/callback',
    handler: 'google.googleSignInCallback',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/cognito',
    handler: 'cognito.cognitoSignIn',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/cognito/callback',
    handler: 'cognito.cognitoSignInCallback',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/relationshop',
    handler: 'relationshop.relationshopSignIn',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/relationshop/callback',
    handler: 'relationshop.relationshopSignInCallback',
    config: {
      auth: false,
    },
  },
  {
    method: 'GET',
    path: '/sso-roles',
    handler: 'role.find'
  },
  {
    method: 'PUT',
    path: '/sso-roles',
    handler: 'role.update'
  }
];
