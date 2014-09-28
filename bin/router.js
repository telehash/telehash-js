#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .default('port', 42424)
  .boolean('norepl').describe('norepl', 'disable REPL')
  .boolean('v').describe('v', 'verbose')
  .argv;

repl.start(argv, function(mesh){
  mesh.json().router = true;
  mesh.discover(true);

  mesh.log.info();
  mesh.log.info(mesh.json({space:2}));
  mesh.log.info('router up');
  mesh.r.displayPrompt();
});