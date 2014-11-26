#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .default('port', 42424)
  .boolean('norepl').describe('norepl', 'disable REPL')
  .boolean('v').describe('v', 'verbose')
  .argv;

repl.start(argv, function(mesh){
  mesh.json().router = true;
  mesh.linked(); // we changed the json!
  mesh.discover(true);

  mesh.rlog('router:',mesh.json());
  mesh.rlog('router:',mesh.uri());
});