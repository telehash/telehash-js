#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .argv;

argv.eval = function(cmd, context, filename, callback) {
  callback(null, 'foo');
}

repl.start(argv, function(mesh){
  mesh.router(true);
  mesh.discover(true);
  mesh.accept = mesh.link; // auto-link any

  mesh.rlog('chat:',mesh.uri());

});