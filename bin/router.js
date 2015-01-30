#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .default('port', 42424)
  .boolean('norepl').describe('norepl', 'disable REPL')
  .boolean('v').describe('v', 'verbose')
  .argv;

repl.start(argv, function(mesh){
  mesh.router(true);
  mesh.discover(true);

  mesh.rlog('router:',mesh.json());
  mesh.rlog('router:',mesh.uri());

  // for any links, we log status changes
  mesh.extending({link:function(link){
    link.status(function(err){
      mesh.rlog(link.hashname.substr(0,8),err?'down':'up',err||'');
    });
  }});
});