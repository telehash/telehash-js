#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .describe('nick', 'nickname')
  .argv;

argv.eval = function(cmd, context, filename, callback) {
  callback(null, 'foo');
}

repl.start(argv, function(mesh){
  mesh.router(true);
  mesh.discover(true);
  mesh.accept = mesh.link; // auto-link any

  // create a chat
  var args = argv._[0] || {}; // from given uri, or blank
  mesh.chat(args, function(err, chat){
    if(err) return mesh.rlog('err',err);
    chat.join(argv.nick,function(err){
      if(argv._[0]) mesh.rlog('joined');
      else mesh.rlog('invite others with',mesh.uri({protocol:'chat',token:chat.id}));
    });
  });

});