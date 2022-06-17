'use strict';

const google = require('./google')
const cognito = require('./cognito')
const relationshop = require('./relationshop')
const role = require('./role')

module.exports = {
  google,
  cognito,
  relationshop,
  role
};
