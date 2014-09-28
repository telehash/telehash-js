#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .argv;
  
repl.start(argv, function(mesh){
  if(mesh.links.length == 0) mesh.rlog('no links');
  // for any links, we log status changes
  mesh.extending({link:function(link){
    link.status(function(err){
      mesh.rlog(link.hashname.substr(0,8),err?'down':'up',err||'');
    });
  }});
});